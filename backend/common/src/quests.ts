// 任务系统二期/三期（v56，AISLG-200）：主线 / 支线任务、成就、活动（开服限时 + 每日活跃）。
// 与一期（common/src/quest.ts 的日常任务 / 签到）配套，共用 grantRewards（发往主城）。
// 设计要点：
// - 条件判定全部「只读」：从 events 表（全量 / 活动窗口内计数）、city_buildings、account_techs、
//   account_heroes、signin_state、今日日常完成数派生，不新增埋点、不改动作 handler。
// - 任务/活动定义在代码常量，进度按需现算；仅「领取记录」落库。
// - 领取记录：主线 / 支线 / 成就 / 开服活动阶梯 → quest_claims_once（每账号每 quest_id 一条）；
//   每日活跃阶梯 → quest_claims（按天去重，复用一期表）。

import pg from 'pg';
import type { Resources } from './protocol';
import { claimAtomically, DAILY_TASKS, QuestError, todayInfo } from './quest';
import { effectiveLevelSql } from './production';

export { QuestError };

/** 资源快捷构造 */
function res(gold = 0, wood = 0, food = 0, stone = 0, iron = 0): Resources {
  return { gold, wood, food, stone, iron };
}

// ────────────────────────── 条件源 ──────────────────────────

export type MetricSource =
  | { kind: 'event'; type: string }
  | { kind: 'level'; building: string }
  | { kind: 'techCount' }
  | { kind: 'heroCount' }
  | { kind: 'signinTotal' }
  | { kind: 'dailyPoints' };

/**
 * 活动窗口（开服冲刺）：北京时区。默认值见此处；环境变量 ACTIVITY_START / ACTIVITY_END（ISO 8601，带时区）可覆盖，
 * 改期不用改代码。API 与 Worker 须读到同一份配置。格式不合法时回落默认值。
 */
const DEFAULT_ACTIVITY_START = '2026-10-13T00:00:00+08:00';
const DEFAULT_ACTIVITY_END = '2026-10-27T23:59:59+08:00';

function activityIso(envKey: string, fallback: string): string {
  const raw = process.env[envKey];
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : fallback;
}

export const ACTIVITY_START = activityIso('ACTIVITY_START', DEFAULT_ACTIVITY_START);
export const ACTIVITY_END = activityIso('ACTIVITY_END', DEFAULT_ACTIVITY_END);

export interface QuestCtx {
  eventsAll: Map<string, number>;
  eventsSince: Map<string, number>;
  levels: Map<string, number>;
  techCount: number;
  heroCount: number;
  signinTotal: number;
  dailyPoints: number;
}

function metricValue(ctx: QuestCtx, src: MetricSource, windowed = false): number {
  switch (src.kind) {
    case 'event':
      return (windowed ? ctx.eventsSince : ctx.eventsAll).get(src.type) ?? 0;
    case 'level':
      return ctx.levels.get(src.building) ?? 0;
    case 'techCount':
      return ctx.techCount;
    case 'heroCount':
      return ctx.heroCount;
    case 'signinTotal':
      return ctx.signinTotal;
    case 'dailyPoints':
      return ctx.dailyPoints;
  }
}

// ────────────────────────── 定义 ──────────────────────────

export interface QuestDef {
  id: string;
  title: string;
  desc: string;
  reward: Resources;
  source: MetricSource;
  threshold: number;
  windowed?: boolean;
}

/** 主线任务链（顺序解锁、顺序领取）。 */
export const MAIN_QUESTS: readonly QuestDef[] = [
  { id: 'm1', title: '初入乱世', desc: '完成 1 次建造或升级', reward: res(500), source: { kind: 'event', type: 'build_completed' }, threshold: 1 },
  { id: 'm2', title: '固本培元', desc: '官府升到 3 级', reward: res(1000, 1000), source: { kind: 'level', building: 'government' }, threshold: 3 },
  { id: 'm3', title: '格物致知', desc: '研究 1 项科技', reward: res(0, 0, 0, 1200, 1200), source: { kind: 'techCount' }, threshold: 1 },
  { id: 'm4', title: '招兵买马', desc: '完成 1 次征兵', reward: res(0, 0, 1500), source: { kind: 'event', type: 'recruit_completed' }, threshold: 1 },
  { id: 'm5', title: '初战告捷', desc: '出征 1 次', reward: res(1500, 0, 0, 0, 1500), source: { kind: 'event', type: 'march_started' }, threshold: 1 },
  { id: 'm6', title: '开疆拓土', desc: '占领 1 块野地', reward: res(2000, 0, 0, 2000), source: { kind: 'event', type: 'wilderness_occupied' }, threshold: 1 },
  { id: 'm7', title: '礼贤下士', desc: '招募 1 名武将', reward: res(2000, 0, 2000), source: { kind: 'heroCount' }, threshold: 1 },
  { id: 'm8', title: '威震一方', desc: '官府升到 5 级', reward: res(2500, 2500, 0, 2500), source: { kind: 'level', building: 'government' }, threshold: 5 },
  { id: 'm9', title: '深耕细作', desc: '占领 3 块野地', reward: res(3000, 0, 0, 3000, 3000), source: { kind: 'event', type: 'wilderness_occupied' }, threshold: 3 },
  { id: 'm10', title: '持之以恒', desc: '累计签到 3 天', reward: res(3000, 3000, 3000, 3000, 3000), source: { kind: 'signinTotal' }, threshold: 3 },
];

