// 五方势力总开关 faction_enabled（AISLG-239，v99）：存 settings 表（key='faction_enabled'，value={enabled}），换季保留。
// 默认关闭：库中无记录即 false。关闭时游戏行为与上线前完全一样——不放老巢、不吞城、地块不带势力归属、
// 落位 / 迁城不避开老巢、GET_FACTIONS 返回 enabled=false。
// API 与 Worker 各自进程内缓存，TTL 4 秒；getFactionEnabled() 为同步读，未加载时返回 false（即关闭）。
// 打算跟换季一起上线：世界重新生成时才放老巢，不在赛季中途打开（避免老巢落到现有玩家身上）。

import type pg from 'pg';

const SETTINGS_KEY = 'faction_enabled';
/** 与 fog_enabled 同一档：比 API 的 5 秒刷新间隔短，保证每轮都刷新 */
const CACHE_TTL_MS = 4_000;

let cachedEnabled = false;
let cachedAt = 0;
let overrideEnabled: boolean | null = null;

/** 同步读当前开关（默认关闭） */
export function getFactionEnabled(): boolean {
  return overrideEnabled ?? cachedEnabled;
}

/** 缓存是否过期（过期后调用方应安排一次异步刷新） */
export function factionConfigStale(): boolean {
  return Date.now() - cachedAt >= CACHE_TTL_MS;
}

/** 从 settings 读取并刷新缓存；库中无记录或格式不对按关闭处理 */
export async function refreshFactionEnabled(pool: pg.Pool | pg.PoolClient): Promise<boolean> {
  const res = await pool.query(`SELECT value FROM settings WHERE key = $1`, [SETTINGS_KEY]);
  const raw = res.rowCount ? (res.rows[0].value as { enabled?: unknown }).enabled : undefined;
  cachedEnabled = raw === true;
  cachedAt = Date.now();
  return cachedEnabled;
}

/** 写入开关（运维脚本 / 测试用；写库后同时刷新本进程缓存） */
export async function setFactionEnabled(pool: pg.Pool, enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify({ enabled })],
  );
  cachedEnabled = enabled;
  cachedAt = Date.now();
}

/** 直接写入缓存（测试注入用；null = 取消覆盖，回到库里的值） */
export function setFactionEnabledCache(enabled: boolean | null): void {
  overrideEnabled = enabled;
  cachedAt = Date.now();
}
