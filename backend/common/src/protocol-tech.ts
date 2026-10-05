// 科技研究协议的类型（v27，AISLG-77；从 protocol.ts 拆出以控制单文件行数）。
// 科技规则与数值见 common/src/tech.ts。类型导入在运行时被擦除，不构成加载环。

import type { InitiatorRole, Resources } from './protocol';
import type { TechKind } from './tech';

/** 一项科技的当前状态与下一级信息 */
export interface TechEntryView {
  kind: TechKind;
  /** 中文名 */
  label: string;
  /** 当前等级（0 = 未研究；账号共享） */
  level: number;
  maxLevel: number;
  /** 每级效果（百分数；侦察科技为 0，按等级解锁内容） */
  percentPerLevel: number;
  /** 一句话效果说明 */
  effect: string;
  /** 当前等级的累计效果（百分数；侦察为 0） */
  currentPercent: number;
  /** 下一级的研究信息；满级为 null。academyRequired = 下一级要求的书院等级（= 目标等级） */
  next: {
    level: number;
    cost: Resources;
    /** 研究耗时（秒，已按当前全局时间缩放折算） */
    seconds: number;
    academyRequired: number;
    /** 当前查询城的书院等级是否满足 academyRequired */
    academyOk: boolean;
  } | null;
}

/** 研究记录视图（GET_TECHS / RESEARCH_TECH / 推送共用） */
export interface ResearchView {
  id: string;
  /** 发起研究并扣资源的城（取消时返还到该城） */
  cityId: string;
  tech: TechKind;
  /** 研究完成后的目标等级 */
  level: number;
  status: 'researching' | 'completed' | 'cancelled';
  initiator: InitiatorRole;
  /** 发起时扣除的成本快照 */
  cost: Resources;
  startedAt: string;
  dueAt: string;
  completedAt: string | null;
}

/** GET_TECHS（op 44）请求：可选 cityId（城池类协议通用，缺省主城），指定用哪座城的书院判定 academyOk */
export interface GetTechsRequestData {
  cityId?: string;
}

export interface TechStateView {
  /** 查询城的书院等级（0 = 未建） */
  academyLevel: number;
  techs: TechEntryView[];
  /** 账号进行中的研究（同一时间只有一项）；无则 null */
  research: ResearchView | null;
}

export type GetTechsResponseData = TechStateView;

/** RESEARCH_TECH（op 45）请求 */
export interface ResearchTechRequestData {
  /** 科技类型 */
  tech: TechKind;
  /** 可选：发起研究 / 扣资源的城（缺省主城）；该城书院等级须 ≥ 目标等级 */
  cityId?: string;
}

export interface ResearchTechResponseData {
  research: ResearchView;
}

/** CANCEL_RESEARCH（op 46）请求：取消账号进行中的研究并全额返还 */
export interface CancelResearchRequestData {
  /** 可选：研究记录 id；缺省取进行中的那一项 */
  researchId?: string;
}

export interface CancelResearchResponseData {
  research: ResearchView;
}

/** PUSH_TECH_STATE（op 2012）推送载荷：账号全部在线连接收到 */
export interface TechStatePushData {
  /** research_started=发起；research_completed=研究完成（等级已生效）；research_cancelled=取消返还 */
  reason: 'research_started' | 'research_completed' | 'research_cancelled';
  research: ResearchView;
  /** 完成后该科技的新等级（仅 research_completed 有意义；其余为当前等级） */
  level: number;
}
