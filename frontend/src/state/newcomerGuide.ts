// 新手接入弹窗的判断逻辑（AISLG-267）：谁算新玩家、本机「不再提示」记忆、复制提示词的末尾追加。
// 纯函数 + 本机 localStorage（键里带账号 id，读写都 try/catch 包住），不请求接口、不新增服务端字段。
// 账号创建时间由后端 AISLG-266 在 GET_AGENT_INFO 里返回（可选字段），旧服务端没有该字段时
// 退化成「只按没接过 Agent 判断」，不报错、不把旧号当新号的问题留给调用方。
// 单测见 newcomerGuide.test.mjs（Node 原生去除类型直接跑 .ts）。

import { appStorage } from '../storage.ts';

/** 新号窗口：账号创建至今不超过 7 天 */
export const NEWCOMER_WINDOW_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** 「不再提示」的存储键前缀（拼上账号 id） */
const OPT_OUT_KEY_PREFIX = 'slg.newcomer.guide.optout.';

/** 判断所需的 Agent 信息切片（AgentInfoView 的子集，便于单测直接传字面量） */
export interface NewcomerAgentSnapshot {
  /** 账号创建时间（ISO 8601；旧服务端没有） */
  accountCreatedAt?: string | null;
  /** 当前是否有 Agent 在线 */
  agentOnline: boolean;
  /** Agent 最近一次上报的计划（从未上报为 null；有值即代表接过 Agent） */
  plan: unknown;
  /** Agent 发起的事件（服务端只回 Agent 发起的事件；空 = 没有 Agent 动作） */
  recentEvents: readonly unknown[];
}

/** 某个账号「不再提示」的存储键（测试与排查用） */
export function newcomerGuideOptOutKey(accountId: string): string {
  return `${OPT_OUT_KEY_PREFIX}${accountId}`;
}

/**
 * 账号是否还处在新号窗口内：创建至今不超过 7 天。
 * 旧服务端没有 accountCreatedAt（或值无法解析）时返回 true——条件退化成「只按没接过 Agent 判断」。
 */
export function isNewAccount(accountCreatedAt: string | null | undefined, nowMs: number): boolean {
  if (!accountCreatedAt) {
    return true;
  }
  const createdMs = Date.parse(accountCreatedAt);
  if (!Number.isFinite(createdMs)) {
    return true;
  }
  // 客户端时钟偏差导致创建时间在「未来」时仍算新号
  return nowMs - createdMs <= NEWCOMER_WINDOW_DAYS * DAY_MS;
}

/**
 * 有没有接过 Agent：当前在线、上报过计划、或最近事件里有 Agent 发起的动作，任一成立即算接过。
 * recentEvents 服务端只返回 Agent 发起的事件，所以「列表为空」就是没有 Agent 动作。
 */
export function hasEverConnectedAgent(agent: NewcomerAgentSnapshot | null): boolean {
  if (!agent) {
    return false;
  }
  return agent.agentOnline || (agent.plan !== null && agent.plan !== undefined) || agent.recentEvents.length > 0;
}

/** 自动弹的条件：新号 且 没接过 Agent（两条都满足才弹） */
export function shouldAutoOpenGuide(agent: NewcomerAgentSnapshot | null, nowMs: number): boolean {
  if (!agent) {
    return false;
  }
  return isNewAccount(agent.accountCreatedAt, nowMs) && !hasEverConnectedAgent(agent);
}

/** 本机是否记过「不再提示」：没登录 / 没记录 / 存储不可用都当没记过 */
export function readNewcomerGuideOptOut(accountId: string | null): boolean {
  if (!accountId) {
    return false;
  }
  try {
    return appStorage.getItem(newcomerGuideOptOutKey(accountId)) !== null;
  } catch {
    return false;
  }
}

/** 记下「不再提示」（永久，本机；写失败下次进入再问一次，不影响本次关闭） */
export function writeNewcomerGuideOptOut(accountId: string | null): void {
  if (!accountId) {
    return;
  }
  try {
    appStorage.setItem(newcomerGuideOptOutKey(accountId), '1');
  } catch {
    // 存储不可用：这次不记，下次进入再提示
  }
}

/**
 * 新弹窗复制的提示词 = Agent 面板那套提示词（文档地址 + 服务器地址 + 令牌）+ 末尾一行「以接入文档为准」。
 * 单独成函数便于单测；Agent 面板原按钮的提示词不经这里，行为不变。
 */
export function appendNewcomerPromptTail(basePrompt: string, tail: string): string {
  return `${basePrompt.replace(/\s+$/, '')}\n${tail}`;
}