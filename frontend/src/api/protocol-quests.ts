// 任务与活动二期/三期（v54，AISLG-200）的前端载荷类型：与后端 common/src/quests.ts 的视图对齐。
// op 号与导出在 ./protocol。

import type { CityView, Resources } from './protocol';

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

/** GET_QUESTS 的 data */
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
  endsAt: string | null;
  tiers: ActivityTierView[];
}

export interface GetQuestsResponseData {
  main: MainQuestView;
  side: SideQuestView[];
  achievements: AchievementView[];
}

export interface ClaimQuestRequestData {
  kind: 'main' | 'side' | 'achv';
  id: string;
}

export interface ClaimQuestResponseData {
  quests: QuestsView;
  granted: Resources;
  city: CityView;
}

export interface GetActivitiesResponseData {
  activities: ActivityView[];
}

export interface ClaimActivityResponseData {
  activities: ActivityView[];
  granted: Resources;
  city: CityView;
}
