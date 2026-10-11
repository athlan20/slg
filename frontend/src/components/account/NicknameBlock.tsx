// 账号设置 · 昵称（v52，AISLG-142）：第三方登录自动建号的随机名（g_xxxxxx 等）改成自己的；
// 昵称即账号 username，全服唯一（NICKNAME_TAKEN）。保存成功后本连接按响应更新账号名，
// 其他在线连接由服务端推 PUSH_ACCOUNT_STATE 同步；「当前昵称」行随会话实时变化。

import { useState, type FormEvent } from 'react';
import { useGame } from '../../state/GameContext';
import { useCopy } from '../../i18n/bundle';

export function NicknameBlock() {
  const { WECHAT_COPY } = useCopy();
  const { session } = useGame();
  const { account } = session;
  const { setNickname } = session.security;
  const [value, setValue] = useState(account?.username ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) {
      return;
    }
    const nickname = value.trim();
    if (nickname.length === 0) {
      setSaved(null);
      setError(WECHAT_COPY.nickname.empty);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(null);
    const failure = await setNickname(nickname);
    setBusy(false);
    if (failure === null) {
      setSaved(WECHAT_COPY.nickname.done(nickname));
    } else {
      setError(failure);
    }
  }

  return (
    <section role="账号设置-昵称" className="flex flex-col gap-1.5 rounded border border-line-soft bg-panel-2 p-2.5">
      <div className="flex items-baseline gap-2">
        <h4 className="text-[13px] font-semibold">{WECHAT_COPY.nickname.title}</h4>
        {account ? (
          <span className="ml-auto truncate text-[11.5px] text-faint">{WECHAT_COPY.nickname.current(account.username)}</span>
        ) : null}
      </div>
      <p className="text-[12px] text-faint">{WECHAT_COPY.nickname.desc}</p>
      <form className="flex items-center gap-2" onSubmit={(event) => void submit(event)}>
        <input
          role="账号设置-昵称-输入框"
          className="min-w-0 flex-1 rounded border border-line-soft bg-panel px-2 py-1.5 text-[13px] outline-none focus:border-accent-dim"
          value={value}
          maxLength={32}
          placeholder={WECHAT_COPY.nickname.placeholder}
          onChange={(event) => setValue(event.target.value)}
        />
        <button type="submit" role="账号设置-昵称-保存按钮" className="btn shrink-0 px-3 py-1.5" disabled={busy}>
          {busy ? WECHAT_COPY.nickname.busy : WECHAT_COPY.nickname.submit}
        </button>
      </form>
      {saved ? (
        <p role="账号设置-昵称-保存结果" className="text-[12px] text-st-online">
          {saved}
        </p>
      ) : null}
      {error ? (
        <p role="账号设置-昵称-错误" className="text-[12px] text-warn" title={error}>
          {error}
        </p>
      ) : null}
    </section>
  );
}
