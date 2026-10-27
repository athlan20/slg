// 科技研究协议的类型镜像（v27 AISLG-77）。唯一事实来源是 backend/common/src/protocol-tech.ts
// 与 backend/common/src/tech.ts；协议调整时以后端生成文档（docs/agent-api.md）为准同步本文件。

import type { InitiatorRole, Resources } from './protocol';

/** 十六项科技（v72，AISLG-192）：农耕 / 负重 / 行军 / 储存 / 侦察 / 城防 +
 *  练兵 / 战斗 / 防护 / 驾驭 / 抛射 / 补给 / 建筑 / 研究 / 掠夺 / 维修 */
export const TECH_KINDS = [
  'farming',
  'carrying',
  'marching',
  'storage',
  'scouting',
  'defense',
  'drill',
  'combat',
  'protection',
  'riding',
  'archery',
  'supply',
  'construction',
  'research',
  'looting',
  'repair',
] as const;

export type TechKind = (typeof TECH_KINDS)[number];

/** 科技归类（服务端下发，前端分「发展 / 军事」两栏） */
export type TechCategory = 'development' | 'military';

/** 各科技当前等级（0 = 未研究；账号级） */
export type TechLevels = Record<TechKind, number>;

export interface TechEntryView {
  kind: TechKind;
  label: string;
  /** 归类（v72）：development 发展 / military 军事 */
  category: TechCategory;
  level: number;
  maxLevel: number;
  /** 每级效果（百分数，带符号；侦察为 0，按等级解锁情报内容） */
  percentPerLevel: number;
  effect: string;
  /** 当前累计效果（百分数，带符号：负数为减少时长 / 耗粮 / 受伤） */
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
