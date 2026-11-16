import { useState } from 'react';
import type { ApiClient } from '../api/client';
import { linuxdoErrorText } from '../api/errorText';
import { Op } from '../api/protocol';
import { useCopy } from '../i18n/bundle';

export function LinuxdoLoginButton({ connect }: { connect: () => Promise<ApiClient> }) {
  const { LINUXDO_COPY } = useCopy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const client = await connect();
      const res = await client.request(Op.OAUTH_AUTH_START, { provider: 'linuxdo', purpose: 'login' });
      if (!res.ok) {
        setError(linuxdoErrorText(res.error?.code, res.error?.message));
      } else if (typeof res.data?.authUrl === 'string' && res.data.authUrl) {
        if (!(typeof __MAPP__ !== 'undefined' && __MAPP__)) {
          window.location.href = res.data.authUrl;
        }
      } else {
        setError(LINUXDO_COPY.errors.fallback);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : LINUXDO_COPY.errors.fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="账号面板-Linuxdo登录" className="flex flex-col items-center gap-1.5">
      <button type="button" role="账号面板-Linuxdo登录-按钮" onClick={() => void start()} disabled={busy}
        className="flex h-10 w-[300px] max-w-full cursor-pointer items-center justify-center rounded border border-line-soft bg-panel-2 px-4 text-[14px] font-medium transition-colors hover:bg-panel disabled:cursor-default disabled:opacity-60">
        {busy ? LINUXDO_COPY.login.busy : LINUXDO_COPY.login.button}
      </button>
      {error ? <p role="账号面板-Linuxdo登录-错误" className="text-[12px] text-warn">{error}</p> : null}
    </div>
  );
}
