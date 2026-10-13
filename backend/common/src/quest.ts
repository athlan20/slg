// 任务与签到（v56，AISLG-200）：日常任务 + 每日签到。API 侧处理，规则与数值集中在本文件。
// - 日常任务：6 条，每日按「北京日」(Asia/Shanghai) 刷新；完成判定读取 events 表当日事件，
//   零埋点（建造完成 / 征兵 / 出征 / 研究 / 占领野地分别落在既有事件类型上；登录视为恒完成）。
// - 签到：每账号一次/天，连续签到，7 天一轮循环（断签 streak 归 1）；奖励按连续天数递增。
// - 奖励统一发到「主城」（账号最早创建的城）：资源为 per-city 字段，发主城最简单。
// 说明：资源奖励为象征性小额（开局 2000/资源量级），50× 倍速下产量极高，奖励重在目标感；
// 数值如需调整只在本文件。

import pg from 'pg';
import type { Resources } from './protocol';

const RES_KEYS = ['gold', 'wood', 'food', 'stone', 'iron'] as const;

export interface DailyTaskDef {
  id: string;
  title: string;
  desc: string;
  /** 完成判定所用事件类型；空串 = 恒完成（登录类） */
  eventType: string;
  reward: Resources;
}

/** 日常任务清单（6 条）。eventType 取 events 表既有类型。 */
export const DAILY_TASKS: readonly DailyTaskDef[] = [
  { id: 'login', title: '每日登录', desc: '今日登录游戏', eventType: '', reward: { gold: 500, wood: 0, food: 0, stone: 0, iron: 0 } },
  { id: 'build', title: '大兴土木', desc: '完成 1 次建造或升级', eventType: 'build_completed', reward: { gold: 1500, wood: 1500, food: 0, stone: 0, iron: 0 } },
  { id: 'recruit', title: '招兵买马', desc: '征兵 1 次', eventType: 'recruit_started', reward: { gold: 0, wood: 0, food: 2000, stone: 0, iron: 0 } },
  { id: 'march', title: '出征沙场', desc: '出征 1 次', eventType: 'march_started', reward: { gold: 1500, wood: 0, food: 0, stone: 0, iron: 1500 } },
  { id: 'research', title: '潜心钻研', desc: '研究科技 1 次', eventType: 'research_started', reward: { gold: 0, wood: 1500, food: 0, stone: 1500, iron: 0 } },
  { id: 'occupy', title: '开疆拓土', desc: '占领 1 块野地', eventType: 'wilderness_occupied', reward: { gold: 1500, wood: 0, food: 0, stone: 1500, iron: 0 } },
];

/** 签到 7 天一轮的奖励（索引 0 = 第 1 天），随连续天数递增，第 7 天最优。 */
export const SIGNIN_REWARDS: readonly Resources[] = [
  { gold: 1000, wood: 0, food: 0, stone: 0, iron: 0 },
  { gold: 0, wood: 1500, food: 1500, stone: 0, iron: 0 },
  { gold: 2000, wood: 0, food: 0, stone: 0, iron: 0 },
  { gold: 0, wood: 0, food: 0, stone: 2000, iron: 2000 },
  { gold: 2500, wood: 2500, food: 0, stone: 0, iron: 0 },
  { gold: 0, wood: 0, food: 3000, stone: 3000, iron: 0 },
  { gold: 8000, wood: 5000, food: 5000, stone: 5000, iron: 5000 },
];

export interface DailyTaskView {
  id: string;
  title: string;
  desc: string;
  done: boolean;
  claimed: boolean;
  reward: Resources;
}

export interface SigninDayView {
  day: number;
  reward: Resources;
  claimed: boolean;
}

export interface SigninView {
  streak: number;
  total: number;
  todaySigned: boolean;
  days: SigninDayView[];
}

export interface QuestStateView {
  /** 今日（北京日，YYYY-MM-DD） */
  day: string;
  daily: DailyTaskView[];
  signin: SigninView;
}

/** 任务/签到业务错误（handler 转成 INVALID_PARAMS 或对应错误码） */
export class QuestError extends Error {
  constructor(public readonly code: 'UNKNOWN_TASK' | 'NOT_DONE' | 'ALREADY') {
    super(code);
  }
}

/** 今日与昨日（北京日）。 */
export async function todayInfo(pool: pg.Pool): Promise<{ today: string; yesterday: string }> {
  const res = await pool.query(
    `SELECT to_char((now() AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') AS today,
            to_char(((now() AT TIME ZONE 'Asia/Shanghai')::date - 1), 'YYYY-MM-DD') AS yesterday`,
  );
  return res.rows[0] as { today: string; yesterday: string };
}

/** Pool 与事务内的 PoolClient 都只用到 query */
type Queryable = Pick<pg.Pool, 'query'>;

/** 把奖励加到主城（账号最早创建的城）。无城或奖励全零时静默返回。 */
export async function grantRewards(pool: Queryable, accountId: string, reward: Resources): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [accountId];
  for (const key of RES_KEYS) {
    const amount = reward[key] ?? 0;
    if (amount > 0) {
      params.push(amount);
      sets.push(`${key} = ${key} + $${params.length}`);
    }
  }
  if (sets.length === 0) {
    return;
  }
  await pool.query(
    `UPDATE cities SET ${sets.join(', ')}
     WHERE account_id = $1 AND id = (SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1)`,
    params,
  );
}