/** 支线任务（并行，一次领取）。 */
export const SIDE_QUESTS: readonly QuestDef[] = [
  { id: 's_build', title: '大兴土木', desc: '累计建造或升级 10 次', reward: res(2000, 2000), source: { kind: 'event', type: 'build_completed' }, threshold: 10 },
  { id: 's_tech', title: '百家争鸣', desc: '研究 5 项科技', reward: res(0, 0, 0, 2000, 2000), source: { kind: 'techCount' }, threshold: 5 },
  { id: 's_army', title: '千军万马', desc: '累计征兵 10 次', reward: res(2500, 0, 2500), source: { kind: 'event', type: 'recruit_completed' }, threshold: 10 },
  { id: 's_scout', title: '探路先锋', desc: '累计出征 5 次', reward: res(2000, 0, 0, 0, 2000), source: { kind: 'event', type: 'march_started' }, threshold: 5 },
];

export interface AchievementTierDef {
  threshold: number;
  reward: Resources;
}

export interface AchievementDef {
  id: string;
  title: string;
  desc: string;
  source: MetricSource;
  tiers: AchievementTierDef[];
}

/** 成就（每条 3 档，逐档领取）。 */
export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'a_build', title: '建造大师', desc: '累计建造 / 升级次数', source: { kind: 'event', type: 'build_completed' }, tiers: [{ threshold: 10, reward: res(1000, 1000) }, { threshold: 50, reward: res(3000, 3000) }, { threshold: 200, reward: res(8000, 8000) }] },
  { id: 'a_war', title: '百战之师', desc: '累计出征次数', source: { kind: 'event', type: 'march_started' }, tiers: [{ threshold: 10, reward: res(1000, 0, 0, 0, 1000) }, { threshold: 50, reward: res(3000, 0, 0, 0, 3000) }, { threshold: 200, reward: res(8000, 0, 0, 0, 8000) }] },
  { id: 'a_land', title: '拓荒者', desc: '累计占领野地', source: { kind: 'event', type: 'wilderness_occupied' }, tiers: [{ threshold: 3, reward: res(1200, 0, 0, 1200) }, { threshold: 10, reward: res(3000, 0, 0, 3000) }, { threshold: 30, reward: res(7000, 0, 0, 7000) }] },
  { id: 'a_tech', title: '学者', desc: '研究科技项数', source: { kind: 'techCount' }, tiers: [{ threshold: 3, reward: res(0, 0, 0, 1500, 1500) }, { threshold: 8, reward: res(0, 0, 0, 3500, 3500) }, { threshold: 15, reward: res(0, 0, 0, 8000, 8000) }] },
  { id: 'a_hero', title: '将星', desc: '拥有武将数', source: { kind: 'heroCount' }, tiers: [{ threshold: 1, reward: res(1500, 0, 1500) }, { threshold: 3, reward: res(3500, 0, 3500) }, { threshold: 6, reward: res(8000, 0, 8000) }] },
  { id: 'a_sign', title: '签到达人', desc: '累计签到天数', source: { kind: 'signinTotal' }, tiers: [{ threshold: 7, reward: res(1500) }, { threshold: 30, reward: res(4000) }, { threshold: 100, reward: res(10000) }] },
];

export interface ActivityTierDef {
  id: string;
  title: string;
  reward: Resources;
  source: MetricSource;
  threshold: number;
  windowed?: boolean;
}

export interface ActivityDef {
  id: string;
  title: string;
  desc: string;
  /** true = 每日活跃（按天领取）；false = 限时活动（窗口内一次领取） */
  daily: boolean;
  start?: string;
  end?: string;
  tiers: ActivityTierDef[];
}

