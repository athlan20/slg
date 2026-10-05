// Agent 协作类协议的类型镜像（v23）：离线日报与离线数字汇总（AISLG-54）。
// 唯一事实来源是 backend/common/src/protocol-agent.ts；
// protocol.ts 原名再导出，既有 import 路径不变。
// v49 起作战方针（AISLG-52）整体移除：玩家改与自己的 Agent 直接讨论。

import type { Resources } from './protocol';

/** Agent 写回的离线日报（v23 AISLG-54；账号级最新一份，重写覆盖） */
export interface AgentDailyReportView {
  text: string;
  writtenAt: string;
}

/** 离线期间的数字汇总（v23 AISLG-54；服务端按实际离线时段从事件流统计） */
export interface OfflineDigestView {
  seconds: number;
  gains: Resources;
  battles: number;
  troopsLost: number;
  /** 断粮哗变损失的兵力合计（v34 AISLG-107；不含在 troopsLost 内） */
  mutinyLost: number;
  npcRaids: number;
  wildernessLost: number;
  storageFull: { resource: string; percent: number } | null;
}

/** GET_OFFLINE_REPORT（op 41）响应载荷 */
export interface GetOfflineReportResponseData {
  offline: OfflineDigestView;
  agentReport: AgentDailyReportView | null;
}
