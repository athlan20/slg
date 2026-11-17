/** 新手接入弹窗（AISLG-267）：进游戏就把「把这段贴给你的 AI」摆在一屏内——
 *  没有页签、没有选项，只有一个一键复制按钮；末尾一行告诉玩家玩法问题直接问自己的 AI。
 *  复制的内容是 Agent 面板那套提示词（文档地址 + 服务器地址 + 令牌）再加一行「以接入文档为准」，
 *  Agent 面板原来的「复制给 AI」按钮行为不变。
 *  弹窗开着时 Agent 一上线，复制按钮区替换成「已接上」。
 *  令牌不进 localStorage，也不在弹窗里明文展示——只出现在复制出去的内容里。 */

import { useEffect, useRef, useState } from 'react';
import { AGENT_API_DOC_URL, WS_URL } from '../../api/client';
import type { AgentInfoView } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { appendNewcomerPromptTail } from '../../state/newcomerGuide';
import { writeClipboard } from '../AgentPanel';
import { Modal } from '../ui/Modal';

type CopyState = 'idle' | 'copied' | 'failed';

interface NewcomerGuideModalProps {
  agent: AgentInfoView | null;
  /** 稍后再说 / 右上角关闭 / 点遮罩：本次登录不再弹 */
  onClose: () => void;
  /** 不再提示：本机永久不再自动弹 */
  onDismissForever: () => void;
}

export function NewcomerGuideModal({ agent, onClose, onDismissForever }: NewcomerGuideModalProps) {
  const copy = useCopy();
  const { COPY } = copy;
  const G = COPY.newcomerGuide;
  const { session } = useGame();
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const revertTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (revertTimerRef.current !== null) {
        window.clearTimeout(revertTimerRef.current);
      }
    },
    [],
  );

  /**
   * 一键复制：取本账号永久 Agent 令牌（GET_AGENT_TOKEN），
   * 拼现有接入提示词 + 末尾一行「以接入文档为准」，由玩家的 AI 自己 GET 文档后接入。
   */
  async function copyPrompt() {
    try {
      const tokenInfo = await session.security.getAgentToken();
      if (!tokenInfo) {
        throw new Error('token unavailable');
      }
      const prompt = appendNewcomerPromptTail(COPY.agentPanel.docPrompt(AGENT_API_DOC_URL, WS_URL, tokenInfo.token), G.promptTail);
      await writeClipboard(prompt);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
    if (revertTimerRef.current !== null) {
      window.clearTimeout(revertTimerRef.current);
    }
    revertTimerRef.current = window.setTimeout(() => setCopyState('idle'), 2500);
  }

  const online = agent?.agentOnline ?? false;
  const buttonLabel = copyState === 'copied' ? G.copyCopied : copyState === 'failed' ? G.copyFailed : G.copyButton;

  return (
    <Modal role="新手接入弹窗" title={G.title} accent="gold" onClose={onClose}>
      <p role="新手接入弹窗-开头" className="shrink-0 text-[13px] leading-snug text-dim">
        {G.intro}
      </p>
      <p role="新手接入弹窗-适用产品" className="shrink-0 text-[11.5px] leading-snug text-faint">
        {G.products}
      </p>

      {/* 复制按钮区：Agent 上线后整块换成「已接上」 */}
      {online ? (
        <p role="新手接入弹窗-已接上" className="shrink-0 rounded border border-accent-dim bg-accent-soft px-2.5 py-1.5 text-[13px] leading-snug text-ok">
          {G.connected}
        </p>
      ) : (
        <div role="新手接入弹窗-复制按钮" className="shrink-0">
          <button
            type="button"
            role="新手接入弹窗-一键复制按钮"
            className={`btn w-full py-1.5 font-sans text-[13px] ${copyState === 'copied' ? 'text-ok' : copyState === 'failed' ? 'text-warn' : ''}`}
            onClick={() => void copyPrompt()}
          >
            {buttonLabel}
          </button>
        </div>
      )}

      <div role="新手接入弹窗-小字" className="flex shrink-0 flex-col gap-0.5 text-[11.5px] leading-snug text-faint">
        <p>{G.tokenHint}</p>
        <p>{G.webOnlyHint}</p>
      </div>

      {/* 底部固定一行：玩法问题直接问自己的 AI（贴底，不随内容伸缩） */}
      <p
        role="新手接入弹窗-玩法提示"
        className="mt-auto shrink-0 rounded border border-accent-dim bg-accent-soft px-2.5 py-1.5 text-[12px] leading-snug text-dim"
      >
        <span>{G.gameplayIcon}</span> <strong className="text-fg">{G.gameplayBold}</strong> {G.gameplayTail}
      </p>

      <div role="新手接入弹窗-底部按钮" className="flex shrink-0 gap-1.5">
        <button type="button" role="新手接入弹窗-稍后再说按钮" className="btn flex-1 py-1 font-sans text-[12px]" onClick={onClose}>
          {G.later}
        </button>
        <button type="button" role="新手接入弹窗-不再提示按钮" className="btn flex-1 py-1 font-sans text-[12px] text-faint" onClick={onDismissForever}>
          {G.never}
        </button>
      </div>
    </Modal>
  );
}