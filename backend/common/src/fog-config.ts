// 战争迷雾总开关 fog_enabled（AISLG-224）：存 settings 表（key='fog_enabled'，value={enabled}），换季保留。
// 默认关闭：库中无记录即 false。API 与 Worker 各自进程内缓存，TTL 10 秒（与 time-scale 同口径），
// 切换后 10 秒内全服生效、无需重启。getFogEnabled() 为同步读，未加载时返回 false（即关闭）。
import type pg from 'pg';

const SETTINGS_KEY = 'fog_enabled';
const CACHE_TTL_MS = 10_000;

let cachedEnabled = false;
let cachedAt = 0;
let overrideEnabled: boolean | null = null;

/** 同步读当前开关（默认关闭） */
export function getFogEnabled(): boolean {
  return overrideEnabled ?? cachedEnabled;
}

/** 缓存是否过期（过期后调用方应安排一次异步刷新） */
export function fogConfigStale(): boolean {
  return Date.now() - cachedAt >= CACHE_TTL_MS;
}

/** 从 settings 读取并刷新缓存；库中无记录或格式不对按关闭处理 */
export async function refreshFogEnabled(pool: pg.Pool | pg.PoolClient): Promise<boolean> {
  const res = await pool.query(`SELECT value FROM settings WHERE key = $1`, [SETTINGS_KEY]);
  const raw = res.rowCount ? (res.rows[0].value as { enabled?: unknown }).enabled : undefined;
  cachedEnabled = raw === true;
  cachedAt = Date.now();
  return cachedEnabled;
}

/** 写入开关（运维脚本 / 测试用；写库后同时刷新本进程缓存） */
export async function setFogEnabled(pool: pg.Pool, enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTINGS_KEY, JSON.stringify({ enabled })],
  );
  cachedEnabled = enabled;
  cachedAt = Date.now();
}

/** 直接写入缓存（测试注入用） */
export function setFogEnabledCache(enabled: boolean | null): void {
  overrideEnabled = enabled;
  cachedAt = Date.now();
}
