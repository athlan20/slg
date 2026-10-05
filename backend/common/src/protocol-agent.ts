// Agent 协作类协议的载荷类型（v23）：离线日报与离线数字汇总（AISLG-54）。
// 从 protocol.ts 拆出以控制单文件行数；protocol.ts 原名再导出，
// 既有 import 路径不变。本文件只 import protocol.ts 的类型（运行时擦除，不构成加载环）。
// v49 起作战方针（AISLG-52 的 AgentDirectiveView / SET_AGENT_DIRECTIVE 载荷）整体移除：
// 玩家改与自己的 Agent 直接讨论，不再经游戏设置方针。

import type { Resources } from './protocol';

/** Agent 写回的离线日报（v23，AISLG-54；账号级最新一份，重写覆盖） */
export interface AgentDailyReportView {
  /** 日报正文（1..500 字符） */
  text: string;
  /** 最近一次写入时间（ISO 8601） */
  writtenAt: string;
}

/** 离线期间的数字汇总（v23，AISLG-54；服务端按实际离线时段从事件流统计，纯数字不做判断） */
export interface OfflineDigestView {
  /** 离线秒数；从未离线过（无记录）为 0 */
  seconds: number;
  /** 离线期间掠夺 / 战斗进账合计（按资源归集） */
  gains: Resources;
  /** 离线期间发生的战斗场次（出征战斗 + NPC 袭击） */
  battles: number;
  /** 我方部队总减员（战斗损失合计） */
  troopsLost: number;
  /** NPC 袭击次数 */
  npcRaids: number;
  /** 被 NPC 攻破丢失的野地数 */
  wildernessLost: number;
  /** 断粮哗变损失的兵力合计（v34，AISLG-107；离线期间各城各次哗变减员之和，不含在 troopsLost 内） */
  mutinyLost: number;
  /** 最接近满仓的资源（占其储量上限 ≥ 80% 时给出；其余为 null） */
  storageFull: { resource: string; percent: number } | null;
}

/** GET_OFFLINE_REPORT（op 41）响应载荷（v23，AISLG-54） */
export interface GetOfflineReportResponseData {
  offline: OfflineDigestView;
  /** Agent 最近写好的日报（从未写过为 null） */
  agentReport: AgentDailyReportView | null;
}

/** AGENT_DAILY_REPORT（op 40）请求载荷：text trim 后 1..500 字符 */
export interface AgentDailyReportRequestData {
  text: string;
}

export interface AgentDailyReportResponseData {
  report: AgentDailyReportView;
}
