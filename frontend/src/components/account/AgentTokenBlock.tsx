// 账号设置 · Agent 令牌（v46，AISLG-129）：每账号一个永久令牌，默认遮住（sk_••••••3f9a），
// 可显示全文、复制、二次确认后重置（旧令牌立刻失效、用它在线的 Agent 被断开）。
// 令牌经 GET_AGENT_TOKEN 惰性加载（老账号由服务端自动补生成）；不进 GET_AGENT_INFO。

import { useCallback, useEffect, useState } from 'react';
import { useGame } from '../../state/GameContext';
import type { AgentTokenData } from '../../api/protocol-wechat';
import { WECHAT_COPY } from '../../copy-wechat';
import { writeClipboard } from '../AgentPanel';

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function AgentTokenBlock() {
  const { session } = useGame();
  const { getAgentToken, resetAgentToken } = session.security;
  const [info, setInfo] = useState<AgentTokenData | null>(null);
  const [failed, setFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const data = await getAgentToken();
    if (data) {
      setInfo(data);
    } else {
      setFailed(true);
    }
  }, [getAgentToken]);

  // 打开账号设置即拉一次令牌（老账号此时由服务端自动补生成）
  useEffect(() => {
    void load();
  }, [load]);

  async function copyToken() {
    if (!info) {
      return;
    }
    try {
      await writeClipboard(info.token);
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  }

  async function reset() {
    if (resetting || !confirming) {
      return;
    }
    setResetting(true);
    setError(null);
    const fresh = await resetAgentToken();
    setResetting(false);
    setConfirming(false);
    if (!fresh) {
      setError(WECHAT_COPY.errors.fallback);
      return;
    }
    setInfo(fresh);
    setRevealed(true);
    setNotice(WECHAT_COPY.token.resetDone);
  }

  return (
    <section role="账号设置-Agent令牌" className="flex flex-col gap-1.5 rounded border border-line-soft bg-panel-2 p-2.5">
      <div className="flex items-baseline gap-2">
        <h4 className="text-[13px] font-semibold">{WECHAT_COPY.token.title}</h4>
        {info ? (
          <span className="ml-auto text-[11.5px] text-faint">
            {WECHAT_COPY.token.lastUsed(info.lastUsedAt ? formatTime(info.lastUsedAt) : WECHAT_COPY.token.neverUsed)} ·{' '}
            {WECHAT_COPY.token.createdAt(formatTime(info.createdAt))}
          </span>
        ) : null}
      </div>
      <p className="text-[12px] text-faint">{WECHAT_COPY.token.desc}</p>

      {failed ? (
        <div className="flex items-center gap-2" role="账号设置-Agent令牌-加载失败">
          <span className="text-[12px] text-warn">{WECHAT_COPY.token.loadFailed}</span>
          <button type="button" role="账号设置-Agent令牌-重试按钮" className="btn px-2 py-0.5" onClick={() => void load()}>
            {WECHAT_COPY.token.retry}
          </button>
        </div>
      ) : info ? (
        <>
          <div className="flex items-center gap-2" role="账号设置-Agent令牌-令牌行">
            <code
              role="账号设置-Agent令牌-令牌值"
              className="min-w-0 flex-1 truncate rounded border border-line-soft bg-panel px-2 py-1 font-mono text-[12.5px]"
            >
              {revealed ? info.token : WECHAT_COPY.token.masked(info.token)}
            </code>
            <button
              type="button"
              role="账号设置-Agent令牌-显示按钮"
              className="btn shrink-0 px-2 py-1"
              onClick={() => setRevealed((v) => !v)}
            >
              {revealed ? WECHAT_COPY.token.hide : WECHAT_COPY.token.show}
            </button>
            <button type="button" role="账号设置-Agent令牌-复制按钮" className="btn shrink-0 px-2 py-1" onClick={() => void copyToken()}>
              {copy === 'copied' ? WECHAT_COPY.token.copied : copy === 'failed' ? WECHAT_COPY.token.copyFailed : WECHAT_COPY.token.copy}
            </button>
          </div>
          {notice ? (
            <p role="账号设置-Agent令牌-重置结果" className="text-[12px] text-st-online">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p role="账号设置-Agent令牌-错误" className="text-[12px] text-warn">
              {error}
            </p>
          ) : null}
          {confirming ? (
            <div role="账号设置-Agent令牌-重置确认" className="flex flex-col gap-1.5 rounded border border-line-soft bg-panel p-2">
              <p className="text-[12px] text-warn">{WECHAT_COPY.token.resetConfirmTitle}</p>
              <div className="flex justify-end gap-2">
                <button type="button" role="账号设置-Agent令牌-取消重置按钮" className="btn px-3 py-1" onClick={() => setConfirming(false)}>
                  {WECHAT_COPY.token.resetCancel}
                </button>
                <button
                  type="button"
                  role="账号设置-Agent令牌-确认重置按钮"
                  className="btn px-3 py-1 text-st-error"
                  disabled={resetting}
                  onClick={() => void reset()}
                >
                  {resetting ? WECHAT_COPY.token.resetting : WECHAT_COPY.token.resetConfirm}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              role="账号设置-Agent令牌-重置按钮"
              className="btn self-start px-3 py-1 text-st-error"
              onClick={() => {
                setNotice(null);
                setError(null);
                setConfirming(true);
              }}
            >
              {WECHAT_COPY.token.reset}
            </button>
          )}
        </>
      ) : null}
    </section>
  );
}
