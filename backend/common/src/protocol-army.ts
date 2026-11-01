// 一期兵种与征兵协议的类型与协议号取值（v11；从 protocol.ts 拆出以控制单文件行数）。
// 兵种数值（成本/人口/时长/军营等级门槛）见 common/src/troops.ts 的 TROOP_INFO。
// 本文件只 import protocol.ts 的类型（类型导入在运行时被擦除，不构成加载环）。

import type { CityView } from './protocol-city';
import type { InitiatorRole, Resources } from './protocol';

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
  // v64（AISLG-168）：8 座名城各一种专属精锐兵，只能在占领该名城的分城军营征募（见 famous-effects.ts 的 FAMOUS_ELITE_TROOP）
  'yulin_guard',
  'danyang_soldier',
  'baimao_soldier',
  'huwei_guard',
  'zhuge_crossbow',
  'xiandeng_warrior',
  'hubao_cavalry',
  'xiliang_cavalry',
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

/** CANCEL_RECRUIT（op 29）请求载荷：取消征兵条目（排队中 / 征募中，v71）并全额返还（资源与人口） */
export interface CancelRecruitRequestData {
  recruitId: string;
}

export interface CancelRecruitResponseData {
  recruit: RecruitView;
}

/** PUSH_RECRUIT_STATE（op 2004）推送载荷 */
export interface RecruitStatePushData {
  /** recruit_started=立即开始或队首被后台激活；recruit_queued=进入排队；recruit_completed=完成（兵力入城）；recruit_cancelled=条目被取消（排队或征募中） */
  reason: 'recruit_started' | 'recruit_queued' | 'recruit_completed' | 'recruit_cancelled';
  recruit: RecruitView;
}

/** DISBAND_TROOPS（op 142，v84，AISLG-209）请求载荷：按兵种给出要遣散的数量（正整数，只解散城内驻军） */
export interface DisbandTroopsRequestData {
  /** 兵种 → 遣散数量；空对象 / 未知兵种 / 非正整数返回 INVALID_PARAMS，某兵种超过城内数量返回 INSUFFICIENT_TROOPS */
  troops: Partial<Record<TroopKind, number>>;
}

/** DISBAND_TROOPS 响应载荷：本次解散的兵、返还的资源（征兵成本的 50%）与遣散后的城池状态 */
export interface DisbandTroopsResponseData {
  /** 本次实际解散的兵种与数量（等于请求里数量大于 0 的项） */
  disbanded: Partial<Record<TroopKind, number>>;
  /** 返还的资源：floor(Σ 单兵成本 × 数量 × 50%)，五种资源分别取整；不返还人口 */
  refunded: Resources;
  /** 遣散后的城池状态（与 GET_STATE 的 city 同结构） */
  city: CityView;
}

/** 池子种类（v85，AISLG-212）：wounded 伤兵 / captive 俘虏 / deserter 逃兵 */
export type TroopPoolKind = 'wounded' | 'captive' | 'deserter';

/** 一个池子的聚合视图（v85，AISLG-212；CityView.wounded / captives / deserters 同形态） */
export interface TroopPoolView {
  /** 各兵种现有数量（未过期批次的合计） */
  troops: ArmyCounts;
  /** 最早一批的过期时刻（ISO 8601）；池子为空为 null */
  earliestExpireAt: string | null;
}

/** RESTORE_TROOPS（op 143，v85，AISLG-212）请求载荷：治疗 / 招降 / 劝回（按 pool 区分），立即完成 */
export interface RestoreTroopsRequestData {
  /** 池子：wounded=治疗（征兵资源 × 50%，不扣人口）/ captive=招降（× 60%，扣人口，军营等级不设限）/ deserter=劝回（× 50%，断粮中拒绝） */
  pool: TroopPoolKind;
  /** 兵种 → 数量（正整数）；某兵种超过池内现有返回 INVALID_PARAMS，空对象 / 未知兵种同样 INVALID_PARAMS */
  troops: Partial<Record<TroopKind, number>>;
}

/** RESTORE_TROOPS 响应载荷：本次回城的兵、花费与扣的人口，以及操作后的城池状态 */
export interface RestoreTroopsResponseData {
  /** 本次回城内驻军的兵种与数量 */
  restored: Partial<Record<TroopKind, number>>;
  /** 花费的资源：floor(Σ 单兵成本 × 数量 × 比例%)，五种资源分别取整（先累加后取整，同遣散口径） */
  cost: Resources;
  /** 扣的人口：招降 = Σ 单兵人口 × 数量（与征兵同口径）；治疗 / 劝回为 0 */
  populationCost: number;
  /** 操作后的城池状态（与 GET_STATE 的 city 同结构） */
  city: CityView;
}

/** RELEASE_TROOPS（op 144，v85，AISLG-212）请求载荷：放弃治疗（伤兵消失）/ 释放俘虏（免费） */
export interface ReleaseTroopsRequestData {
  /** 池子：wounded=放弃治疗 / captive=释放；deserter 不能释放（只能劝回或等过期） */
  pool: Exclude<TroopPoolKind, 'deserter'>;
  troops: Partial<Record<TroopKind, number>>;
}

/** RELEASE_TROOPS 响应载荷：本次消失的兵与操作后的城池状态（不返还任何东西） */
export interface ReleaseTroopsResponseData {
  released: Partial<Record<TroopKind, number>>;
  city: CityView;
}
