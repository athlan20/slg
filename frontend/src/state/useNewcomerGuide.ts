// 新手接入弹窗的开关状态（AISLG-267）：自动弹、本次登录「稍后再说」、
// 本机「不再提示」与 Agent 面板「接入指引」手动入口共用一个开关。
// 判断逻辑（新号 / 没接过 Agent / 本机记忆）全在 newcomerGuide.ts 的纯函数里，这里只管 React 状态。

import { useEffect, useState } from 'react';
import type { AgentInfoView } from '../api/protocol';
import { readNewcomerGuideOptOut, shouldAutoOpenGuide, writeNewcomerGuideOptOut } from './newcomerGuide';

/** 自动弹的延迟：让登录时紧接着的离线日报 / 公告等自动弹窗先到位（它们开着时不弹） */
const AUTO_OPEN_DELAY_MS = 1200;

export interface NewcomerGuideState {
  /** 弹窗当前是否显示（自动弹开中，或玩家手动打开） */
  open: boolean;
  /** 「稍后再说」（含右上角关闭与点遮罩）：本次登录不再弹，下次登录还弹 */
  close: () => void;
  /** 「不再提示」：本机永久不再自动弹（手动入口照旧可用） */
  dismissForever: () => void;
}

/**
 * 自动弹一次：进游戏后条件满足就弹开并保持，直到玩家关掉。
 * 弹窗开着时 Agent 上线只切换窗内状态，不会把窗关掉（自动弹的锁存在 autoOpen 里）。
 */
export function useNewcomerGuide(deps: {
  accountId: string | null;
  /** Agent 信息（GET_AGENT_INFO 的结果；还没拿到时为 null，先不弹） */
  agent: AgentInfoView | null;
  /** 有更高优先级的自动弹窗正开着（公告 / 离线日报 / 来袭预警等），或还没连上：等它们关掉、连上再弹 */
  blocked: boolean;
  /** 玩家从 Agent 面板手动打开「接入指引」（不受新号条件限制） */
  manualOpen: boolean;
}): NewcomerGuideState {
  const { accountId, agent, blocked, manualOpen } = deps;
  // 本次登录是不是已经关过（稍后再说）：换账号 / 重新登录重新判断
  const [dismissed, setDismissed] = useState(false);
  // 本机永久「不再提示」（键里带账号 id，读不到当没记过）
  const [optedOut, setOptedOut] = useState(() => readNewcomerGuideOptOut(accountId));
  // 已经自动弹开：之后 Agent 上线也保持打开（窗内切换成「已接上」），关掉后本次不再弹
  const [autoOpen, setAutoOpen] = useState(false);

  // 换账号：重新读本机的「不再提示」，本次登录的「稍后再说」与已弹状态作废
  useEffect(() => {
    setDismissed(false);
    setAutoOpen(false);
    setOptedOut(readNewcomerGuideOptOut(accountId));
  }, [accountId]);

  // 自动弹：新号 + 没接过 Agent + 没被别的自动弹窗挡住 + 本次没关过 + 本机没记过「不再提示」
  useEffect(() => {
    if (accountId === null || agent === null || blocked || dismissed || optedOut) {
      return;
    }
    const snapshot = {
      accountCreatedAt: agent.accountCreatedAt,
      agentOnline: agent.agentOnline,
      plan: agent.plan,
      recentEvents: agent.recentEvents,
    };
    if (!shouldAutoOpenGuide(snapshot, Date.now())) {
      return;
    }
    // 延一拍再弹：登录时离线日报 / 公告强提醒是紧接着的异步请求，让它们先到位，
    // 期间任何一个开了 blocked 变化都会取消这个计时器，不会两个弹窗叠在一起
    const timer = window.setTimeout(() => setAutoOpen(true), AUTO_OPEN_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [accountId, agent, blocked, dismissed, optedOut]);

  const close = () => {
    setAutoOpen(false);
    setDismissed(true);
  };

  const dismissForever = () => {
    setAutoOpen(false);
    setDismissed(true);
    writeNewcomerGuideOptOut(accountId);
    setOptedOut(true);
  };

  return { open: manualOpen || autoOpen, close, dismissForever };
}