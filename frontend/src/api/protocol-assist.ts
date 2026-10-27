// 盟友协防协议的类型镜像（v74，AISLG-194）。唯一事实来源是 backend/common/src/protocol-assist.ts
// 与 backend/common/src/city-assist.ts。

import type { ArmyCounts, InitiatorRole } from './protocol';

export interface AssistView {
  id: string;
  accountId: string;
  username: string;
  fromCityId: string;
  fromCityName: string;
  troops: ArmyCounts;
  arrivedAt: string;
  initiator: InitiatorRole;
}

export interface AssistOutView {
  id: string;
  hostCityId: string;
  hostCityName: string;
  hostUsername: string;
  troops: ArmyCounts;
  arrivedAt: string;
}

export interface DismissAssistRequestData {
  assistId: string;
}

export interface DismissAssistResponseData {
  marchId: string | null;
  assistId: string;
}

/** 每座城最多接收的协防部队数（洛阳 10 支留待洛阳争夺需求） */
export const ASSIST_MAX_PER_CITY = 5;
