/** 顶栏（docs/frontend-nav-layout.md 第 3 节）：页面标题 · 资源 ×5 + 人口 · 警报胶囊 · 集市 · 榜。
 *  高度 52px（矮屏 46px）；< 1024 换行：第一行标题 + 城池胶囊 + 赛季胶囊，第二行资源 3×2 网格；警报与集市 / 榜按钮收进账号菜单。
 *  城池胶囊（AISLG-191）只在 < 1024 显示：「当前城池名 Lv ▾」，点开城池下拉（与侧栏共用 CityMenu）切换城池。
 */

import { useEffect, useRef, useState } from 'react';
import type { BattlefieldEventView, CityView, NpcAttackWarningPushData } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { tName } from '../../i18n/names';
import type { ExchangeResource } from '../../state/exchangeAction';
import type { SeasonInfo } from '../../state/seasonSession';
import type { CityList } from '../../state/useCityList';
import { useNav } from '../../state/NavContext';
import type { PageKey } from '../../state/usePage';
import { TruceShieldBadge } from '../TruceShieldBadge';
import { AlertPills } from './AlertPills';
import { CityMenu } from './CityMenu';
import { ExchangePopover } from './ExchangePopover';
import { ResourceStrip } from './ResourceStrip';
import { SeasonPill } from './SeasonPill';

interface TopBarProps {
  page: PageKey;
  city: CityView | null;
  incoming: NpcAttackWarningPushData[];
  onOpenWarning: () => void;
  onOpenLeaderboard: () => void;
  onExchange: (resource: ExchangeResource, amount: number) => Promise<string | null>;
  /** 开启主动免战（v38 AISLG-122）：成功返回 null，失败返回人读错误 */
  onStartTruce: () => Promise<string | null>;
  onCancelTruce: () => Promise<string | null>;
  /** 当前赛季（v65 AISLG-134）：常驻赛季胶囊；未登录 / 未取到为 null */
  season: SeasonInfo | null;
  /** 城池列表与切换（AISLG-191）：手机顶栏城池胶囊用，与侧栏共用同一份数据 */
  cityList: CityList;
  onSelectCity: (cityId: string) => void;
  /** 当前城详情在重拉（切换中）：胶囊显示「切换中…」并禁用 */
  switching: boolean;
  /** 剧本战场（v75 AISLG-198）：没有战场时为 null；报名 / 进行中显示常驻胶囊 */
  battlefield: BattlefieldEventView | null;
  onOpenBattlefield: () => void;
  /** 玩家交易所（v78 AISLG-196） */
  onOpenMarket: () => void;
}

const topBtn =
  'cursor-pointer rounded-[5px] border border-line bg-panel-2 px-2.5 py-1 text-[12px] transition-colors hover:border-accent-dim hover:text-accent';

/** 弹层宽度上限与屏幕边距（与 CityMenu 的 max-w-[320px] 一致） */
const CAPSULE_MENU_MAX_WIDTH = 320;
const SCREEN_GUTTER = 8;

