// 洛阳争夺（v79，AISLG-200）：每周六 21:00–23:00（北京时间，现实时间）开放攻打。
// 洛阳之主 = 占领洛阳玩家所在的联盟；联盟全员四资源产量 +5%，盟主每 7 天可发一道政令。
// 规则常量集中在这里；窗口判断是纯函数，API 与 Worker 共用。


export const LUOYANG_NAME = '洛阳';
/** 开放日：周六（0 = 周日） */
export const LUOYANG_WEEKDAY = 6;
/** 开放时段（北京时间，整点） */
export const LUOYANG_START_HOUR = 21;
export const LUOYANG_END_HOUR = 23;
/** 洛阳之主联盟全员四资源产量加成（百分数，与名城 / 科技 / 城守同一池相加） */
export const LUOYANG_BONUS_PERCENT = 5;
/** 洛阳可接收的协防部队上限（普通城 5 支） */
export const LUOYANG_ASSIST_CAP = 10;
/** 洛阳城防值上限（沿用分城口径） */
export const LUOYANG_DURABILITY_MAX = 100;
/** 窗口开始前多久预告 */
export const LUOYANG_NOTICE_MS = 30 * 60 * 1000;
/** 政令持续 / 冷却（现实时间 7 天） */
export const DECREE_DURATION_MS = 7 * 24 * 3600 * 1000;

const CST_OFFSET_MS = 8 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;

export function isLuoyangName(name: string | null | undefined): boolean {
  return name === LUOYANG_NAME;
}

export interface LuoyangWindow {
  startAt: Date;
  endAt: Date;
}

/** 当前时刻是否在洛阳争夺窗口内；窗口按北京时间周六 21:00–23:00 */
export function luoyangWindowOpen(now: Date): boolean {
  const shifted = new Date(now.getTime() + CST_OFFSET_MS);
  return shifted.getUTCDay() === LUOYANG_WEEKDAY && shifted.getUTCHours() >= LUOYANG_START_HOUR && shifted.getUTCHours() < LUOYANG_END_HOUR;
}

/** 当前窗口（不在窗口内返回 null） */
export function currentLuoyangWindow(now: Date): LuoyangWindow | null {
  if (!luoyangWindowOpen(now)) {
    return null;
  }
  const shifted = new Date(now.getTime() + CST_OFFSET_MS);
  const dayStart = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - CST_OFFSET_MS;
  return {
    startAt: new Date(dayStart + LUOYANG_START_HOUR * HOUR_MS),
    endAt: new Date(dayStart + LUOYANG_END_HOUR * HOUR_MS),
  };
}

/** 下一次开放时刻（窗口内返回本次开始时刻；窗口外返回下一个周六 21:00） */
export function nextLuoyangOpen(now: Date): Date {
  const current = currentLuoyangWindow(now);
  if (current) {
    return current.startAt;
  }
  const shifted = new Date(now.getTime() + CST_OFFSET_MS);
  const day = shifted.getUTCDay();
  let delta = (LUOYANG_WEEKDAY - day + 7) % 7;
  let candidate =
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
    CST_OFFSET_MS +
    LUOYANG_START_HOUR * HOUR_MS +
    delta * DAY_MS;
  if (candidate <= now.getTime()) {
    candidate += 7 * DAY_MS;
  }
  return new Date(candidate);
}

/** 窗口结束后到下一次开放之间：洛阳城防值已回满，攻击被拒 */
export function luoyangClosedError(now: Date): { nextOpenAt: string; retryAfterSeconds: number } {
  const next = nextLuoyangOpen(now);
  return {
    nextOpenAt: next.toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000)),
  };
}

// ---- 政令 ----

export const DECREE_KINDS = ['recruit', 'march', 'research'] as const;
export type DecreeKind = (typeof DECREE_KINDS)[number];

export function isDecreeKind(value: unknown): value is DecreeKind {
  return value === 'recruit' || value === 'march' || value === 'research';
}

export interface DecreeEffect {
  kind: DecreeKind;
  /** 对时长的乘数：征兵 / 研究 <1 为缩短；行军用速度加成（见下） */
  timeMultiplier: number;
  /** 行军速度加成百分数（仅 march） */
  marchSpeedPercent: number;
}

export const DECREE_EFFECTS: Record<DecreeKind, DecreeEffect> = {
  recruit: { kind: 'recruit', timeMultiplier: 0.85, marchSpeedPercent: 0 },
  march: { kind: 'march', timeMultiplier: 1, marchSpeedPercent: 10 },
  research: { kind: 'research', timeMultiplier: 0.85, marchSpeedPercent: 0 },
};

/** 政令时长乘数（未生效返回 1） */
export function decreeTimeMultiplier(kind: DecreeKind, active: DecreeKind | null, until: Date | null, now: Date): number {
  if (active !== kind || until === null || until.getTime() <= now.getTime()) {
    return 1;
  }
  return DECREE_EFFECTS[kind].timeMultiplier;
}

/** 政令行军速度加成（未生效返回 0） */
export function decreeMarchSpeedPercent(active: DecreeKind | null, until: Date | null, now: Date): number {
  if (active !== 'march' || until === null || until.getTime() <= now.getTime()) {
    return 0;
  }
  return DECREE_EFFECTS.march.marchSpeedPercent;
}

/** 政令持续时长（现实时间，不随缩放） */
export function decreeDurationMs(): number {
  return DECREE_DURATION_MS;
}

