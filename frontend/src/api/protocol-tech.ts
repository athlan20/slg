// 科技研究协议的类型镜像（v27 AISLG-77）。唯一事实来源是 backend/common/src/protocol-tech.ts
// 与 backend/common/src/tech.ts；协议调整时以后端生成文档（docs/agent-api.md）为准同步本文件。

import type { InitiatorRole, Resources } from './protocol';

/** 六项科技：农耕 / 负重 / 行军 / 储存 / 侦察 / 城防 */
export const TECH_KINDS = ['farming', 'carrying', 'marching', 'storage', 'scouting', 'defense'] as const;

export type TechKind = (typeof TECH_KINDS)[number];

/** 各科技当前等级（0 = 未研究；账号级） */
export type TechLevels = Record<TechKind, number>;

export interface TechEntryView {
  kind: TechKind;
  label: string;
  level: number;
  maxLevel: number;
  /** 每级效果（百分数；侦察为 0，按等级解锁情报内容） */
  percentPerLevel: number;
  effect: string;
  currentPercent: number;
  /** 下一级信息；满级为 null */
  next: {
    level: number;
    cost: Resources;
    /** 研究耗时（秒，已按全局时间缩放折算） */
    seconds: number;
    academyRequired: number;
    academyOk: boolean;
  } | null;
}

export interface ResearchView {
  id: string;
  cityId: string;
  tech: TechKind;
  level: number;
  status: 'researching' | 'completed' | 'cancelled';
  initiator: InitiatorRole;
  cost: Resources;
  startedAt: string;
  dueAt: string;
  completedAt: string | null;
}

export interface TechStateView {
  academyLevel: number;
  techs: TechEntryView[];
  research: ResearchView | null;
}

export interface TechStatePushData {
  reason: 'research_started' | 'research_completed' | 'research_cancelled';
  research: ResearchView;
  level: number;
}
