// 盟友协防协议的类型（v74，AISLG-194；规则见 common/src/city-assist.ts）。
// 类型导入在运行时被擦除，不构成加载环。

import type { ArmyCounts, InitiatorRole, TroopKind } from './protocol';

/** 城内的一支协防部队（城主与盟友可见；列出谁在协防、带了多少兵） */
export interface AssistView {
  id: string;
  /** 派出账号 */
  accountId: string;
  /** 派出账号昵称 */
  username: string;
  /** 派出城与城名 */
  fromCityId: string;
  fromCityName: string;
  /** 驻扎的兵种与数量（恒含全部兵种键） */
  troops: ArmyCounts;
  /** 入驻时刻（ISO 8601） */
  arrivedAt: string;
  initiator: InitiatorRole;
}

/** 本城派出、正在盟友城里驻扎的协防部队（派出方视图） */
export interface AssistOutView {
  id: string;
  /** 驻扎的盟友城 */
  hostCityId: string;
  hostCityName: string;
  hostUsername: string;
  troops: ArmyCounts;
  arrivedAt: string;
}

/** DISMISS_ASSIST（op 119）请求：派出方召回 / 城主遣返 */
export interface DismissAssistRequestData {
  assistId: string;
}

export interface DismissAssistResponseData {
  /** 遣返 / 召回后返回出发城的行军 id（部队全灭时不会出现这条记录） */
  marchId: string;
  assistId: string;
}

/** 守城战里协防方的战报附加字段：本场自己部队的伤亡（按开战数量比例分摊） */
export interface AssistLossView {
  assistId: string;
  losses: ArmyCounts;
  survivors: ArmyCounts;
}

export type { TroopKind };