export function TopBar({
  page,
  city,
  incoming,
  onOpenWarning,
  onOpenLeaderboard,
  onExchange,
  onStartTruce,
  onCancelTruce,
  season,
  cityList,
  onSelectCity,
  switching,
  battlefield,
  onOpenBattlefield,
  onOpenMarket,
}: TopBarProps) {
  const copy = useCopy();
  const { COPY, NAV_COPY, TOP_COPY, BATTLEFIELD_COPY, MARKET_COPY } = copy;
  const { exchangeAsk } = useNav();
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [lastAskId, setLastAskId] = useState(exchangeAsk.id);
  const [neededGold, setNeededGold] = useState<number | undefined>();
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  // 侧栏账号菜单 / 资源缺口浮层请求打开集市：id 变化 → 打开（手机上锚点隐藏时居中）
  if (exchangeAsk.id !== lastAskId) {
    setLastAskId(exchangeAsk.id);
    setNeededGold(exchangeAsk.neededGold);
    setExchangeOpen(true);
  }

  return (
    <header
      role="导航-顶栏"
      className="nav-top flex min-w-0 items-center gap-2 rounded-panel border border-line bg-panel px-2.5 py-1 max-lg:flex-wrap max-lg:gap-x-2 max-lg:gap-y-1.5 max-lg:py-1.5"
    >
      <h1 role="导航-页面标题" className="mx-1 min-w-14 shrink-0 whitespace-nowrap text-base font-semibold max-lg:w-auto">
        {NAV_COPY.pages[page].label}
      </h1>
      <CityCapsule cityList={cityList} onSelectCity={onSelectCity} switching={switching} />
      {/* 手机上资源条独占一行（max-lg:order-1 排到赛季胶囊之后、basis-full 换行） */}
      <div className="flex min-w-0 flex-1 max-lg:order-1 max-lg:basis-full">
        {city ? (
          <ResourceStrip city={city} />
        ) : (
          <p role="顶栏-资源加载中" className="min-w-0 flex-1 truncate text-[12px] text-faint">
            {TOP_COPY.loading}
          </p>
        )}
      </div>
      <SeasonPill info={season} />
      {battlefield ? (
        <button
          type="button"
          role="顶栏-剧本战场"
          onClick={onOpenBattlefield}
          title={BATTLEFIELD_COPY.launcher.title}
          className={`${topBtn} ${battlefield.status === 'active' ? 'border-gold text-gold' : battlefield.status === 'signup' ? 'border-accent-dim text-accent' : ''}`}
        >
          {battlefield.status === 'signup' ? BATTLEFIELD_COPY.launcher.signup : battlefield.status === 'active' ? BATTLEFIELD_COPY.scripts[battlefield.script] : BATTLEFIELD_COPY.launcher.finished}
          {battlefield.status === 'active' ? (
            <b className="ml-1 font-mono">
              {battlefield.camps.yuan.score}:{battlefield.camps.cao.score}
            </b>
          ) : null}
        </button>
      ) : null}
      <AlertPills city={city} incoming={incoming} onOpenWarning={onOpenWarning} />
      {city ? (
        <div className="shrink-0 max-lg:hidden">
          <TruceShieldBadge
            newbieUntil={city.newbieUntil}
            shieldUntil={city.shieldUntil}
            shieldNextAt={city.shieldNextAt}
            onStartTruce={onStartTruce}
            onCancelTruce={onCancelTruce}
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
          onClick={() => {
            setNeededGold(undefined);
            setExchangeOpen((open) => !open);
          }}
          className={`${topBtn} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {TOP_COPY.exchange}
        </button>
        <button
          type="button"
          role="顶栏-交易所按钮"
          title={MARKET_COPY.launcher.title}
          aria-label={MARKET_COPY.launcher.open}
          onClick={onOpenMarket}
          className={topBtn}
        >
          {MARKET_COPY.launcher.open}
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
        <ExchangePopover
          key={exchangeAsk.id}
          resources={city.resources}
          anchorRef={anchorRef}
          neededGold={neededGold}
          onExchange={onExchange}
          onOpenMarket={() => {
            setExchangeOpen(false);
            onOpenMarket();
          }}
          onClose={() => setExchangeOpen(false)}
        />
      ) : null}
    </header>
  );
}

/** 手机顶栏城池胶囊（AISLG-191）：「当前城池名 Lv ▾」，点开城池下拉（fixed 定位，不被顶栏裁剪）。
 *  顶栏在侧栏外，所以自己监听外部点击（pointerdown，触屏也算）与 Esc 关闭。桌面（≥ 1024）整块隐藏。
 */
function CityCapsule({ cityList, onSelectCity, switching }: { cityList: CityList; onSelectCity: (cityId: string) => void; switching: boolean }) {
  const { CITY_COPY, NAV_COPY } = useCopy();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { cities, activeCityId } = cityList;
  const current = cities.find((item) => item.id === activeCityId) ?? cities[0] ?? null;
  const menuOpen = open && cities.length > 0;

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const onDown = (event: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // 弹层锚在胶囊下方、左对齐胶囊，宽度不超过屏幕（左右留 8px）
  const rect = buttonRef.current?.getBoundingClientRect();
  const menuWidth = Math.min(CAPSULE_MENU_MAX_WIDTH, window.innerWidth - SCREEN_GUTTER * 2);
  const menuLeft = rect ? Math.max(SCREEN_GUTTER, Math.min(rect.left, window.innerWidth - SCREEN_GUTTER - menuWidth)) : SCREEN_GUTTER;
  const menuTop = rect ? rect.bottom + 6 : 52;

  return (
    <div ref={wrapRef} className="hidden min-w-0 max-lg:flex max-lg:flex-1">
      <button
        ref={buttonRef}
        type="button"
        role="顶栏-城池胶囊"
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        title={current ? CITY_COPY.switcher.tabTitle(tName(current.name), current.level, current.x, current.y) : undefined}
        disabled={current === null || switching}
        onClick={() => setOpen((value) => !value)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[5px] border border-line bg-panel-2 px-2 py-1 text-left text-[12.5px] transition-colors hover:border-accent-dim hover:text-accent disabled:cursor-default disabled:opacity-60"
      >
        {switching || current === null ? (
          <span className="min-w-0 flex-1 truncate">{switching ? NAV_COPY.citySwitching : NAV_COPY.cityLoading}</span>
        ) : (
          <>
            <b className="min-w-0 flex-1 truncate font-semibold">{tName(current.name)}</b>
            <small className="shrink-0 font-mono text-[11px] text-dim">{NAV_COPY.cityMetaSolo(current.level)}</small>
          </>
        )}
        <span className="shrink-0 text-faint">▾</span>
      </button>
      {menuOpen ? (
        <CityMenu
          cityList={cityList}
          onChoose={(cityId) => {
            setOpen(false);
            if (cityId !== activeCityId) {
              onSelectCity(cityId);
            }
          }}
          onLocate={() => setOpen(false)}
          style={{ top: menuTop, left: menuLeft }}
          className="fixed z-50 w-[min(320px,calc(100vw-16px))] max-h-[min(70dvh,420px)] overflow-y-auto"
        />
      ) : null}
    </div>
  );
}
