/** 顶栏（docs/frontend-nav-layout.md 第 3 节）：页面标题 · 资源 ×5 + 人口 · 警报胶囊 · 集市 · 榜。
 *  高度 52px（矮屏 46px）；< 1024 换行：标题 + 资源 3×2 网格，警报与集市 / 榜按钮收进账号菜单。
 */

import { useRef, useState } from 'react';
import type { CityView, NpcAttackWarningPushData } from '../../api/protocol';
import { COPY } from '../../copy';
import { NAV_COPY, TOP_COPY } from '../../copy-ui';
import type { ExchangeResource } from '../../state/exchangeAction';
import type { PageKey } from '../../state/usePage';
import { TruceShieldBadge } from '../TruceShieldBadge';
import { AlertPills } from './AlertPills';
import { ExchangePopover } from './ExchangePopover';
import { ResourceStrip } from './ResourceStrip';

interface TopBarProps {
  page: PageKey;
  city: CityView | null;
  incoming: NpcAttackWarningPushData[];
  onOpenWarning: () => void;
  onOpenLeaderboard: () => void;
  onExchange: (resource: ExchangeResource, amount: number) => Promise<string | null>;
  /** 手机上集市入口在账号菜单里：外部（账号菜单）请求打开浮层的计数，变化即打开 */
  exchangeRequest: number;
  /** 开启主动免战（v38 AISLG-122）：成功返回 null，失败返回人读错误 */
  onStartTruce: () => Promise<string | null>;
}

const topBtn =
  'cursor-pointer rounded-[5px] border border-line bg-panel-2 px-2.5 py-1 text-[12px] transition-colors hover:border-accent-dim hover:text-accent';

export function TopBar({ page, city, incoming, onOpenWarning, onOpenLeaderboard, onExchange, exchangeRequest, onStartTruce }: TopBarProps) {
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [lastRequest, setLastRequest] = useState(exchangeRequest);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  // 账号菜单里点「集市」：计数变化 → 打开浮层（居中，因为锚点按钮在手机上隐藏）
  if (exchangeRequest !== lastRequest) {
    setLastRequest(exchangeRequest);
    setExchangeOpen(true);
  }

  return (
    <header
      role="导航-顶栏"
      className="nav-top flex min-w-0 items-center gap-2 rounded-panel border border-line bg-panel px-2.5 py-1 max-lg:flex-wrap max-lg:gap-x-2 max-lg:gap-y-1.5 max-lg:py-1.5"
    >
      <h1 role="导航-页面标题" className="mx-1 w-14 shrink-0 whitespace-nowrap text-base font-semibold max-lg:w-auto">
        {NAV_COPY.pages[page].label}
      </h1>
      {city ? (
        <ResourceStrip city={city} />
      ) : (
        <p role="顶栏-资源加载中" className="min-w-0 flex-1 truncate text-[12px] text-faint">
          {TOP_COPY.loading}
        </p>
      )}
      <AlertPills city={city} incoming={incoming} onOpenWarning={onOpenWarning} />
      {city ? (
        <div className="shrink-0 max-lg:hidden">
          <TruceShieldBadge
            newbieUntil={city.newbieUntil}
            shieldUntil={city.shieldUntil}
            shieldNextAt={city.shieldNextAt}
            onStartTruce={onStartTruce}
          />
        </div>
      ) : null}
      <div className="relative flex shrink-0 items-center gap-1.5 max-lg:hidden">
        <button
          ref={anchorRef}
          type="button"
          role="顶栏-集市按钮"
          title={COPY.exchange.open}
          aria-label={COPY.exchange.open}
          disabled={city === null}
          onClick={() => setExchangeOpen((open) => !open)}
          className={`${topBtn} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {TOP_COPY.exchange}
        </button>
        <button
          type="button"
          role="顶栏-排行榜按钮"
          title={COPY.leaderboard.title}
          aria-label={COPY.leaderboard.title}
          onClick={onOpenLeaderboard}
          className={topBtn}
        >
          {TOP_COPY.leaderboard}
        </button>
      </div>
      {exchangeOpen && city ? (
        <ExchangePopover resources={city.resources} anchorRef={anchorRef} onExchange={onExchange} onClose={() => setExchangeOpen(false)} />
      ) : null}
    </header>
  );
}
