// 行军的探索写入与探索简报（AISLG-224 第二步）。两个调用方：
// - worker/src/fog-tick.ts：去程结算后（到达 / 撤回已在 march 行上记 resolved_at）批量写入；
// - api/src/handlers-battle.ts 的 RECALL_MARCH：撤回时在同一事务里写入走过的那一段。
// 返程（purpose = return）不写入：它走的是同一条路。行军途中的实时视野现算，不写已探索。
import type pg from 'pg';
import { EventType } from './protocol';
import { insertEvent } from './events';
import { NOTIFY_CHANNEL } from './db';
import { FOG_REPORT_CELL_LIMIT, FOG_VISION, markRoute, routeBandKeys, scoutVisionRadius, walkedRoute } from './fog';
import { chunkCoords, ensureFogState, syncSeenTiles, type Coord, type TileFact } from './fog-db';
import { chunkIndexOf } from './fog';
import { loadTechLevels } from './tech-db';
import { getFogEnabled } from './fog-config';
import { recordFirstExplores } from './fog-first';
import { allUnclaimedRelics, type RelicRow } from './fog-relic-db';

/** 一趟去程的几何与身份（写入探索时需要） */
export interface ExplorationTrip {
  marchId: string;
  accountId: string;
  fromCityId: string;
  homeX: number;
  homeY: number;
  targetX: number;
  targetY: number;
  troops: Record<string, number>;
}

/** 探索简报（事件 exploration_report 的 detail） */
export interface ExplorationBriefing {
  chunks: number;
  npcCities: { total: number; byLevel: Record<string, number> };
  goldMines: number;
  highWilderness: number;
  wildHeroes: number;
  playerCities: number;
  famous: number;
  /** 新探索区块里未领取的遗迹（v93，AISLG-227）：总数与按种类计数 */
  relics: { total: number; byKind: Record<string, number> };
  cells: Array<{ x: number; y: number; kind: BriefingCellKind; level?: number }>;
}

export type BriefingCellKind = 'famous' | 'relic' | 'wild_hero' | 'gold_mine' | 'player_city' | 'npc_city' | 'high_wilderness';

/** 坐标上限的优先级（需求第二节 / 第六节）：名城 > 遗迹 > 在野名将 > 金矿 > 玩家城 > NPC 城 > 高级野地 */
const CELL_PRIORITY: BriefingCellKind[] = ['famous', 'relic', 'wild_hero', 'gold_mine', 'player_city', 'npc_city', 'high_wilderness'];

/** 高级野地的等级线（Lv5 及以上） */
const HIGH_WILDERNESS_LEVEL = 5;

/** 新探索区块里的东西按类别计数，并挑出最多 10 个坐标（按优先级、同级按 y、x 排序） */
export function buildBriefing(
  facts: readonly TileFact[],
  accountId: string,
  chunks: number,
  relics: readonly RelicRow[] = [],
): ExplorationBriefing {
  const briefing: ExplorationBriefing = {
    chunks,
    npcCities: { total: 0, byLevel: {} },
    goldMines: 0,
    highWilderness: 0,
    wildHeroes: 0,
    playerCities: 0,
    famous: 0,
    relics: { total: 0, byKind: {} },
    cells: [],
  };
  const candidates: Array<{ x: number; y: number; kind: BriefingCellKind; level?: number }> = [];
  for (const relic of relics) {
    briefing.relics.total += 1;
    briefing.relics.byKind[relic.kind] = (briefing.relics.byKind[relic.kind] ?? 0) + 1;
    candidates.push({ x: relic.x, y: relic.y, kind: 'relic' });
  }
  for (const fact of facts) {
    if (fact.kind === 'npc_city') {
      briefing.npcCities.total += 1;
      const key = String(fact.level);
      briefing.npcCities.byLevel[key] = (briefing.npcCities.byLevel[key] ?? 0) + 1;
      if (fact.famous) {
        briefing.famous += 1;
        candidates.push({ x: fact.x, y: fact.y, kind: 'famous', level: fact.level });
      } else {
        candidates.push({ x: fact.x, y: fact.y, kind: 'npc_city', level: fact.level });
      }
      continue;
    }
    if (fact.kind === 'city' && fact.ownerAccountId !== accountId) {
      briefing.playerCities += 1;
      candidates.push({ x: fact.x, y: fact.y, kind: 'player_city', level: fact.level });
      continue;
    }
    if (fact.wildFamous) {
      briefing.wildHeroes += 1;
      candidates.push({ x: fact.x, y: fact.y, kind: 'wild_hero', level: fact.level });
      continue;
    }
    if (fact.kind === 'wilderness' && fact.terrain === 'gold_mine') {
      briefing.goldMines += 1;
      candidates.push({ x: fact.x, y: fact.y, kind: 'gold_mine', level: fact.level });
      continue;
    }
    if (fact.kind === 'wilderness' && fact.level >= HIGH_WILDERNESS_LEVEL) {
      briefing.highWilderness += 1;
      candidates.push({ x: fact.x, y: fact.y, kind: 'high_wilderness', level: fact.level });
    }
  }
  candidates.sort((a, b) => CELL_PRIORITY.indexOf(a.kind) - CELL_PRIORITY.indexOf(b.kind) || a.y - b.y || a.x - b.x);
  briefing.cells = candidates.slice(0, FOG_REPORT_CELL_LIMIT);
  return briefing;
}

