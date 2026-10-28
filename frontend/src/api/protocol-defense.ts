// 城防器械协议的类型镜像（v73，AISLG-193）。唯一事实来源是 backend/common/src/protocol-defense.ts
// 与 backend/common/src/city-defense.ts；数值以后端文档为准同步本文件。

import type { InitiatorRole, Resources } from './protocol';
import type { ScoutDetail } from './protocol-tech';

export const DEFENSE_KINDS = ['trap', 'chevaux', 'rolling_log', 'boulder'] as const;
export type DefenseKind = (typeof DEFENSE_KINDS)[number];

/** 打造卡片预览用的本地数值镜像（成本 / 单件时长 / 伤害，与服务端 city-defense.ts 一致） */
export const DEFENSE_INFO: Record<DefenseKind, { label: string; cost: Resources; seconds: number; damage: number; effect: string }> = {
  trap: {
    label: '陷阱',
    cost: { gold: 20, wood: 60, food: 0, stone: 0, iron: 40 },
    seconds: 5,
    damage: 500,
    effect: '开战时对攻方步兵类兵种造成 500 点伤害',
  },
  chevaux: {
    label: '拒马',
    cost: { gold: 40, wood: 200, food: 0, stone: 0, iron: 80 },
    seconds: 10,
    damage: 800,
    effect: '开战时对攻方骑兵类兵种造成 800 点伤害',
  },
  rolling_log: {
    label: '滚木',
    cost: { gold: 30, wood: 200, food: 0, stone: 0, iron: 0 },
    seconds: 8,
    damage: 400,
    effect: '攻方近战第一次贴到城墙下时，对贴墙近战兵种造成 400 点伤害',
  },
  boulder: {
    label: '擂石',
    cost: { gold: 40, wood: 0, food: 0, stone: 380, iron: 0 },
    seconds: 12,
    damage: 1500,
    effect: '攻方冲车第一次贴到城墙下时，对冲车造成 1500 点伤害（击毁 1 辆）',
  },
};

/** 库存上限 = 城墙等级 × 60（四种器械共用） */
export const DEFENSE_STOCK_PER_WALL_LEVEL = 60;

export interface DefenseCraftView {
  id: string;
  cityId: string;
  kind: DefenseKind;
  count: number;
  status: 'crafting' | 'queued' | 'completed' | 'cancelled';
  initiator: InitiatorRole;
  cost: Resources;
  unitSeconds: number;
  startedAt: string;
  dueAt: string | null;
  completedAt: string | null;
}

export interface DefenseStockView {
  cap: number;
  stock: Record<DefenseKind, number>;
  total: number;
  queue: DefenseCraftView[];
}

/** 战报中的器械用量（一种器械一项） */
export interface DefenseUseView {
  kind: DefenseKind;
  used: number;
  damage: number;
  killed: number;
}

/** 侦察情报里的器械（三档） */
export interface DefenseScoutView {
  detail: ScoutDetail;
  has: boolean;
  kinds?: DefenseKind[];
  counts?: Record<DefenseKind, number>;
}

export interface CraftDefenseRequestData {
  kind: DefenseKind;
  count: number;
  cityId?: string;
}

export interface CraftDefenseResponseData {
  craft: DefenseCraftView;
  stock: Record<DefenseKind, number>;
  cap: number;
}

export interface CancelDefenseCraftRequestData {
  craftId: string;
}

export interface CancelDefenseCraftResponseData {
  craft: DefenseCraftView;
}

export interface DefenseStatePushData {
  reason: 'craft_started' | 'craft_queued' | 'craft_completed' | 'craft_cancelled';
  craft: DefenseCraftView;
  stock: Record<DefenseKind, number>;
  cap: number;
}
