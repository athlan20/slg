/** Agent 卡（Agent 页左）：连接状态、最近动作、Agent 汇报的计划，以及接入文档复制入口。
 *  v49 起作战方针整体移除：玩家对打法的意图改为与自己的 Agent 直接讨论，
 *  不再在游戏里设置（SET_AGENT_DIRECTIVE / PUSH_AGENT_DIRECTIVE 已删）。 */

import { useEffect, useRef, useState } from 'react';
import { AGENT_API_DOC_URL, WS_URL } from '../api/client';
import type { AgentInfoView } from '../api/protocol';
import { eventText } from '../api/mapping';
import { COPY } from '../copy';
import { useGame } from '../state/GameContext';
import { Card } from './ui/Card';

interface AgentPanelProps {
  agent: AgentInfoView | null;
  /** 离线日报拉取失败的人读提示（v23 AISLG-54） */
  offlineReportError: string | null;
  /** 打开离线日报弹窗（v23 AISLG-54） */
  onOpenOfflineReport: () => void;
}

type DocCopyState = 'idle' | 'copied' | 'failed';

const DOC_BUTTON_LABEL: Record<DocCopyState, string> = {
  idle: COPY.agentPanel.docButton,
  copied: COPY.agentPanel.docCopied,
  failed: COPY.agentPanel.docFailed,
};

/** 写剪贴板：优先 Clipboard API；页面未聚焦等场景被权限拦截时退回 textarea + execCommand */
export async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // 继续走降级路径
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand('copy')) {
      throw new Error('execCommand copy 不可用');
    }
  } finally {
    ta.remove();
  }
}

export function AgentPanel({ agent, offlineReportError, onOpenOfflineReport }: AgentPanelProps) {
  const { session } = useGame();
  // 复制接入文档：不请求任何接口，只把固定提示语写入剪贴板——由用户的 Agent
  // 按提示语自行 GET 文档地址（AGENT_API_DOC_URL）后阅读接入
  const [docCopy, setDocCopy] = useState<DocCopyState>('idle');
  const revertTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (revertTimerRef.current !== null) {
        window.clearTimeout(revertTimerRef.current);
      }
    },
    [],
  );

  async function copyDoc() {
    try {
      // v46（AISLG-129）：提示词第四行带本账号的永久 Agent 令牌（GET_AGENT_TOKEN，仅玩家连接可取）
      const tokenInfo = await session.security.getAgentToken();
      if (!tokenInfo) {
        throw new Error('token unavailable');
      }
      await writeClipboard(COPY.agentPanel.docPrompt(AGENT_API_DOC_URL, WS_URL, tokenInfo.token));
      setDocCopy('copied');
    } catch {
      setDocCopy('failed');
    }
    if (revertTimerRef.current !== null) {
      window.clearTimeout(revertTimerRef.current);
    }
    revertTimerRef.current = window.setTimeout(() => setDocCopy('idle'), 2500);
  }

  const online = agent?.agentOnline ?? false;
  const rows = [
    { key: COPY.agentPanel.rowConnection, value: agent ? (online ? COPY.agentPanel.connectionsOnline(agent.connections.length) : COPY.agentPanel.offline) : COPY.agentPanel.querying },
    {
      key: COPY.agentPanel.rowLastOnline,
      value: agent?.connections[0]?.connectedAt ? new Date(agent.connections[0].connectedAt).toLocaleTimeString('zh-CN', { hour12: false }) : COPY.agentPanel.none,
    },
    { key: COPY.agentPanel.rowLastAction, value: agent?.recentEvents[0] ? eventText(agent.recentEvents[0]) : COPY.agentPanel.none },
  ];

  return (
    <Card
      role="Agent面板"
      title="Agent 状态与计划"
      meta={
        <span role="Agent面板-状态" className="inline-flex items-center gap-1.5">
          <i className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-st-online' : 'bg-st-offline'}`} />
          {online ? COPY.agentPanel.connectionsOnline(agent?.connections.length ?? 0) : COPY.agentPanel.offline}
        </span>
      }
    >
      <dl className="flex shrink-0 flex-col gap-0.5" role="Agent面板-详情">
        {rows.map((row) => (
          <div key={row.key} className="flex justify-between gap-2 text-[12.5px]">
            <dt className="shrink-0 text-faint">{row.key}</dt>
            <dd className="min-w-0 truncate font-mono text-[12px] text-dim" title={row.value}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Agent 汇报的计划（v10）：Agent 自报的下一步与整体打算 */}
      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden border-t border-line-soft pt-2" role="Agent面板-计划">
        <p className="shrink-0 text-[13px] font-semibold text-dim">{COPY.agentPanel.planSectionTitle}</p>
        {agent?.plan && (agent.plan.nextAction !== null || agent.plan.overallPlan !== null) ? (
          <div className="flex min-h-0 flex-col gap-1 overflow-hidden" role="Agent面板-计划-明细">
            {agent.plan.nextAction !== null ? (
              <div className="flex justify-between gap-2 text-[12.5px]" role="Agent面板-计划-下一步">
                <span className="shrink-0 text-faint">{COPY.agentPanel.planNext}</span>
                <span className="line-clamp-2 min-w-0 break-words text-right font-mono text-[12px] text-dim" title={agent.plan.nextAction}>{agent.plan.nextAction}</span>
              </div>
            ) : null}
            {agent.plan.overallPlan !== null ? (
              <div className="flex justify-between gap-2 text-[12.5px]" role="Agent面板-计划-整体">
                <span className="shrink-0 text-faint">{COPY.agentPanel.planOverall}</span>
                <span className="line-clamp-3 min-w-0 break-words text-right font-mono text-[12px] text-dim" title={agent.plan.overallPlan}>{agent.plan.overallPlan}</span>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-[12px] text-faint" role="Agent面板-计划-空">{COPY.agentPanel.planEmpty}</p>
        )}
      </div>

      <div className="flex shrink-0 gap-1.5" role="Agent面板-接入文档">
        <button
          type="button"
          role="Agent面板-复制文档按钮"
          className={`btn min-w-0 flex-1 truncate py-1 ${docCopy === 'copied' ? 'text-accent' : docCopy === 'failed' ? 'text-warn' : ''}`}
          onClick={() => void copyDoc()}
        >
          {DOC_BUTTON_LABEL[docCopy]}
        </button>
        {/* 离线日报入口（1024–1279 两栏时日报摘要卡隐藏，这里留一个入口） */}
        <button type="button" role="Agent面板-离线日报按钮" className="btn hidden shrink-0 py-1 max-xl:block" onClick={onOpenOfflineReport}>
          {COPY.offlineReport.openButton}
        </button>
      </div>
      {offlineReportError ? <p className="shrink-0 truncate text-[12px] text-warn">{offlineReportError}</p> : null}
      <p role="Agent面板-文档令牌提示" className="shrink-0 truncate text-[11.5px] text-faint">
        {COPY.agentPanel.docTokenHint}
      </p>
    </Card>
  );
}