/** 活动（开服冲刺 + 每日活跃）。 */
export const ACTIVITIES: readonly ActivityDef[] = [
  {
    id: 'act_launch',
    title: '开服冲刺',
    desc: '开服两周内达成里程碑，领取冲刺奖励',
    daily: false,
    start: ACTIVITY_START,
    end: ACTIVITY_END,
    tiers: [
      { id: 'act_launch:1', title: '建造 20 次', reward: res(3000, 3000), source: { kind: 'event', type: 'build_completed' }, threshold: 20, windowed: true },
      { id: 'act_launch:2', title: '出征 20 次', reward: res(3000, 0, 0, 3000), source: { kind: 'event', type: 'march_started' }, threshold: 20, windowed: true },
      { id: 'act_launch:3', title: '占领 10 块野地', reward: res(4000, 0, 4000, 0, 4000), source: { kind: 'event', type: 'wilderness_occupied' }, threshold: 10, windowed: true },
    ],
  },
  {
    id: 'act_daily',
    title: '每日活跃',
    desc: '今日完成日常 / 签到攒活跃点（每完成 1 条日常或签到 +1）',
    daily: true,
    tiers: [
      { id: 'act_daily:3', title: '活跃 3 点', reward: res(800), source: { kind: 'dailyPoints' }, threshold: 3 },
      { id: 'act_daily:5', title: '活跃 5 点', reward: res(1500, 1500), source: { kind: 'dailyPoints' }, threshold: 5 },
      { id: 'act_daily:7', title: '活跃 7 点', reward: res(3000, 3000, 3000, 3000, 3000), source: { kind: 'dailyPoints' }, threshold: 7 },
    ],
  },
];

// ────────────────────────── 视图 ──────────────────────────

export interface MainStepView {
  id: string;
  title: string;
  desc: string;
  reward: Resources;
  done: boolean;
  claimed: boolean;
  unlocked: boolean;
}

export interface MainQuestView {
  steps: MainStepView[];
  currentIndex: number;
  total: number;
}

export interface SideQuestView {
  id: string;
  title: string;
  desc: string;
  reward: Resources;
  done: boolean;
  claimed: boolean;
}

export interface AchievementTierView {
  tier: number;
  threshold: number;
  reward: Resources;
  done: boolean;
  claimed: boolean;
}

export interface AchievementView {
  id: string;
  title: string;
  desc: string;
  value: number;
  tiers: AchievementTierView[];
}

export interface QuestsView {
  main: MainQuestView;
  side: SideQuestView[];
  achievements: AchievementView[];
}

export interface ActivityTierView {
  id: string;
  title: string;
  reward: Resources;
  done: boolean;
  claimed: boolean;
}

export interface ActivityView {
  id: string;
  title: string;
  desc: string;
  daily: boolean;
  ongoing: boolean;
  /** 限时活动的截止时间（ISO），每日活动为 null */
  endsAt: string | null;
  tiers: ActivityTierView[];
}

// ────────────────────────── 取数 ──────────────────────────

/** 读全量事件计数（按 type）。 */
async function loadEventCounts(pool: pg.Pool, accountId: string, sinceIso: string | null): Promise<Map<string, number>> {
  const params: unknown[] = [accountId];
  let where = 'account_id = $1';
  if (sinceIso) {
    params.push(sinceIso);
    where += ` AND created_at >= $2::timestamptz`;
  }
  const q = await pool.query(`SELECT type, count(*)::int AS n FROM events WHERE ${where} GROUP BY type`, params);
  const map = new Map<string, number>();
  for (const row of q.rows as { type: string; n: number }[]) {
    map.set(row.type, row.n);
  }
  return map;
}

/** 今日活跃点 = 今日完成的日常任务数 + 今日是否签到。 */
async function dailyPoints(pool: pg.Pool, accountId: string, today: string): Promise<number> {
  const ev = await pool.query(
    `SELECT DISTINCT type FROM events WHERE account_id = $1 AND (created_at AT TIME ZONE 'Asia/Shanghai')::date = $2::date`,
    [accountId, today],
  );
  const types = new Set(ev.rows.map((r: { type: string }) => r.type));
  let done = 0;
  for (const t of DAILY_TASKS) {
    if (t.eventType === '' || types.has(t.eventType)) {
      done += 1;
    }
  }
  const si = await pool.query(`SELECT to_char(last_day, 'YYYY-MM-DD') AS last_day FROM signin_state WHERE account_id = $1`, [accountId]);
  const lastDay = (si.rows[0] as { last_day: string | null } | undefined)?.last_day ?? null;
  return done + (lastDay === today ? 1 : 0);
}

