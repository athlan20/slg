// 账号设置 · 绑定 Google（v44）：显示是否已绑定；未绑定时渲染 GSI 官方按钮，
// 拿到 ID Token 后经会话层的 bindGoogle 在当前已登录连接上发 GOOGLE_BIND，
// 成功后刷新绑定状态。服务端没配置 Google（/auth/config 的 googleClientId 为 null）
// 时整块不渲染。

import { useEffect, useRef, useState } from 'react';
import { useGame } from '../../state/GameContext';
import { useAuthConfig } from '../../state/useAuthConfig';
import { renderGoogleButton } from '../../state/googleGsi';
import { useCopy } from '../../i18n/bundle';

export function GoogleBindBlock() {
  const copy = useCopy();
  const { GOOGLE_COPY } = copy;
  const { session } = useGame();
  const { config } = useAuthConfig();
  const bound = session.agent?.googleBound ?? false;
  const { bindGoogle } = session.security;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  const clientId = config?.googleClientId;
  useEffect(() => {
    const container = containerRef.current;
    if (!clientId || bound || !container) {
      return undefined;
    }
    let alive = true;
    renderGoogleButton(
      container,
      clientId,
      (credential) => {
        if (!alive) {
          return;
        }
        setError(null);
        void (async () => {
          const message = await bindGoogle(credential);
          if (message !== null) {
            setError(message);
            return;
          }
          setDone(true);
        })();
      },
      { text: 'continue_with' },
    ).catch(() => {
      if (alive) {
        setFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [clientId, bound, bindGoogle]);

  if (!clientId) {
    return null;
  }
  return (
    <section role="账号设置-绑定Google" className="flex flex-col gap-1.5 rounded border border-line-soft bg-panel-2 p-2.5">
      <div className="flex items-baseline gap-2">
        <h4 className="text-[13px] font-semibold">{GOOGLE_COPY.bind.title}</h4>
        <span role="账号设置-绑定Google-状态" className={`ml-auto text-[12px] ${bound ? 'text-st-online' : 'text-faint'}`}>
          {bound ? GOOGLE_COPY.bind.bound : GOOGLE_COPY.bind.unbound}
        </span>
      </div>
      <p className="text-[12px] text-faint">{GOOGLE_COPY.bind.desc}</p>
      {bound ? null : done ? (
        <p role="账号设置-绑定Google-完成" className="text-[12px] text-st-online">
          {GOOGLE_COPY.bind.done}
        </p>
      ) : failed ? (
        <p role="账号设置-绑定Google-不可用" className="text-[12px] text-faint">
          {GOOGLE_COPY.login.unavailableNote}
        </p>
      ) : (
        <>
          <div ref={containerRef} role="账号设置-绑定Google-按钮容器" />
          {error ? (
            <p role="账号设置-绑定Google-错误" className="text-[12px] text-warn">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
