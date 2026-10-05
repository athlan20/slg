// 全局时间缩放（AISLG-38，v20）：快速验证游戏节奏的运行时开关。
// 语义：耗时类（建造 / 升级 / 征兵 / 行军 / 掠夺冷却 / NPC 袭击间隔）÷ scale，
// 速率类（资源产出 / 人口增长 / 军队耗粮）× scale。只作用于新发起的任务与
// 新一次结算（惰性结算天然增量），存量 due_at 不重算。
//
// 配置存 PostgreSQL 的 settings 表（key='time_scale'），API 与 Worker 双进程
// 共享一份、避免两边环境变量不一致导致口径漂移；进程内缓存 TTL 刷新，
// 修改配置无需重启，切换在 TTL 窗口内生效。getTimeScale() 为同步读：
// 未加载 / 刷新失败时返回默认值——时长出口遍布同步上下文（含文档渲染），
// 不为此把调用链整体 async 化。
import type pg from 'pg';

/** 库中无记录 / 未加载时的默认缩放（紧急需求：部署即加速 50 倍） */
export const DEFAULT_TIME_SCALE = 50;
/** 缓存有效期（毫秒）：切换配置的最长生效延迟 */
const CACHE_TTL_MS = 10_000;

const SETTINGS_KEY = 'time_scale';

let cachedScale: number | null = null;
let cachedAt = 0;
/** 临时覆盖（仅 atBaseTimeScale 期间非空）：文档示例按未加速基准渲染用 */
let overrideScale: number | null = null;

/** 同步读当前缩放：缓存未过期直接用；过期返回旧值并触发后台刷新（不阻塞调用方） */
export function getTimeScale(): number {
  return overrideScale ?? cachedScale ?? DEFAULT_TIME_SCALE;
}

/**
 * 在 scale=1（未加速基准）下同步执行 fn：Agent API 文档声明「数值为未加速基准」，
 * 示例里由规则函数算出的产量 / 储量 / 行军时长等必须按基准渲染，不能随部署值或
 * 默认 50 漂移（此前示例产量写成 5000/h、行军到达按 ×50 算，与文档声明不符）。
 */
export function atBaseTimeScale<T>(fn: () => T): T {
  const prev = overrideScale;
  overrideScale = 1;
  try {
    return fn();
  } finally {
    overrideScale = prev;
  }
}

/** 缓存是否过期（过期后调用方应安排一次异步刷新） */
export function timeScaleStale(): boolean {
  return Date.now() - cachedAt >= CACHE_TTL_MS;
}

/** 从 settings 读取并刷新缓存；库中无记录用默认值。启动预热与 TTL 刷新共用 */
export async function refreshTimeScale(pool: pg.Pool): Promise<number> {
  const res = await pool.query(`SELECT value FROM settings WHERE key = $1`, [SETTINGS_KEY]);
  const raw = res.rowCount ? (res.rows[0].value as { scale?: unknown }).scale : undefined;
  const scale = Number(raw);
  cachedScale = Number.isFinite(scale) && scale >= 1 ? scale : DEFAULT_TIME_SCALE;
  cachedAt = Date.now();
  return cachedScale;
}

/** 直接写入缓存（测试注入用；正常运行不走） */
export function setTimeScaleCache(scale: number): void {
  cachedScale = scale;
  cachedAt = Date.now();
}

/** 耗时缩放：基准秒数 ÷ scale，钳 1 秒下限（AISLG-38 要求避免 0 / 负数） */
export function scaledSeconds(baseSeconds: number): number {
  return Math.max(1, Math.floor(baseSeconds / getTimeScale()));
}

/** 毫秒时长缩放（冷却 / 间隔类）：÷ scale，钳 1 秒下限 */
export function scaledMs(baseMs: number): number {
  return Math.max(1_000, Math.floor(baseMs / getTimeScale()));
}

/** 速率缩放：基准速率 × scale（产出 / 增长 / 耗粮与产出同幅，经济关系不变） */
export function scaledRate(baseRate: number): number {
  return baseRate * getTimeScale();
}
