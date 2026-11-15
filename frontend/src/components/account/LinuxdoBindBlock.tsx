import { useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { useAuthConfig } from '../../state/useAuthConfig';

export function LinuxdoBindBlock() {
  const { LINUXDO_COPY } = useCopy();
  const { session } = useGame();
  const { config } = useAuthConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bound = session.agent?.linuxdoBound ?? false;
  const login = session.agent?.linuxdoLogin ?? '';

  if (!config?.linuxdoEnabled) return null;
  return (
    <section role="账号设置-绑定Linuxdo" className="flex flex-col gap-1.5 rounded border border-line-soft bg-panel-2 p-2.5">
      <div role="账号设置-绑定Linuxdo-标题" className="flex items-baseline gap-2">
        <h4 className="text-[13px] font-semibold">{LINUXDO_COPY.bind.title}</h4>
        <span role="账号设置-绑定Linuxdo-状态" className={`ml-auto text-[12px] ${bound ? 'text-st-online' : 'text-faint'}`}>
          {bound ? LINUXDO_COPY.bind.bound(login) : LINUXDO_COPY.bind.unbound}
        </span>
      </div>
      <p className="text-[12px] text-faint">{LINUXDO_COPY.bind.desc}</p>
      {!bound ? (
        <button type="button" role="账号设置-绑定Linuxdo-按钮" className="btn self-start px-3 py-1" disabled={busy}
          onClick={() => {
            if (busy) return;
            setBusy(true);
            setError(null);
            void session.security.startLinuxdoBind().then((message) => {
              if (message !== null) { setError(message); setBusy(false); }
            });
          }}>
          {busy ? LINUXDO_COPY.bind.busy : LINUXDO_COPY.bind.start}
        </button>
      ) : null}
      {error ? <p role="账号设置-绑定Linuxdo-错误" className="text-[12px] text-warn">{error}</p> : null}
    </section>
  );
}
