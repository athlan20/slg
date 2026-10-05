// 账号设置 · 绑定 GitHub（v45）：显示是否已绑定与绑定的 GitHub 用户名；未绑定时点按钮
// 在当前已登录连接上发起授权（GITHUB_AUTH_START purpose=bind）并整页跳转。授权结果由
// 回调 302 带回前端（?oauth=github&bind=ok / error=…），登录恢复后在事件流显示
// （useGameSession 的 oauthNotice）。服务端没配置 GitHub（/auth/config.githubEnabled
// 为 false）时整块不渲染。

import { useState } from 'react';
import { useGame } from '../../state/GameContext';
import { useAuthConfig } from '../../state/useAuthConfig';
import { GITHUB_COPY } from '../../copy-github';

export function GithubBindBlock() {
  const { session } = useGame();
  const { config } = useAuthConfig();
  const bound = session.agent?.githubBound ?? false;
  const githubLogin = session.agent?.githubLogin ?? null;
  const { startGithubBind } = session.security;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!config?.githubEnabled) {
    return null;
  }
  return (
    <section role="账号设置-绑定GitHub" className="flex flex-col gap-1.5 rounded border border-line-soft bg-panel-2 p-2.5">
      <div className="flex items-baseline gap-2">
        <h4 className="text-[13px] font-semibold">{GITHUB_COPY.bind.title}</h4>
        <span role="账号设置-绑定GitHub-状态" className={`ml-auto text-[12px] ${bound ? 'text-st-online' : 'text-faint'}`}>
          {bound && githubLogin ? GITHUB_COPY.bind.bound(githubLogin) : bound ? GITHUB_COPY.bind.bound('') : GITHUB_COPY.bind.unbound}
        </span>
      </div>
      <p className="text-[12px] text-faint">{GITHUB_COPY.bind.desc}</p>
      {bound ? null : (
        <button
          type="button"
          role="账号设置-绑定GitHub-按钮"
          className="btn self-start px-3 py-1"
          disabled={busy}
          onClick={() => {
            if (busy) {
              return;
            }
            setBusy(true);
            setError(null);
            void startGithubBind().then((message) => {
              if (message !== null) {
                setError(message);
                setBusy(false);
              }
              // 成功时已在 startGithubBind 里整页跳转，不复位 busy
            });
          }}
        >
          {busy ? GITHUB_COPY.bind.busy : GITHUB_COPY.bind.start}
        </button>
      )}
      {error ? (
        <p role="账号设置-绑定GitHub-错误" className="text-[12px] text-warn">
          {error}
        </p>
      ) : null}
    </section>
  );
}
