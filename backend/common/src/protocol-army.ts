// 一期兵种与征兵协议的类型与协议号取值（v11；从 protocol.ts 拆出以控制单文件行数）。
// 兵种数值（成本/人口/时长/军营等级门槛）见 common/src/troops.ts 的 TROOP_INFO。
// 本文件只 import protocol.ts 的类型（类型导入在运行时被擦除，不构成加载环）。

import type { InitiatorRole } from './protocol';

/**
 * 一期兵种（docs/phase-1-launch-scope.md「征兵、行军与战斗」，旧游戏 1–7 号）：
 * 民夫 / 义兵 / 斥候 / 长枪兵 / 刀盾兵 / 弓箭兵 / 轻骑兵。
 * 铁骑兵、辎重车、床弩、冲车已在二期上线（v32，AISLG-86/88/89/90）；投石车及名城特殊兵种仍未上。
 */
export const TROOP_KINDS = [
  'porter',
  'militia',
  'scout',
  'pikeman',
  'swordsman',
  'archer',
  'cavalry',
  // v32（二期兵种 AISLG-86/88/89/90）：铁骑兵 / 辎重车 / 床弩 / 冲车
  'iron_cavalry',
  'supply_wagon',
  'ballista',
  'siege_ram',
] as const;

export type TroopKind = (typeof TROOP_KINDS)[number];

export function isTroopKind(value: unknown): value is TroopKind {
  return typeof value === 'string' && (TROOP_KINDS as readonly string[]).includes(value);
}

/** 按兵种统计的城内驻军数量 */
export type ArmyCounts = Record<TroopKind, number>;

/** 征兵状态视图（推送与查询共用同一结构，形态对齐 BuildView） */
export interface RecruitView {
  id: string;
  /** 所属城池（v24，AISLG-58） */
  cityId: string;
  troop: TroopKind;
  /** 本次征募数量 */
  count: number;
  /** recruiting=征募中（队首）；queued=排队；completed=已完成；cancelled=已取消（保留为历史） */
  status: 'recruiting' | 'queued' | 'completed' | 'cancelled';
  /** 发起原始指令的连接声明的登录类型 */
  initiator: InitiatorRole;
  startedAt: string;
  /** 预计完成时间；排队中为 null */
  dueAt: string | null;
  completedAt: string | null;
}

/** RECRUIT（op 28）请求载荷 */
export interface RecruitRequestData {
  /** 兵种；缺失或不是已知兵种返回 INVALID_PARAMS */
  troop: TroopKind;
  /** 征募数量，1..100（占位上限） */
  count: number;
}

export interface RecruitResponseData {
  recruit: RecruitView;
}

/** CANCEL_RECRUIT（op 29）请求载荷：取消排队中的征兵条目并全额返还（资源与人口） */
export interface CancelRecruitRequestData {
  recruitId: string;
}

export interface CancelRecruitResponseData {
  recruit: RecruitView;
}

/** PUSH_RECRUIT_STATE（op 2004）推送载荷 */
export interface RecruitStatePushData {
  /** recruit_started=立即开始或队首被后台激活；recruit_queued=进入排队；recruit_completed=完成（兵力入城）；recruit_cancelled=排队条目被取消 */
  reason: 'recruit_started' | 'recruit_queued' | 'recruit_completed' | 'recruit_cancelled';
  recruit: RecruitView;
}
