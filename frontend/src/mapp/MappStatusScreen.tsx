// 微应用状态与提示界面（未登录论坛、加载中、错误提示、信任等级不足）。
// 规范：全部功能块标明 role 属性，纯 Tailwind 样式无内联 style，适配 390px 窄屏与桌面。

interface MappStatusScreenProps {
  mode: 'forum-login-required' | 'loading' | 'error' | 'trust-level-low';
  message?: string;
  errorCode?: string;
  onRetry?: () => void;
}

export function MappStatusScreen({ mode, message, errorCode, onRetry }: MappStatusScreenProps) {
  const isTrustLow = mode === 'trust-level-low' || errorCode === 'MAPP_TRUST_LEVEL_LOW';

  return (
    <main
      role="微应用-容器"
      className="flex min-h-dvh w-full items-center justify-center bg-bg p-4 text-fg"
    >
      <div
        role="微应用-卡片"
        className="w-full max-w-md rounded-xl border border-line bg-panel p-6 shadow-lg sm:p-8"
      >
        <div role="微应用-标题区" className="mb-6 text-center">
          <h1 role="微应用-标题" className="text-xl font-bold tracking-tight text-fg sm:text-2xl">
            SLG · 三国策略
          </h1>
          <p role="微应用-副标题" className="mt-1 text-[13px] text-faint">
            Linux.do 社区专属微应用版
          </p>
        </div>

        {mode === 'forum-login-required' ? (
          <section role="微应用-未登录提示" className="flex flex-col items-center gap-3 text-center">
            <div
              role="微应用-未登录图标"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft text-accent"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h2 role="微应用-未登录提示-标题" className="text-base font-semibold text-fg">
              请先登录论坛后进入
            </h2>
            <p role="微应用-未登录提示-说明" className="text-[13px] leading-relaxed text-dim">
              当前为论坛社区专属应用，请先在 Linux.do 论坛登录账号后再打开本游戏。
            </p>
          </section>
        ) : isTrustLow ? (
          <section role="微应用-信任等级不足提示" className="flex flex-col items-center gap-3 text-center">
            <div
              role="微应用-信任等级图标"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-warn/15 text-warn"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h2 role="微应用-信任等级不足-标题" className="text-base font-semibold text-fg">
              论坛信任等级不足
            </h2>
            <p role="微应用-信任等级不足-说明" className="text-[13px] leading-relaxed text-dim">
              {message || '当前微应用仅面向符合信任等级要求的论坛用户开放。请提升论坛信任等级后再进入。'}
            </p>
          </section>
        ) : mode === 'loading' ? (
          <section role="微应用-加载中" className="flex flex-col items-center gap-3 text-center">
            <div
              role="微应用-加载动效"
              className="h-9 w-9 animate-spin rounded-full border-2 border-accent border-t-transparent"
            />
            <p role="微应用-加载提示文案" className="text-[13.5px] text-dim">
              {message || '正在进入游戏…'}
            </p>
          </section>
        ) : (
          <section role="微应用-错误提示" className="flex flex-col items-center gap-3 text-center">
            <div
              role="微应用-错误图标"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-st-error/15 text-st-error"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <h2 role="微应用-错误提示-标题" className="text-base font-semibold text-fg">
              无法进入游戏
            </h2>
            <p role="微应用-错误提示-正文" className="text-[13px] leading-relaxed text-dim">
              {message || '连接失败或平台身份已过期，请重新进入应用。'}
            </p>
            {onRetry ? (
              <button
                type="button"
                role="微应用-重试按钮"
                onClick={onRetry}
                className="mt-2 inline-flex cursor-pointer items-center rounded-lg border border-accent-dim bg-accent-soft px-4 py-1.5 text-[13px] font-medium text-accent hover:brightness-110"
              >
                重试连接
              </button>
            ) : null}
          </section>
        )}
      </div>
    </main>
  );
}
