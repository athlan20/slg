// Worker 世界结算的共用工具（v13 起；v16 下沉 markMarchArrived / abortMarchToReturn，
// 供 world-tick / battle-tick / plunder-tick 三方共用）：
// 行军行形态、通知载荷、城池锁定结算、战利品入账、部队入城与事件记录。
// world-tick.ts（行军推进与到达分发）与 battle-tick.ts（战斗结算与 NPC 袭击）、
// plunder-tick.ts（v16 掠夺 / 占领结算）共用。

import pg from 'pg';
import { EventType, type InitiatorRole, type Resources, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { readCargo } from '../../common/src/transport';
import { marchingPercent } from '../../common/src/tech';
import { stationPercent } from '../../common/src/building-effects';
import { loadTechLevels } from '../../common/src/tech-db';
import { loadArmyFoodUsePerHour, loadBuildingLevels, settleCityProduction, type CityProductionRow } from '../../common/src/production';
import { marchTravelSeconds, territoryRates } from '../../common/src/world';
import { addTileArmy, loadTerritory } from '../../common/src/world-db';
import type { BattleResult, BattleSideSummary } from '../../common/src/battle';
import type { BattleHeroView, BattleSideView } from '../../common/src/protocol-battle';
import { armyPower } from '../../common/src/battle';
import { WOUND_HOURS } from '../../common/src/hero';
import { scaledMs } from '../../common/src/time-scale';
import { battleBonusOf, grantHeroExp, loadHero, woundHero, type AccountHeroRow } from '../../common/src/hero-db';
import { insertBattleReport, withSideStats, type BattleReportDetail } from '../../common/src/battle-db';

/** 战报类别（BattleReportView.kind 取值；v21 新增 city_raid = NPC 袭击玩家主城；v38 新增 pvp_raid = 玩家攻打玩家城；v39 新增 pvp_wilderness = 玩家抢占玩家野地） */
export type BattleReportKind = 'wilderness' | 'npc_city' | 'npc_raid' | 'city_raid' | 'intercept' | 'yellow_turban' | 'pvp_raid' | 'pvp_wilderness' | 'pvp_conquest';

/** BattleSideSummary（引擎产出）→ 战报侧视图（battle-tick / plunder-tick / city-raid 共用；
 *  units / totalHp / avgRange 由 withSideStats 派生） */
export function sideView(name: string, side: BattleSideSummary, hero: BattleHeroView | null = null): BattleSideView {
  return withSideStats({ name, troops: side.troops, losses: side.losses, survivors: side.survivors, damage: side.damage, hero });
}

/** 武将行 + 部队规模 → 战报的武将视图（v36；随队 / 城守共用） */
export function heroBattleView(row: AccountHeroRow, troopCount: number): BattleHeroView {
  const bonus = battleBonusOf(row, troopCount);
  return {
    name: row.name, lead: row.lead, force: row.force, wit: row.wit,
    atkPercent: bonus?.atkPercent ?? 0, defPercent: bonus?.defPercent ?? 0,
  };
}

/** 组装并落库一份战报，返回战报 id（并登记 battle_report 通知）；三方结算共用 */
export async function saveBattleReport(
  client: pg.PoolClient,
  accountId: string,
  role: 'attacker' | 'defender',
  won: boolean,
  kind: BattleReportKind,
  x: number,
  y: number,
  result: BattleResult,
  attackerName: string,
  defenderName: string,
  wallPercent: number,
  notifies: TileNotify[],
  attackerHero: BattleHeroView | null = null,
  defenderHero: BattleHeroView | null = null,
): Promise<number> {
  const detail: BattleReportDetail = {
    x,
    y,
    kind,
    role,
    won,
    rounds: result.rounds,
    endReason: result.endReason,
    attacker: sideView(attackerName, result.attacker, attackerHero),
    defender: sideView(defenderName, result.defender, defenderHero),
    wallDefensePercent: wallPercent,
    ...(result.towerDamage > 0 ? { towerDamage: result.towerDamage } : {}),
    ...(result.wallBreak ? { wallBreak: result.wallBreak } : {}),
    roundLog: result.roundLog,
  };
  const report = await insertBattleReport(client, accountId, detail);
  notifies.push({ reason: 'battle_report', accountId, reportId: report.id });
  return report.id;
}

/** 行军行（marches 表；troops 为按兵种的 jsonb 快照） */
export interface MarchRow {
  id: string;
  account_id: string;
  from_city_id: string;
  x: number;
  y: number;
  troops: Partial<Record<TroopKind, number>> | null;
  purpose: string;
  status: string;
  initiator: string;
  started_at: Date;
  arrive_at: Date;
  /** v26（AISLG-79）：运输货物（jsonb），非运输行军为 null */
  cargo?: unknown;
  /** v28（AISLG-78）：截击的移动目标 id，其余为 null */
  target_id?: string | null;
  /** v35（AISLG-112）：截击埋伏开始的时刻（arrive_at 已顺延为预计接战时刻），其余为 null */
  ambush_at?: Date | null;
  /** v36（AISLG-114）：随队武将 id，其余为 null */
  hero_id?: string | null;
}

/** 结束后经 pg_notify 发给 API 的载荷（battle_report 为 v13 新增；
 *  server_broadcast 为 v23 新增——broadcast 为完整播报视图，全服广播） */
export interface TileNotify {
  reason: 'march_resolved' | 'tile_changed' | 'battle_report' | 'server_broadcast' | 'hero_state';
  accountId: string;
  marchId?: string;
  x?: number;
  y?: number;
  tileReason?: string;
  /** reason='hero_state' 时的武将推送载荷（PUSH_HERO_STATE 的 data） */
  data?: Record<string, unknown>;
  /** reason='battle_report' 时的战报 id */
  reportId?: number;
  /** reason='server_broadcast' 时的播报视图（ accountId 忽略，全服广播） */
  broadcast?: import('../../common/src/server-broadcast').ServerBroadcastCreated;
}

/** 锁定城池并把生产结算到 target（含当前野地加成；锚点不倒退）；target 缺省用数据库时钟 */
export async function settleOwnerCity(
  client: pg.PoolClient,
  cityId: string,
  target?: Date | null,
): Promise<{ row: CityProductionRow & { x: number | null; y: number | null } | null; account?: string }> {
  const res = await client.query(
    `SELECT c.id, c.account_id, c.x, c.y, c.gold, c.wood, c.food, c.stone, c.iron,
            c.settled_at, c.gold_rem, c.food_rem, c.wood_rem, c.stone_rem, c.iron_rem,
            c.population, c.population_rem
     FROM cities c WHERE c.id = $1 FOR UPDATE`,
    [cityId],
  );
  if (!res.rowCount) {
    return { row: null };
  }
  const row = res.rows[0] as CityProductionRow & { account_id: string; x: number | null; y: number | null };
  const levels = await loadBuildingLevels(client, cityId);
  const territory = await loadTerritory(client, cityId);
  // v14：结算前现查全军耗粮（含行军/野地驻军的 2 倍计），编成变化自然生效
  const armyFoodUsePerHour = await loadArmyFoodUsePerHour(client, cityId);
  let settleTo = target ?? null;
  if (!settleTo) {
    const nowRes = await client.query(`SELECT now() AS now`);
    settleTo = nowRes.rows[0].now as Date;
  }
  const anchor = settleTo > row.settled_at ? settleTo : row.settled_at;
  await settleCityProduction(client, row, levels, anchor, territoryRates(territory), armyFoodUsePerHour);
  return { row, account: row.account_id };
}

/** 结算后把战利品直接累加进城池资源（不设储量上限钳制，与取消返还同规则，占位） */
export async function creditLoot(client: pg.PoolClient, cityId: string, loot: Resources): Promise<void> {
  await client.query(
    `UPDATE cities SET gold = gold + $2, wood = wood + $3, food = food + $4,
            stone = stone + $5, iron = iron + $6 WHERE id = $1`,
    [cityId, loot.gold, loot.wood, loot.food, loot.stone, loot.iron],
  );
}

/** 部队并入城内驻军（返程回城 / 调兵入城） */
export async function troopsEnterCity(
  client: pg.PoolClient,
  cityId: string,
  troops: Partial<Record<TroopKind, number>>,
): Promise<void> {
  for (const [troop, count] of Object.entries(troops)) {
    const value = Math.floor(count ?? 0);
    if (value <= 0) {
      continue;
    }
    await client.query(
      `INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)
       ON CONFLICT (city_id, troop)
       DO UPDATE SET count = city_army.count + EXCLUDED.count, updated_at = now()`,
      [cityId, troop, value],
    );
  }
}

/** 记录行军完成事件（outcome：battle_won / battle_lost / reinforced / returned / aborted / scouted / transferred） */
export async function completeMarchEvent(
  client: pg.PoolClient,
  march: MarchRow,
  outcome: string,
  extra: Record<string, unknown>,
): Promise<void> {
  await insertEvent(client, {
    accountId: march.account_id,
    cityId: march.from_city_id,
    buildId: march.id,
    type: EventType.MARCH_COMPLETED,
    initiator: march.initiator as InitiatorRole,
    detail: { x: march.x, y: march.y, purpose: march.purpose, outcome, ...extra },
  });
}

/** 查询城池归属与名称（战报双方命名用）；城池不存在返回 null */
export async function loadCityNaming(
  client: pg.PoolClient,
  cityId: string,
): Promise<{ accountId: string; username: string; cityName: string } | null> {
  const res = await client.query(
    `SELECT c.account_id, c.name AS city_name, a.username
     FROM cities c JOIN accounts a ON a.id = c.account_id
     WHERE c.id = $1`,
    [cityId],
  );
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { account_id: string; city_name: string; username: string };
  return { accountId: row.account_id, username: row.username, cityName: row.city_name };
}

/**
 * 创建返程行军（from = 行军涉及地块，目的地 = 出发城；按编队最慢兵种速度）。
 * 空编队不产生行军（全灭无部队可撤）；出发城坐标不可用（重置删城等）返回 null，
 * 调用方按「部队随之消失」处理。v15 起战败幸存者撤回（battle_lost）也走本入口。
 */
export async function createReturnMarch(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  settled: { row: { x: number | null; y: number | null } | null },
  initiator: string,
  cargo?: Resources | null,
): Promise<string | null> {
  const hasTroops = Object.values(troops).some((count) => Math.floor(count ?? 0) > 0);
  const coords = settled.row;
  if (!hasTroops || !coords || coords.x === null || coords.y === null) {
    return null;
  }
  // v27：返程同样吃行军科技加成（账号级，按返程发起时的等级）
  const techs = await loadTechLevels(client, march.account_id);
  // v30（AISLG-83）：自己城池之间的调兵 / 运输（含失效返程）同样吃出发城驿站加成
  const station =
    march.purpose === 'transfer' || march.purpose === 'transport'
      ? stationPercent((await loadBuildingLevels(client, march.from_city_id)).post_station)
      : 0;
  const travel = marchTravelSeconds(coords.x, coords.y, march.x, march.y, troops, marchingPercent(techs) + station);
  // v36（AISLG-114）：随队武将跟着残部返程（行军中仍占用；回城后自然释放）
  const ins = await client.query(
    `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at, cargo, hero_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'return', 'marching', $6, now() + make_interval(secs => $7), $8::jsonb, $9)
     RETURNING id`,
    [march.account_id, march.from_city_id, march.x, march.y, JSON.stringify(troops), initiator, travel, cargo ? JSON.stringify(cargo) : null, march.hero_id ?? null],
  );
  return ins.rows[0].id as string;
}

/** 行军标记结算完成（幂等：仅 marching 状态）；battle-tick / plunder-tick 共用 */
export async function markMarchArrived(client: pg.PoolClient, marchId: string): Promise<void> {
  await client.query(
    `UPDATE marches SET status = 'arrived', resolved_at = clock_timestamp()
     WHERE id = $1 AND status = 'marching'`,
    [marchId],
  );
}

/** 目标失效：部队按编队速度原路返回；行军标记 arrived 并记录 aborted 事件 */
export async function abortMarchToReturn(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  // 运输行军目标失效：货物随部队原路带回（v26）；空编队无法返程时货物退还出发城
  const cargo = readCargo(march.cargo);
  const created = await createReturnMarch(client, march, troops, settled, march.initiator, cargo);
  if (cargo && !created && settled.row) {
    await creditLoot(client, march.from_city_id, cargo);
  }
  await markMarchArrived(client, march.id);
  await completeMarchEvent(client, march, 'aborted', { troops, returning: created, ...(cargo ? { cargo } : {}) });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
}

/** 增援到达并入驻军、行军结算完成并推送（reinforce 目的与 plunder/occupy 转增援共用） */
export async function reinforceTile(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: { x: number; y: number },
  notifies: TileNotify[],
): Promise<void> {
  await addTileArmy(client, tile.x, tile.y, troops);
  await markMarchArrived(client, march.id);
  await completeMarchEvent(client, march, 'reinforced', { troops });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
  notifies.push({ reason: 'tile_changed', accountId: march.account_id, x: tile.x, y: tile.y, tileReason: 'garrison_reinforced' });
}

/** 随队武将的战斗前装载结果：武将行 + 战报视图 + 引擎加成（按部队规模折算） */
export interface MarchHeroLoad {
  row: AccountHeroRow;
  report: BattleHeroView;
  engine: { atkPercent: number; defPercent: number };
}

/** 战斗前装载随队武将（v36，AISLG-114）：march.hero_id 为空或武将已不存在返回 null */
export async function loadMarchHeroBonus(
  client: pg.PoolClient,
  march: MarchRow,
  troopCount: number,
): Promise<MarchHeroLoad | null> {
  if (!march.hero_id) {
    return null;
  }
  const row = await loadHero(client, march.hero_id);
  if (!row) {
    return null;
  }
  const report = heroBattleView(row, troopCount);
  const bonus = battleBonusOf(row, troopCount);
  return {
    row,
    report,
    engine: bonus ? { atkPercent: bonus.atkPercent, defPercent: bonus.defPercent } : { atkPercent: 0, defPercent: 0 },
  };
}

/** 随队武将的战后结算摘要（march_completed 事件的 heroExp 字段） */
export interface HeroBattleSettle {
  heroId: string;
  heroName: string;
  /** 本场获得经验 = 歼灭敌军参考战力（战败减半） */
  expGained: number;
  /** 升到的等级（没升为 null） */
  leveledTo: number | null;
  /** 战败重伤的恢复时刻（获胜为 null） */
  woundedUntil: string | null;
}

/**
 * 随队武将的战后结算（v36，AISLG-114/116）：经验 = 歼灭敌军参考战力（战败减半）+ 升级
 * 属性成长（普通将 +1 / 名将 +2 每级）；带队战败（攻方失败或全灭）重伤 2 小时（随缩放），
 * 期间不能出征、不会死亡。扑空 / 目标消失等未接战路径不调用本函数（无经验无重伤）。
 */
export async function settleMarchHero(
  client: pg.PoolClient,
  march: MarchRow,
  result: BattleResult,
  notifies: TileNotify[],
): Promise<HeroBattleSettle | null> {
  if (!march.hero_id) {
    return null;
  }
  const hero = await loadHero(client, march.hero_id);
  if (!hero) {
    return null;
  }
  const killedPower = armyPower(result.defender.losses);
  const gained = Math.floor(killedPower * (result.attackerWon ? 1 : 0.5));
  const exp = await grantHeroExp(client, hero.id, gained);
  let woundedUntil: string | null = null;
  if (!result.attackerWon) {
    const until = new Date(Date.now() + scaledMs(WOUND_HOURS * 3_600_000));
    await woundHero(client, hero.id, until);
    woundedUntil = until.toISOString();
  }
  const level = exp?.level ?? hero.level;
  const leveledTo = exp?.leveledTo ?? null;
  if (leveledTo) {
    await insertEvent(client, {
      accountId: march.account_id,
      buildId: hero.id,
      type: EventType.HERO_LEVEL_UP,
      initiator: march.initiator as InitiatorRole,
      detail: { heroId: hero.id, heroName: hero.name, level: leveledTo },
    });
  }
  if (!result.attackerWon) {
    await insertEvent(client, {
      accountId: march.account_id,
      buildId: hero.id,
      type: EventType.HERO_WOUNDED,
      initiator: march.initiator as InitiatorRole,
      detail: { heroId: hero.id, heroName: hero.name, woundedUntil },
    });
  }
  notifies.push({
    reason: 'hero_state', accountId: march.account_id,
    data: { reason: 'exp_gained', heroId: hero.id, exp: { gained, level, leveledTo } },
  });
  if (!result.attackerWon) {
    notifies.push({ reason: 'hero_state', accountId: march.account_id, data: { reason: 'wounded', heroId: hero.id } });
  }
  return { heroId: hero.id, heroName: hero.name, expGained: gained, leveledTo, woundedUntil };
}
