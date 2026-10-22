// 第 1 季播种（AISLG-134）：仅当 seasons 表为空时执行（幂等，ensureSchema 在建表后调用，咨询锁已串行化）。
// 把当前已运行的世界认作第 1 季：起点取首次部署时间（或环境变量 SEASON_1_START），终点取 SEASON_1_END，
// 缺省为起点 + SEASON_LENGTH_DAYS（缺省 28 天，按现实时间计）。种子沿用 WORLD_SEED；倍速继承 settings.time_scale。
// 存量账号中已有城池的一并标记为第 1 季；没有城池的沉睡号保持 NULL，登录时惰性加入。

import type pg from 'pg';
import { WORLD_SEED } from './world';
import { DEFAULT_TIME_SCALE } from './time-scale';
import { insertSeason } from './season-insert';

/** 赛季长度（现实天数）：环境变量 SEASON_LENGTH_DAYS，缺省 28；非正数视为未设置 */
export function seasonLengthDays(): number {
  const raw = Number(process.env.SEASON_LENGTH_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : 28;
}

/** 读取 ISO 时间环境变量；未设置返回 null，格式非法直接抛错（启动即暴露配置错误） */
function readIsoEnv(name: string): Date | null {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const date = new Date(raw.trim());
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} 不是合法的 ISO 时间: ${raw}`);
  }
  return date;
}

/**
 * 第 1 季的起止时刻：SEASON_1_START 缺省为现在，SEASON_1_END 缺省为起点 + SEASON_LENGTH_DAYS。
 * 只在播种时生效；之后的赛季终点由换季流程按 SEASON_LENGTH_DAYS 计算。
 */
export function firstSeasonWindow(now: Date = new Date()): { startAt: Date; endAt: Date } {
  const startAt = readIsoEnv('SEASON_1_START') ?? now;
  const endAt = readIsoEnv('SEASON_1_END') ?? new Date(startAt.getTime() + seasonLengthDays() * 24 * 3600 * 1000);
  if (endAt.getTime() <= startAt.getTime()) {
    throw new Error('SEASON_1_END 必须晚于 SEASON_1_START');
  }
  return { startAt, endAt };
}

/** 读取 settings.time_scale（库中无记录 / 非法时用默认值） */
async function currentTimeScale(client: pg.PoolClient | pg.Pool): Promise<number> {
  const res = await client.query(`SELECT value FROM settings WHERE key = 'time_scale'`);
  const scale = Number(res.rowCount ? (res.rows[0].value as { scale?: unknown }).scale : undefined);
  return Number.isFinite(scale) && scale >= 1 ? scale : DEFAULT_TIME_SCALE;
}

/** seasons 为空时播种第 1 季，并把已有城池的账号标记为第 1 季；已有赛季则什么都不做 */
export async function seedFirstSeason(client: pg.PoolClient | pg.Pool, now: Date = new Date()): Promise<void> {
  const existing = await client.query(`SELECT 1 FROM seasons LIMIT 1`);
  if (existing.rowCount) {
    return;
  }
  const { startAt, endAt } = firstSeasonWindow(now);
  const timeScale = await currentTimeScale(client);
  const { id: seasonId } = await insertSeason(client, { startAt, endAt, seed: WORLD_SEED, timeScale });
  await client.query(
    `UPDATE accounts SET season_id = $1
     WHERE season_id IS NULL AND EXISTS (SELECT 1 FROM cities c WHERE c.account_id = accounts.id)`,
    [seasonId],
  );
}
