// 势力的启用时间 faction_started_at（AISLG-243，v102）：存 settings 表（key='faction_started_at'，value={at: ISO 8601}），
// 与 faction_enabled 一样换季保留。势力的「第几天」从 max(本季开始时间, 启用时间) 算起（纯函数见 faction.ts 的
// factionEpochStart）：换季启用时两者相同、行为不变；赛季中途打开开关时从启用当天算第 1 天。
// 记的是「第一次打开开关（或换季 / 世界重建生成老巢）的时刻」。关掉再打开不覆盖——既不会重复放老巢，
// 也不会补放当初跳过的那家；换季时由 worker/src/season-reset.ts 重新对齐（开了势力设为新赛季开始时间，没开则删除）。
// 当季启用的一次性落位见 worker/src/faction-start.ts。

import type pg from 'pg';
import { factionEpochStart } from './faction';

type Queryable = pg.Pool | pg.PoolClient;

/** settings 表里的键（`{ at }`，时刻用 ISO 字符串存：jsonb 里比数字好读，也便于运维脚本直接看） */
export const FACTION_STARTED_AT_KEY = 'faction_started_at';

/** 读启用时间：没有记录 / 格式不对返回 null（调用方按「等于本季开始时间」处理） */
export async function loadFactionStartedAt(q: Queryable): Promise<Date | null> {
  const res = await q.query(`SELECT value FROM settings WHERE key = $1`, [FACTION_STARTED_AT_KEY]);
  if (!res.rowCount) {
    return null;
  }
  const raw = (res.rows[0].value as { at?: unknown } | null)?.at;
  if (typeof raw !== 'string') {
    return null;
  }
  const at = new Date(raw);
  return Number.isFinite(at.getTime()) ? at : null;
}

/** 势力起点 = max(本季开始时间, 启用时间)：天数、半径、围攻起算日共用这一个入口 */
export async function loadFactionEpochStart(q: Queryable, seasonStart: Date): Promise<Date> {
  return factionEpochStart(seasonStart, await loadFactionStartedAt(q));
}

/** 写启用时间（at 为 null 时删除记录 = 回到「等于本季开始时间」；换季且开关关闭时用） */
export async function saveFactionStartedAt(q: Queryable, at: Date | null): Promise<void> {
  if (!at) {
    await q.query(`DELETE FROM settings WHERE key = $1`, [FACTION_STARTED_AT_KEY]);
    return;
  }
  await q.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [FACTION_STARTED_AT_KEY, JSON.stringify({ at: at.toISOString() })],
  );
}

/**
 * 换季时对齐启用时间（AISLG-243）：开了势力 → 设为新赛季开始时间（与开季放老巢同一时刻，天数从第 1 天算，
 * 换季启用行为完全不变）；没开 → 删掉记录，否则下个赛季中途打开开关会被当成「已经启用过」而不放老巢。
 * 调用方：worker/src/season-reset.ts 的换季事务内（新赛季的 startAt 定了之后）。
 */
export async function alignFactionStartedAtForSeason(q: Queryable, seasonStart: Date, enabled: boolean): Promise<void> {
  await saveFactionStartedAt(q, enabled ? seasonStart : null);
}