async function loadCtx(pool: pg.Pool, accountId: string): Promise<{ ctx: QuestCtx; today: string }> {
  const { today } = await todayInfo(pool);
  const eventsAll = await loadEventCounts(pool, accountId, null);
  const eventsSince = await loadEventCounts(pool, accountId, ACTIVITY_START);
  const lv = await pool.query(
    `SELECT cb.kind, ${effectiveLevelSql('cb.level', 'cb.kind', 'c.famous_name')} AS level FROM city_buildings cb
     JOIN cities c ON c.id = cb.city_id
     WHERE cb.city_id = (SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1)`,
    [accountId],
  );
  const levels = new Map<string, number>();
  for (const row of lv.rows as { kind: string; level: number }[]) {
    levels.set(row.kind, row.level);
  }
  const tech = await pool.query(`SELECT count(*)::int AS n FROM account_techs WHERE account_id = $1 AND level > 0`, [accountId]);
  const hero = await pool.query(`SELECT count(*)::int AS n FROM account_heroes WHERE account_id = $1`, [accountId]);
  const si = await pool.query(`SELECT total FROM signin_state WHERE account_id = $1`, [accountId]);
  const signinTotal = (si.rows[0] as { total: number } | undefined)?.total ?? 0;
  const points = await dailyPoints(pool, accountId, today);
  return {
    today,
    ctx: {
      eventsAll,
      eventsSince,
      levels,
      techCount: (tech.rows[0] as { n: number }).n,
      heroCount: (hero.rows[0] as { n: number }).n,
      signinTotal,
      dailyPoints: points,
    },
  };
}

/** 已领取的一次性 quest_id 集合。 */
async function loadClaimedOnce(pool: pg.Pool, accountId: string): Promise<Set<string>> {
  const q = await pool.query(`SELECT quest_id FROM quest_claims_once WHERE account_id = $1`, [accountId]);
  return new Set(q.rows.map((r: { quest_id: string }) => r.quest_id));
}

/** 今日已领取（按天去重，用于每日活跃）。 */
async function loadClaimedToday(pool: pg.Pool, accountId: string, today: string): Promise<Set<string>> {
  const q = await pool.query(`SELECT quest_id FROM quest_claims WHERE account_id = $1 AND day = $2::date`, [accountId, today]);
  return new Set(q.rows.map((r: { quest_id: string }) => r.quest_id));
}

// ────────────────────────── 组装状态 ──────────────────────────

export async function loadQuestsView(pool: pg.Pool, accountId: string): Promise<QuestsView> {
  const { ctx } = await loadCtx(pool, accountId);
  const claimed = await loadClaimedOnce(pool, accountId);

  const steps: MainStepView[] = MAIN_QUESTS.map((q, i) => {
    const prevClaimed = i === 0 ? true : claimed.has(MAIN_QUESTS[i - 1].id);
    return {
      id: q.id,
      title: q.title,
      desc: q.desc,
      reward: q.reward,
      done: metricValue(ctx, q.source, q.windowed) >= q.threshold,
      claimed: claimed.has(q.id),
      unlocked: prevClaimed,
    };
  });
  let currentIndex = 0;
  while (currentIndex < steps.length && steps[currentIndex].claimed) {
    currentIndex += 1;
  }

  const side: SideQuestView[] = SIDE_QUESTS.map((q) => ({
    id: q.id,
    title: q.title,
    desc: q.desc,
    reward: q.reward,
    done: metricValue(ctx, q.source, q.windowed) >= q.threshold,
    claimed: claimed.has(q.id),
  }));

  const achievements: AchievementView[] = ACHIEVEMENTS.map((a) => {
    const value = metricValue(ctx, a.source);
    return {
      id: a.id,
      title: a.title,
      desc: a.desc,
      value,
      tiers: a.tiers.map((t, i) => ({
        tier: i + 1,
        threshold: t.threshold,
        reward: t.reward,
        done: value >= t.threshold,
        claimed: claimed.has(`${a.id}:${i}`),
      })),
    };
  });

  return { main: { steps, currentIndex, total: steps.length }, side, achievements };
}

export async function loadActivitiesView(pool: pg.Pool, accountId: string): Promise<ActivityView[]> {
  const { ctx, today } = await loadCtx(pool, accountId);
  const claimedOnce = await loadClaimedOnce(pool, accountId);
  const claimedToday = await loadClaimedToday(pool, accountId, today);
  const now = Date.now();
  return ACTIVITIES.map((a) => {
    const startMs = a.start ? Date.parse(a.start) : null;
    const endMs = a.end ? Date.parse(a.end) : null;
    const ongoing = a.daily ? true : (startMs === null || now >= startMs) && (endMs === null || now <= endMs);
    return {
      id: a.id,
      title: a.title,
      desc: a.desc,
      daily: a.daily,
      ongoing,
      endsAt: a.end ?? null,
      tiers: a.tiers.map((t) => ({
        id: t.id,
        title: t.title,
        reward: t.reward,
        done: ongoing && metricValue(ctx, t.source, t.windowed) >= t.threshold,
        claimed: a.daily ? claimedToday.has(t.id) : claimedOnce.has(t.id),
      })),
    };
  });
}

