// 五方势力的「当季启用」（AISLG-243，v102）：开关打开后不等换季，Worker 检测到开关已开而 settings 里
// 还没有 faction_started_at 时，在一个事务内放一次老巢：
// - 先记下启用时间（势力的第 1 天从这天算，见 common/src/faction.ts 的 factionEpochStart）；
// - 再对五家逐一判断老巢格或周围 5 格（切比雪夫，含老巢格本身）里有没有玩家城：有的话这家本季不放
//   （不吞城、不围攻、不出现在面板与地图图层，也不为让位迁玩家的城），下季换季再生成；其余照常放
//   （打上老巢标记、插 factions 行、吞周围 25 格内的 NPC 城）。
// 只执行一次：判断依据就是 faction_started_at 有没有记录——关掉再打开开关不重复放，也不补放当初跳过的那家；
// 换季后由 season-reset 重新对齐（开季五家全放，天数从新赛季开始算）。
// 老巢已在本季生成过（v102 前的存量数据）时只补记启用时间（记成本季开始时间，势力节奏不变），不再放第二次。
// 放完发一条公告：说明天数从开启当天算第 1 天，以及哪几家本季没放（原因：该处已有玩家城）。

import type pg from 'pg';
import { publishAnnouncement } from '../../common/src/announcement-publish';
import { FACTIONS, factionLairClearanceBox, type FactionDef } from '../../common/src/faction';
import { getFactionEnabled } from '../../common/src/faction-config';
import { createFaction, placeFactionLair } from '../../common/src/faction-db';
import { ensureFactionLairs } from '../../common/src/faction-lair-db';
import { loadFactionStartedAt, saveFactionStartedAt } from '../../common/src/faction-start';
import type { FactionKey } from '../../common/src/protocol-faction';
import { getCurrentSeason } from '../../common/src/season-db';

/** 当季启用的咨询锁（事务级）：API 与 Worker 同时触发时只有一个能进，另一个直接放弃 */
export const FACTION_START_LOCK_ID = 8721430;

export interface FactionStartResult {
  /** 本次是否记下了启用时间（false = 开关关闭 / 早就启用过 / 没抢到锁） */
  started: boolean;
  /** 本次放下的老巢数 */
  placed: number;
  /** 本季不放的势力（老巢格或周围 5 格内有玩家城） */
  skipped: FactionDef[];
}

const NOTHING: FactionStartResult = { started: false, placed: 0, skipped: [] };

/**
 * 这家老巢的保护范围（老巢格 + 周围 5 格，切比雪夫）里有没有玩家城：
 * world_tiles 的 kind='city' 与 cities 表都算（后者兜住地块缺行的存量城）。
 */
async function factionLairOccupiedByPlayer(q: pg.PoolClient, def: FactionDef): Promise<boolean> {
  const box = factionLairClearanceBox(def);
  const res = await q.query(
    `SELECT EXISTS (
       SELECT 1 FROM world_tiles WHERE kind = 'city' AND x BETWEEN $1 AND $2 AND y BETWEEN $3 AND $4
     ) OR EXISTS (
       SELECT 1 FROM cities WHERE x BETWEEN $1 AND $2 AND y BETWEEN $3 AND $4
     ) AS occupied`,
    [box.minX, box.maxX, box.minY, box.maxY],
  );
  return (res.rows[0] as { occupied: boolean }).occupied === true;
}

/** 当季启用：写启用时间 + 放老巢（一个事务，只执行一次）。now 可注入（测试直接调） */
export async function ensureFactionSeasonStart(pool: pg.Pool, now: Date = new Date()): Promise<FactionStartResult> {
  if (!getFactionEnabled()) {
    return NOTHING;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(`SELECT pg_try_advisory_xact_lock($1) AS ok`, [FACTION_START_LOCK_ID]);
    if (!lock.rows[0].ok) {
      await client.query('ROLLBACK');
      return NOTHING;
    }
    if (await loadFactionStartedAt(client)) {
      // 已经启用过：不重复放老巢，也不补放当初跳过的那家
      await client.query('ROLLBACK');
      return NOTHING;
    }
    // 老巢已在本季生成（v102 前换季 / 世界重建放的存量数据）：这些势力早就在跑了，启用时间记成本季开始时间，
    // 天数 / 半径 / 围攻节奏保持原样，不能因为上线新版本被重置成第 1 天
    const existing = await client.query(`SELECT 1 FROM factions LIMIT 1`);
    if (existing.rowCount) {
      const season = await getCurrentSeason(client);
      await saveFactionStartedAt(client, season ? season.startAt : now);
      await client.query('COMMIT');
      return { started: true, placed: 0, skipped: [] };
    }
    await saveFactionStartedAt(client, now);
    const placedKeys: FactionKey[] = [];
    const skipped: FactionDef[] = [];
    for (const def of FACTIONS) {
      if (await factionLairOccupiedByPlayer(client, def)) {
        skipped.push(def);
        continue;
      }
      // 老巢格被非玩家的东西占着（理论上不会发生）同样跳过，不抢占
      if (!(await placeFactionLair(client, def))) {
        console.warn(`ensureFactionSeasonStart: lair ${def.key} is occupied, skipped`);
        skipped.push(def);
        continue;
      }
      if (await createFaction(client, def)) {
        placedKeys.push(def.key);
      }
    }
    // 只给本季真放下的几家建老巢战况行：跳过的势力连战况数据都没有
    await ensureFactionLairs(client, placedKeys);
    await client.query('COMMIT');
    return { started: true, placed: placedKeys.length, skipped };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 启用公告的标题与正文（纯函数，便于测试）：
 * 天数从开启当天算第 1 天；本季没放的势力写明是哪几家及原因（该处已有玩家城）。
 */
export function factionStartAnnouncement(result: FactionStartResult): { titleZh: string; bodyZh: string } {
  const head =
    '五方势力已在本季启用：势力的「第几天」从开启当天算第 1 天——当前势力范围半径 100 格，满 7 天（第 8 天起）才开始围攻分城，' +
    '之后每过 7 天半径再扩大 50 格（第 8 天 150 格、第 15 天 200 格、第 22 天起 250 格）。';
  const tail =
    result.skipped.length > 0
      ? `本季没有登场的势力：${result.skipped.map((def) => def.name).join('、')}（该处已有玩家城，本季不再生成，下季换季时重新生成）。`
      : '五家势力本季全部登场。';
  return { titleZh: '五方势力本季启用', bodyZh: head + tail };
}

/**
 * Worker 定时器每轮调用：需要时执行一次当季启用，成功后发公告（公告失败只记日志，不回滚落位）。
 * 绝大多数轮次已经有启用时间：一次查询就返回，不开事务、不加锁。
 */
export async function runFactionStart(pool: pg.Pool, now: Date = new Date()): Promise<FactionStartResult> {
  if (!getFactionEnabled() || (await loadFactionStartedAt(pool))) {
    return NOTHING;
  }
  const result = await ensureFactionSeasonStart(pool, now);
  if (!result.started) {
    return result;
  }
  console.log(`faction season start: placed ${result.placed} lair(s), skipped ${result.skipped.length}`);
  const { titleZh, bodyZh } = factionStartAnnouncement(result);
  try {
    await publishAnnouncement(pool, {
      category: 'system',
      titleZh,
      bodyZh,
      titleEn: null,
      bodyEn: null,
      pinned: false,
      strongRemind: false,
      host: null,
      startsAt: now,
      endsAt: null,
      chat: true,
    });
  } catch (err) {
    console.error('faction start: announcement failed:', err instanceof Error ? err.message : err);
  }
  return result;
}