/**
 * 原子领奖：同一事务内先插入领取记录、再发奖。记录没插进去（已领过，含并发的另一个请求抢先）
 * 就回滚并抛 ALREADY，奖励只会发一次。insertSql 必须以 ON CONFLICT DO NOTHING 结尾。
 */
export async function claimAtomically(
  pool: pg.Pool,
  accountId: string,
  reward: Resources,
  insertSql: string,
  insertParams: unknown[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(insertSql, insertParams);
    if (!inserted.rowCount) {
      await client.query('ROLLBACK');
      throw new QuestError('ALREADY');
    }
    await grantRewards(client, accountId, reward);
    await client.query('COMMIT');
  } catch (err) {
    if (!(err instanceof QuestError)) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** 读取任务与签到的完整状态（只读）。 */
export async function loadQuestState(pool: pg.Pool, accountId: string): Promise<QuestStateView> {
  const { today, yesterday } = await todayInfo(pool);
  const typesRes = await pool.query(
    `SELECT DISTINCT type FROM events WHERE account_id = $1 AND (created_at AT TIME ZONE 'Asia/Shanghai')::date = $2::date`,
    [accountId, today],
  );
  const types = new Set(typesRes.rows.map((r: { type: string }) => r.type));
  const claimsRes = await pool.query(
    `SELECT quest_id FROM quest_claims WHERE account_id = $1 AND day = $2::date`,
    [accountId, today],
  );
  const claimed = new Set(claimsRes.rows.map((r: { quest_id: string }) => r.quest_id));
  const daily: DailyTaskView[] = DAILY_TASKS.map((t) => ({
    id: t.id,
    title: t.title,
    desc: t.desc,
    done: t.eventType === '' ? true : types.has(t.eventType),
    claimed: claimed.has(t.id),
    reward: t.reward,
  }));

  const sres = await pool.query(
    `SELECT streak, to_char(last_day, 'YYYY-MM-DD') AS last_day, total FROM signin_state WHERE account_id = $1`,
    [accountId],
  );
  const row = sres.rows[0] as { streak: number; last_day: string | null; total: number } | undefined;
  const streak = row?.streak ?? 0;
  const total = row?.total ?? 0;
  const lastDay = row?.last_day ?? null;
  const todaySigned = lastDay === today;
  // 当前 7 天循环中已领取到的格位（1..7）：最近一次签到的位置；断签或从未签到为 0
  const claimedCount = lastDay === today || lastDay === yesterday ? ((streak - 1) % 7) + 1 : 0;
  const days: SigninDayView[] = SIGNIN_REWARDS.map((reward, i) => ({
    day: i + 1,
    reward,
    claimed: i < claimedCount,
  }));

  return { day: today, daily, signin: { streak, total, todaySigned, days } };
}

/** 领取一条日常任务奖励。已完成且未领取时成功。 */
export async function claimDaily(pool: pg.Pool, accountId: string, taskId: string): Promise<{ reward: Resources }> {
  const def = DAILY_TASKS.find((t) => t.id === taskId);
  if (!def) {
    throw new QuestError('UNKNOWN_TASK');
  }
  const { today } = await todayInfo(pool);
  const already = await pool.query(
    `SELECT 1 FROM quest_claims WHERE account_id = $1 AND quest_id = $2 AND day = $3::date`,
    [accountId, taskId, today],
  );
  if (already.rowCount) {
    throw new QuestError('ALREADY');
  }
  const done =
    def.eventType === ''
      ? true
      : (
          await pool.query(
            `SELECT 1 FROM events WHERE account_id = $1 AND type = $2 AND (created_at AT TIME ZONE 'Asia/Shanghai')::date = $3::date LIMIT 1`,
            [accountId, def.eventType, today],
          )
        ).rowCount !== 0;
  if (!done) {
    throw new QuestError('NOT_DONE');
  }
  await claimAtomically(
    pool,
    accountId,
    def.reward,
    `INSERT INTO quest_claims (account_id, quest_id, day) VALUES ($1, $2, $3::date) ON CONFLICT DO NOTHING`,
    [accountId, taskId, today],
  );
  return { reward: def.reward };
}

/** 每日签到。返回本轮（7 天循环内）的档位与奖励。事务内锁住签到行，并发重复签到只有一个成功。 */
export async function signin(
  pool: pg.Pool,
  accountId: string,
): Promise<{ tier: number; reward: Resources; streak: number }> {
  const { today, yesterday } = await todayInfo(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO signin_state (account_id, last_day, streak, total) VALUES ($1, NULL, 0, 0) ON CONFLICT DO NOTHING`,
      [accountId],
    );
    const sres = await client.query(
      `SELECT streak, to_char(last_day, 'YYYY-MM-DD') AS last_day FROM signin_state WHERE account_id = $1 FOR UPDATE`,
      [accountId],
    );
    const row = sres.rows[0] as { streak: number; last_day: string | null };
    if (row.last_day === today) {
      throw new QuestError('ALREADY');
    }
    const streak = row.last_day === yesterday ? row.streak + 1 : 1;
    const tier = ((streak - 1) % 7) + 1;
    const reward = SIGNIN_REWARDS[tier - 1];
    await client.query(
      `UPDATE signin_state SET last_day = $2::date, streak = $3, total = total + 1, updated_at = now() WHERE account_id = $1`,
      [accountId, today, streak],
    );
    await grantRewards(client, accountId, reward);
    await client.query('COMMIT');
    return { tier, reward, streak };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
