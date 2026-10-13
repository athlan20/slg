// 任务与签到（v53，AISLG-200）的前端载荷类型：与后端 common/src/quest.ts 的视图对齐。
// op 号与导出在 ./protocol（Op 常量与类型再导出）。

import type { CityView, Resources } from './protocol';

/** 一条日常任务：{ id, title, desc, done（今日达成）, claimed（已领奖）, reward } */
export interface DailyTaskView {
  id: string;
  title: string;
  desc: string;
  done: boolean;
  claimed: boolean;
  reward: Resources;
}

/** 签到 7 天循环中的一格 */
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

/** 任务与签到完整状态（GET_DAILY 的 data.quest） */
export interface QuestStateView {
  /** 今日（北京日 YYYY-MM-DD） */
  day: string;
  daily: DailyTaskView[];
  signin: SigninView;
}

export interface GetDailyResponseData {
  quest: QuestStateView;
}

export interface ClaimDailyRequestData {
  taskId: string;
}

export interface ClaimDailyResponseData {
  quest: QuestStateView;
  granted: Resources;
  city: CityView;
}

export interface GetSigninResponseData {
  signin: SigninView;
}

export interface SigninResponseData {
  signin: SigninView;
  tier: number;
  granted: Resources;
  city: CityView;
}
