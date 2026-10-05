// 登录面板「用 Google 登录」区块（v44）：渲染 GSI 官方按钮，拿到 ID Token 后
// 在一条未登录连接上发 GOOGLE_LOGIN 换会话令牌，再交给上层走 LOGIN {token}。
// 连接在拿到凭证后才建立（用户选 Google 账号可能超过登录超时时限，不能先连着等）。

import { useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../../api/client';
import { Op } from '../../api/protocol';
import { GOOGLE_COPY } from '../../copy-google';
import { googleErrorText } from '../../api/errorText';
import { renderGoogleButton } from '../../state/googleGsi';

interface GoogleLoginSectionProps {
  clientId: string;
  /** 建立一条已连接（未登录）的客户端 */
  connect: () => Promise<ApiClient>;
  /** 拿到会话令牌后交给上层走令牌登录 */
  onToken: (sessionToken: string) => void;
}

export function GoogleLoginSection({ clientId, connect, onToken }: GoogleLoginSectionProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const connectRef = useRef(connect);
  connectRef.current = connect;

  useEffect(() => {
    let alive = true;
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    renderGoogleButton(container, clientId, (credential) => {
      if (!alive || busyRef.current) {
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setError(null);
      void (async () => {
        try {
          const client = await connectRef.current();
          const res = await client.request(Op.GOOGLE_LOGIN, { credential });
          if (!res.ok) {
            setError(googleErrorText(res.error?.code, res.error?.message));
            return;
          }
          const sessionToken = res.data?.sessionToken;
          if (typeof sessionToken === 'string') {
            onTokenRef.current(sessionToken);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : GOOGLE_COPY.errors.fallback);
        } finally {
          busyRef.current = false;
          setBusy(false);
        }
      })();
    }).catch(() => {
      if (alive) {
        setFailed(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [clientId]);

  if (failed) {
    return (
      <p role="账号面板-Google登录-不可用" className="text-[12px] text-faint">
        {GOOGLE_COPY.login.unavailableNote}
      </p>
    );
  }
  return (
    <div role="账号面板-Google登录" className="flex flex-col items-center gap-1.5">
      <div
        ref={containerRef}
        role="账号面板-Google登录-按钮容器"
        aria-busy={busy}
        className={busy ? 'pointer-events-none opacity-60' : undefined}
      />
      {error ? (
        <p role="账号面板-Google登录-错误" className="text-[12px] text-warn">
          {error}
        </p>
      ) : (
        <p className="text-[11.5px] text-faint">{GOOGLE_COPY.login.note}</p>
      )}
    </div>
  );
}