// ────────────────────────── 领取 ──────────────────────────

/** 领取主线 / 支线 / 成就一档。kind: main | side | achv；id 见各视图。 */
export async function claimQuest(pool: pg.Pool, accountId: string, kind: string, id: string): Promise<{ reward: Resources }> {
  const { ctx } = await loadCtx(pool, accountId);
  const claimed = await loadClaimedOnce(pool, accountId);
  let reward: Resources | null = null;
  let questId = id;

  if (kind === 'main') {
    const idx = MAIN_QUESTS.findIndex((q) => q.id === id);
    if (idx < 0) throw new QuestError('UNKNOWN_TASK');
    if (idx > 0 && !claimed.has(MAIN_QUESTS[idx - 1].id)) throw new QuestError('NOT_DONE'); // 顺序解锁
    if (metricValue(ctx, MAIN_QUESTS[idx].source, MAIN_QUESTS[idx].windowed) < MAIN_QUESTS[idx].threshold) throw new QuestError('NOT_DONE');
    reward = MAIN_QUESTS[idx].reward;
  } else if (kind === 'side') {
    const q = SIDE_QUESTS.find((x) => x.id === id);
    if (!q) throw new QuestError('UNKNOWN_TASK');
    if (metricValue(ctx, q.source, q.windowed) < q.threshold) throw new QuestError('NOT_DONE');
    reward = q.reward;
  } else if (kind === 'achv') {
    const ci = id.lastIndexOf(':');
    if (ci < 0) throw new QuestError('UNKNOWN_TASK');
    const aId = id.slice(0, ci);
    const tierIdx = Number(id.slice(ci + 1));
    const a = ACHIEVEMENTS.find((x) => x.id === aId);
    if (!a || !Number.isInteger(tierIdx) || tierIdx < 0 || tierIdx >= a.tiers.length) throw new QuestError('UNKNOWN_TASK');
    if (metricValue(ctx, a.source) < a.tiers[tierIdx].threshold) throw new QuestError('NOT_DONE');
    reward = a.tiers[tierIdx].reward;
    questId = `${aId}:${tierIdx}`;
  } else {
    throw new QuestError('UNKNOWN_TASK');
  }

  if (claimed.has(questId)) throw new QuestError('ALREADY');
  await claimAtomically(
    pool,
    accountId,
    reward,
    `INSERT INTO quest_claims_once (account_id, quest_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [accountId, questId, kind],
  );
  return { reward };
}

/** 领取活动阶梯。id = tier id（如 act_launch:1 / act_daily:3）。 */
export async function claimActivity(pool: pg.Pool, accountId: string, id: string): Promise<{ reward: Resources }> {
  const def = ACTIVITIES.find((a) => a.tiers.some((t) => t.id === id));
  const tier = def?.tiers.find((t) => t.id === id);
  if (!def || !tier) throw new QuestError('UNKNOWN_TASK');
  const { ctx, today } = await loadCtx(pool, accountId);
  const now = Date.now();
  if (!def.daily) {
    const startMs = def.start ? Date.parse(def.start) : null;
    const endMs = def.end ? Date.parse(def.end) : null;
    if ((startMs !== null && now < startMs) || (endMs !== null && now > endMs)) throw new QuestError('NOT_DONE'); // 不在活动期
  }
  if (metricValue(ctx, tier.source, tier.windowed) < tier.threshold) throw new QuestError('NOT_DONE');

  if (def.daily) {
    const claimedToday = await loadClaimedToday(pool, accountId, today);
    if (claimedToday.has(id)) throw new QuestError('ALREADY');
    await claimAtomically(
      pool,
      accountId,
      tier.reward,
      `INSERT INTO quest_claims (account_id, quest_id, day) VALUES ($1, $2, $3::date) ON CONFLICT DO NOTHING`,
      [accountId, id, today],
    );
  } else {
    const claimed = await loadClaimedOnce(pool, accountId);
    if (claimed.has(id)) throw new QuestError('ALREADY');
    await claimAtomically(
      pool,
      accountId,
      tier.reward,
      `INSERT INTO quest_claims_once (account_id, quest_id, kind) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [accountId, id, 'act'],
    );
  }
  return { reward: tier.reward };
}
