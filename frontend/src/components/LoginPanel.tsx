import { useEffect, useState, type FormEvent } from 'react';
import { useCopy } from '../i18n/bundle';
import type { ApiClient } from '../api/client';
import { useAuthConfig } from '../state/useAuthConfig';
import { WechatLoginTab } from './wechat/WechatLoginTab';
import { GoogleLoginSection } from './google/GoogleLoginSection';
import { GithubLoginButton } from './github/GithubLoginButton';

// 登录表单：仅未登录时由 App 渲染（登录后的账号信息与切换入口在顶栏）。
// v44：微信扫码分页与 Google 按钮按服务端 /auth/config 的开关显示（没配置就不显示）。
// v45：Google 按钮旁再加 GitHub 按钮（同样按开关显示）。

interface LoginPanelProps {
  booting: boolean;
  loginBusy: boolean;
  loginError: string | null;
  lastUsername: string;
  onLogin: (username: string, password: string) => void;
  /** 微信扫码登录（v43）：建立（未登录）连接 / 拿到会话令牌后走令牌登录 */
  connectForWechat: () => Promise<ApiClient>;
  onWechatToken: (sessionToken: string) => void;
  /** Google 一键登录（v44）：GOOGLE_LOGIN 换到会话令牌后走令牌登录 */
  onGoogleToken: (sessionToken: string) => void;
}

type LoginTab = 'password' | 'wechat';

export function LoginPanel({ booting, loginBusy, loginError, lastUsername, onLogin, connectForWechat, onWechatToken, onGoogleToken }: LoginPanelProps) {
  const copy = useCopy();
  const { COPY, WECHAT_COPY } = copy;
  const { config } = useAuthConfig();
  const wechatEnabled = config?.wechatEnabled ?? false;
  const googleClientId = config?.googleClientId ?? null;
  // v47：国际站（服务端 /auth/config 的 passwordLogin=false）不显示用户名密码表单，
  // 登录页只剩 Google / GitHub 入口
  const passwordLoginEnabled = config?.passwordLogin ?? true;
  const githubEnabled = config?.githubEnabled ?? false;
  const thirdPartyEnabled = googleClientId !== null || githubEnabled;
  const [tab, setTab] = useState<LoginTab>('password');
  const [username, setUsername] = useState(lastUsername);
  const [password, setPassword] = useState('');

  // 入口按配置收起：正在的分页不再可用时回落到还开着的分页
  useEffect(() => {
    if (tab === 'wechat' && !wechatEnabled) {
      setTab(passwordLoginEnabled ? 'password' : 'wechat');
      return;
    }
    if (tab === 'password' && !passwordLoginEnabled) {
      setTab('wechat');
    }
  }, [tab, wechatEnabled, passwordLoginEnabled]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!username.trim() || !password || loginBusy) return;
    onLogin(username.trim(), password);
    setPassword('');
  }

  const tabs: Array<[LoginTab, string, string]> = [];
  if (passwordLoginEnabled) {
    tabs.push(['password', WECHAT_COPY.login.tabPassword, '账号面板-分页-用户名密码']);
  }
  if (wechatEnabled) {
    tabs.push(['wechat', WECHAT_COPY.login.tabWechat, '账号面板-分页-微信扫码']);
  }

  /** 第三方登录入口（Google / GitHub），密码分页与「纯第三方站」两处共用 */
  const thirdPartyBlock = thirdPartyEnabled ? (
    <div className="mt-2.5 flex flex-col items-center gap-2" role="账号面板-第三方登录区">
      {googleClientId ? (
        <GoogleLoginSection clientId={googleClientId} connect={connectForWechat} onToken={onGoogleToken} />
      ) : null}
      {githubEnabled ? <GithubLoginButton connect={connectForWechat} /> : null}
    </div>
  ) : null;

  return (
    <section className="panel" role="账号面板">
      <div className="panel-head" role="账号面板-状态">
        <h2>{COPY.login.title}</h2>
        <span>{booting ? COPY.login.booting : COPY.login.loggedOut}</span>
      </div>

      {booting ? (
        <div className="flex items-center gap-2.5 py-2" role="账号面板-自动登录等待">
          <i className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          <p className="text-[13px] text-dim">{COPY.login.bootingBody}</p>
        </div>
      ) : tabs.length > 1 ? (
        <div role="账号面板-登录方式" aria-label={WECHAT_COPY.login.tabsLabel} className="mb-2 flex gap-1 border-b border-line-soft">
          {tabs.map(([key, label, role]) => (
            <button
              key={key}
              type="button"
              role={role}
              aria-pressed={tab === key}
              onClick={() => setTab(key)}
              className={`-mb-px cursor-pointer border-b-2 px-3 py-1.5 text-[13px] ${
                tab === key ? 'border-accent text-accent' : 'border-transparent text-dim hover:text-fg'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {!booting && tab === 'wechat' && wechatEnabled ? (
        <WechatLoginTab active connect={connectForWechat} onToken={onWechatToken} />
      ) : null}

      {!booting && tab === 'password' && passwordLoginEnabled ? (
        <>
          <form className="flex flex-wrap items-end gap-2" role="账号面板-登录表单" onSubmit={handleSubmit}>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[12px] text-faint">{COPY.login.username}</span>
              <input
                className="rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[14px] outline-none focus:border-accent-dim"
                name="username"
                autoComplete="username"
                placeholder={COPY.login.usernamePlaceholder}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-[12px] text-faint">{COPY.login.password}</span>
              <input
                className="rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[14px] outline-none focus:border-accent-dim"
                name="password"
                autoComplete="current-password"
                placeholder={COPY.login.passwordPlaceholder}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <button type="submit" className="btn px-3 py-1.5" role="账号面板-登录按钮" disabled={loginBusy}>
              {loginBusy ? COPY.login.busy : COPY.login.submit}
            </button>
          </form>
          {thirdPartyBlock}
        </>
      ) : null}

      {/* 国际站（密码登录关闭）：没有分页可切，直接展示 Google / GitHub 入口 */}
      {!booting && !passwordLoginEnabled ? thirdPartyBlock : null}
      {!booting && !passwordLoginEnabled && !thirdPartyEnabled ? (
        <p className="rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[12px] text-dim" role="账号面板-第三方未启用">
          {COPY.login.thirdPartyUnavailable}
        </p>
      ) : null}

      {loginError ? (
        <p className="mt-2 rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[12px] text-dim" role="账号面板-登录错误">
          {loginError}
        </p>
      ) : null}

      <p className="mt-2 text-[12px] text-faint" role="账号面板-说明">
        {passwordLoginEnabled ? COPY.login.note : COPY.login.noteInternational}
      </p>

      {/* 开源仓库入口（AISLG-137 海外推广）：未登录访客第一眼能看到；新标签打开避免断开游戏会话 */}
      <a
        className="mt-2 text-[12px] text-faint underline-offset-2 hover:text-accent hover:underline"
        role="账号面板-GitHub仓库"
        href="https://github.com/athlan20/slg"
        target="_blank"
        rel="noreferrer"
      >
        {COPY.login.repoLink} ↗
      </a>
    </section>
  );
}
