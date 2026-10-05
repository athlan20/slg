// 会话类协议的类型镜像：事件流（EventType / EventView）、Agent 计划与信息
// （AgentPlanView / AgentInfoView）、消息帧（ClientFrame / ResponseFrame / PushFrame）、
// 登录载荷（Login*）与 AGENT_REPORT_PLAN 载荷。唯一事实来源是
// backend/common/src/protocol.ts；protocol.ts 原名再导出，既有 import 路径不变。

import type { ErrorCode, InitiatorRole } from './protocol';

export type EventType =
  | 'build_started'
  | 'build_queued'
  | 'build_completed'
  | 'build_cancelled'
  | 'recruit_started'
  | 'recruit_queued'
  | 'recruit_completed'
  | 'recruit_cancelled'
  | 'march_started'
  | 'march_completed'
  | 'wilderness_occupied'
  | 'wilderness_lost'
  | 'npc_city_occupied'
  | 'npc_raid'
  | 'npc_attack_warning'
  | 'player_attack_warning'
  | 'pvp_raid'
  | 'truce_started'
  | 'newbie_protection_ended'
  | 'city_conquered'
  | 'resource_exchanged'
  | 'research_started'
  | 'research_completed'
  | 'research_cancelled'
  | 'bandit_plundered'
  | 'yt_reward'
  | 'starvation_warning'
  | 'mutiny'
  | 'hero_recruited'
  | 'hero_dismissed'
  | 'hero_arrears'
  | 'hero_wounded'
  | 'hero_level_up'
  | 'hero_granted'
  | 'guard_changed'
  | 'city_renamed'
  | 'account_reset'
  | 'agent_connected'
  | 'agent_disconnected';

export interface EventView {
  id: number;
  type: EventType;
  initiator: InitiatorRole | null;
  cityId: string | null;
  buildId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** Agent 计划快照（v10）：自报的展示信息，未经验证、不参与游戏逻辑 */
export interface AgentPlanView {
  /** 下一步动作（≤200 字符；未设置/已清除为 null） */
  nextAction: string | null;
  /** 整体计划（≤500 字符；未设置/已清除为 null） */
  overallPlan: string | null;
  /** 最近一次上报时间（ISO 8601） */
  updatedAt: string;
}

export interface AgentInfoView {
  agentOnline: boolean;
  connections: Array<{ role: 'agent'; connectedAt: string }>;
  /** Agent 最近一次上报的计划（v10；从未上报为 null） */
  plan: AgentPlanView | null;
  recentEvents: EventView[];
  /** 账号是否已绑定微信（v43） */
  wechatBound: boolean;
  /** 账号是否已绑定 Google（v44） */
  googleBound: boolean;
  /** 账号是否已绑定 GitHub（v45） */
  githubBound: boolean;
  /** 绑定的 GitHub 用户名（v45；未绑定为 null） */
  githubLogin: string | null;
}

// ---- 消息帧 ----

export interface ClientFrame {
  op: number;
  seq?: number;
  data?: Record<string, unknown>;
}

export interface ResponseFrame {
  op: number;
  seq?: number;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: ErrorCode; message: string };
}

export interface PushFrame {
  op: number;
  push: true;
  data: Record<string, unknown>;
}

// ---- 常用请求 / 响应的 data 载荷（字段说明见 docs/agent-api.md 对应小节） ----

export interface LoginPasswordData {
  username: string;
  password: string;
  asAgent: boolean;
}

export interface LoginTokenData {
  token: string;
  asAgent: boolean;
}

export interface LoginResultData {
  accountId: string;
  username: string;
  role: InitiatorRole;
  sessionToken: string;
  expiresAt: string;
}

/** AGENT_REPORT_PLAN（op 27）请求载荷：两段都可只更新其一；提供空串表示清除该段 */
export interface AgentReportPlanRequestData {
  /** 下一步动作，trim 后 0..200 字符（空串 = 清除；缺省 = 保持不变） */
  nextAction?: string;
  /** 整体计划，trim 后 0..500 字符（空串 = 清除；缺省 = 保持不变） */
  overallPlan?: string;
}

export interface AgentReportPlanResponseData {
  plan: AgentPlanView;
}

/** PUSH_AGENT_PLAN（op 2003）推送载荷：完整计划快照，与 AgentPlanView 同构 */
export type AgentPlanPushData = AgentPlanView;
