// 登录面板「用 GitHub 登录」按钮（v45）：点击后建一条未登录连接发 GITHUB_AUTH_START，
// 拿到授权地址后整页跳转过去（不用弹窗——手机浏览器常拦）。授权结果由回调 302 带回
// 前端，useGameSession 启动时处理（oauthReturn.ts）。

import { useState } from 'react';
import type { ApiClient } from '../../api/client';
import { Op } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { githubErrorText } from '../../api/errorText';

interface GithubLoginButtonProps {
  /** 建立一条已连接（未登录）的客户端 */
  connect: () => Promise<ApiClient>;
}

/** GitHub 官方登录按钮样式（黑底白字 + GitHub mark） */
export function GithubLoginButton({ connect }: GithubLoginButtonProps) {
  const copy = useCopy();
  const { GITHUB_COPY } = copy;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const client = await connect();
      const res = await client.request(Op.GITHUB_AUTH_START, { purpose: 'login' });
      if (!res.ok) {
        setError(githubErrorText(res.error?.code, res.error?.message));
        return;
      }
      const authUrl = res.data?.authUrl;
      if (typeof authUrl === 'string') {
        window.location.href = authUrl;
        return; // 整页跳转中，不用复位 busy
      }
      setError(GITHUB_COPY.errors.fallback);
    } catch (err) {
      setError(err instanceof Error ? err.message : GITHUB_COPY.errors.fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="账号面板-GitHub登录" className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        role="账号面板-GitHub登录-按钮"
        onClick={() => void start()}
        disabled={busy}
        className="flex h-10 w-[300px] max-w-full cursor-pointer items-center justify-center gap-2 rounded border border-black/20 bg-[#24292f] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#32383f] disabled:cursor-default disabled:opacity-60"
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
        </svg>
        {busy ? GITHUB_COPY.login.busy : GITHUB_COPY.login.button}
      </button>
      {error ? (
        <p role="账号面板-GitHub登录-错误" className="text-[12px] text-warn">
          {error}
        </p>
      ) : null}
    </div>
  );
}