/**
 * 写入一趟去程的探索（fraction ∈ [0,1]：到达为 1，撤回为撤回时已走的比例）：
 * 并入城池 / 领地视野 → 沿走过的路线写视野带 → 新区块刷新全部地块快照、旧区块只刷新带内地块 →
 * 新区块不为空则写探索简报事件并 pg_notify。迷雾开启时另做名城 / 名将处所的首探（fog-first.ts）。
 * 调用方须在事务内，且已锁出发城。返回新探索的区块数与写入的事件 id（没有简报为 null）。
 */
export async function recordMarchExploration(
  client: pg.PoolClient,
  trip: ExplorationTrip,
  fraction: number,
  now: Date,
): Promise<{ freshChunks: number; eventId: number | null }> {
  const fogOn = getFogEnabled();
  if (fogOn) {
    // 锁序（v93）：主城（首探奖励发到主城）→ fog_explored，与 API 的城 → 探索顺序一致，不成环
    await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at, id LIMIT 1 FOR UPDATE`, [trip.accountId]);
  }
  // 先并入城池与领地视野：它们带来的新区块不算“部队走出来的”，不进简报
  const state = await ensureFogState(client, trip.accountId, now);
  const scoutingLevel = (await loadTechLevels(client, trip.accountId)).scouting ?? 0;
  const radius = (trip.troops.scout ?? 0) > 0 ? scoutVisionRadius(scoutingLevel) : FOG_VISION.march;
  const route = walkedRoute(trip.homeX, trip.homeY, trip.targetX, trip.targetY, fraction);
  const fresh = [...new Set(markRoute(state.bits, route, radius))];
  // 需要刷新快照的坐标：新区块全部格 + 路线视野带内的格（带内格所在区块都已探索）
  const coordSet = new Map<string, Coord>();
  for (const index of fresh) {
    for (const coord of chunkCoords(index)) {
      coordSet.set(`${coord.x},${coord.y}`, coord);
    }
  }
  for (const key of routeBandKeys(route, radius)) {
    const [x, y] = key.split(',').map(Number);
    coordSet.set(key, { x, y });
  }
  const facts = await syncSeenTiles(client, trip.accountId, [...coordSet.values()], now);
  await client.query(`UPDATE fog_explored SET bits = $2, updated_at = now() WHERE account_id = $1`, [
    trip.accountId,
    Buffer.from(state.bits),
  ]);
  // 首探：名城 / 处所所在区块是这趟新探索的才算（开局、城池视野、返程都不是这趟新探索的）
  if (fogOn && fresh.length > 0) {
    await recordFirstExplores(client, { marchId: trip.marchId, accountId: trip.accountId, fromCityId: trip.fromCityId }, new Set(fresh), now);
  }
  if (fresh.length === 0) {
    return { freshChunks: 0, eventId: null };
  }
  const freshSet = new Set(fresh);
  const freshFacts = facts.filter((fact) => freshSet.has(chunkIndexOf(fact.x, fact.y)));
  const freshRelics = fogOn ? (await allUnclaimedRelics(client)).filter((relic) => freshSet.has(chunkIndexOf(relic.x, relic.y))) : [];
  const briefing = buildBriefing(freshFacts, trip.accountId, fresh.length, freshRelics);
  const eventId = await insertEvent(client, {
    accountId: trip.accountId,
    cityId: trip.fromCityId,
    buildId: trip.marchId,
    type: EventType.EXPLORATION_REPORT,
    initiator: null,
    detail: { ...briefing, marchId: trip.marchId },
  });
  await client.query('SELECT pg_notify($1, $2)', [
    NOTIFY_CHANNEL,
    JSON.stringify({ reason: 'exploration_report', accountId: trip.accountId, eventId }),
  ]);
  return { freshChunks: fresh.length, eventId };
}
