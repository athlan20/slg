/** 侧栏（docs/frontend-nav-layout.md 第 3 节）：顶部城池切换（下拉，列出全部城池）、七个导航项（图标 + 名字 + 角标）、
 *  底部账号按钮（带本人连接状态灯；菜单：城池改名 / 切换账号 / 重置账号 / 皮肤四选一）。
 *  1024–1279 收成 60px 图标栏；< 1024 变底部图标栏（城池切换与集市 / 榜收进账号菜单）。
 */

import { useEffect, useRef, useState } from 'react';
// role 定位值取静态中文文案源（AISLG-137 约定：role 不随界面语言变）
import { NAV_COPY as NAV_COPY_ZH } from '../../copy-ui';
import { getCopy, useCopy, useLang } from '../../i18n/bundle';
import { tName } from '../../i18n/names';
import type { ConnectionStatus } from '../../state/useGameSession';
import type { CityList } from '../../state/useCityList';
import { PAGE_KEYS, type PageKey } from '../../state/usePage';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { ThemeSwitcher } from '../ThemeSwitcher';

/** 各导航项的角标：count = 数字；hot = 红色（总览的 NPC 来袭） */
export type NavBadges = Partial<Record<PageKey, { count: number; hot?: boolean }>>;

interface SidebarProps {
  page: PageKey;
  onNavigate: (page: PageKey) => void;
  badges: NavBadges;
  cityList: CityList;
  /** 当前城详情是否在加载（切换中） */
  switching: boolean;
  onSelectCity: (cityId: string) => void;
  account: string | null;
  connection: ConnectionStatus;
  cityLoaded: boolean;
  onRename: () => void;
  onSettings: () => void;
  onSwitchAccount: () => void;
  onReset: () => void;
  onExchange: () => void;
  onLeaderboard: () => void;
  /** 手机端底部图标栏的聊天入口（AISLG-138）：点开全屏聊天；角标为私聊未读数 */
  chatOpen: boolean;
  chatUnread: number;
  onToggleChat: () => void;
}

/** 连接状态灯样式与文字（文字用户可见，按当前语言取文案包，不能放模块常量） */
function connectionLamp(connection: ConnectionStatus): { lamp: string; label: string } {
  const { COPY } = getCopy();
  const lamps: Record<ConnectionStatus, { lamp: string; label: string }> = {
    idle: { lamp: 'bg-st-offline', label: COPY.topbar.connectionLamp.idle },
    connecting: { lamp: 'bg-st-offline animate-pulse', label: COPY.topbar.connectionLamp.connecting },
    online: { lamp: 'bg-st-online shadow-[0_0_6px_var(--st-online)]', label: COPY.topbar.connectionLamp.online },
    reconnecting: { lamp: 'bg-st-error animate-pulse', label: COPY.topbar.connectionLamp.reconnecting },
  };
  return lamps[connection];
}

export function Sidebar(props: SidebarProps) {
  const copy = useCopy();
  const lang = useLang();
  const { COPY, CITY_COPY, NAV_COPY, EXTRA_AUTH, CHAT_COPY } = copy;
  const { page, onNavigate, badges, cityList, switching, onSelectCity, account, connection, cityLoaded, chatOpen, chatUnread, onToggleChat } = props;
  const [cityOpen, setCityOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);

  // 点侧栏外 / Esc 关闭两个下拉
  useEffect(() => {
    if (!cityOpen && !accountOpen) {
      return undefined;
    }
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setCityOpen(false);
        setAccountOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCityOpen(false);
        setAccountOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [cityOpen, accountOpen]);

  const { cities, activeCityId } = cityList;
  const current = cities.find((item) => item.id === activeCityId) ?? cities[0] ?? null;
  const lamp = connectionLamp(connection);
  const chooseCity = (cityId: string) => {
    setCityOpen(false);
    setAccountOpen(false);
    if (cityId !== activeCityId) {
      onSelectCity(cityId);
    }
  };
  const menuItem = (role: string, label: string, onClick: () => void, extra = '') => (
    <button
      type="button"
      role={role}
      onClick={() => {
        setAccountOpen(false);
        onClick();
      }}
      className={`w-full cursor-pointer rounded px-2.5 py-1.5 text-left text-[12.5px] hover:bg-accent-soft ${extra}`}
    >
      {label}
    </button>
  );

  return (
    <aside
      ref={rootRef}
      role="导航-侧栏"
      className="relative flex min-h-0 flex-col gap-2 rounded-panel border border-line bg-panel p-2 [grid-area:side] max-lg:flex-row max-lg:items-stretch max-lg:gap-1 max-lg:p-1"
    >
      <button
        type="button"
        role="导航-城池切换"
        aria-haspopup="listbox"
        aria-expanded={cityOpen}
        disabled={current === null || switching}
        onClick={() => {
          setAccountOpen(false);
          setCityOpen((open) => !open);
        }}
        className="flex min-w-0 shrink-0 cursor-pointer items-center gap-2 rounded-md border border-transparent p-1 text-left hover:border-line disabled:cursor-default max-lg:hidden"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[5px] border border-accent-dim bg-accent-soft text-[15px] font-semibold text-accent">
          {(current ? tName(current.name) : EXTRA_AUTH.sidebar.avatarFallback).slice(0, 1)}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight max-xl:hidden">
          <b role="导航-城池名" className="truncate text-[14px]" title={current ? tName(current.name) : undefined}>
            {switching ? NAV_COPY.citySwitching : current ? tName(current.name) : NAV_COPY.cityLoading}
          </b>
          <small className="truncate text-[11px] text-dim">
            {current ? (cities.length > 1 ? NAV_COPY.cityMeta(current.level, cities.length) : NAV_COPY.cityMetaSolo(current.level)) : ''}
          </small>
        </span>
        <span className="text-faint max-xl:hidden">▾</span>
      </button>
      {cityOpen ? (
        <CityMenu cityList={cityList} onChoose={chooseCity} className="left-1 top-[52px] max-lg:hidden" />
      ) : null}

      <nav role="导航-菜单" className="flex min-h-0 flex-1 flex-col gap-0.5 max-lg:flex-row max-lg:justify-around">
        {PAGE_KEYS.map((key) => {
          const item = NAV_COPY.pages[key];
          const badge = badges[key];
          const on = page === key;
          return (
            <button
              key={key}
              type="button"
              role={`导航-${NAV_COPY_ZH.pages[key].label}`}
              aria-current={on ? 'page' : undefined}
              title={item.label}
              onClick={() => onNavigate(key)}
              className={`relative flex min-w-0 cursor-pointer items-center gap-2.5 rounded-[5px] px-2.5 py-2 text-left text-[13px] max-xl:justify-center max-xl:px-0 max-lg:flex-1 max-lg:flex-col max-lg:gap-0.5 max-lg:px-0 max-lg:py-1 max-lg:text-[10.5px] ${
                on ? 'bg-accent-soft text-accent' : 'text-dim hover:text-fg'
              }`}
            >
              <b
                className={`grid h-[22px] w-[22px] shrink-0 place-items-center rounded border text-[12px] font-semibold ${
                  on ? 'border-accent-dim' : 'border-line'
                }`}
              >
                {item.icon}
              </b>
              <span className="max-xl:hidden max-lg:inline">{item.label}</span>
              {badge && badge.count > 0 ? (
                <i
                  role={`导航-${NAV_COPY_ZH.pages[key].label}-角标`}
                  className={`ml-auto min-w-[18px] rounded-full px-1.5 text-center text-[10.5px] not-italic max-xl:absolute max-xl:right-0.5 max-xl:top-0.5 max-xl:ml-0 max-xl:min-w-[14px] max-xl:px-1 max-xl:text-[9px] max-lg:right-1.5 ${
                    badge.hot ? 'bg-st-error text-bg' : 'bg-line text-fg'
                  }`}
                >
                  {badge.count}
                </i>
              ) : null}
            </button>
          );
        })}
        {/* 手机端（< 1024）底部图标栏的聊天入口；桌面端聊天入口在底栏左侧（收起条） */}
        <button
          type="button"
          role="导航-聊天"
          aria-pressed={chatOpen}
          title={CHAT_COPY.launcher.label}
          onClick={onToggleChat}
          className="relative hidden min-w-0 cursor-pointer flex-col items-center gap-0.5 rounded-[5px] px-0 py-1 text-[10.5px] text-dim hover:text-fg max-lg:flex max-lg:flex-1"
        >
          <b className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded border border-line text-[12px] font-semibold">
            {CHAT_COPY.launcher.label.slice(0, 1)}
          </b>
          <span className="max-lg:inline">{CHAT_COPY.launcher.label}</span>
          {chatUnread > 0 ? (
            <i
              role="导航-聊天-角标"
              className="absolute right-1.5 top-0 rounded-full bg-st-error px-1 text-center text-[9.5px] not-italic text-bg"
            >
              {chatUnread > 99 ? '99+' : chatUnread}
            </i>
          ) : null}
        </button>
      </nav>

      <div role="导航-侧栏底部" className="relative shrink-0 max-lg:flex max-lg:items-center">
        {/* 开源仓库入口（AISLG-137 海外推广）：桌面宽侧栏常驻一角，悬停提示按界面语言取；新标签打开避免断开游戏会话 */}
        <a
          className="mb-1 hidden px-2.5 text-[11px] text-faint underline-offset-2 hover:text-accent hover:underline xl:block"
          role="侧栏-GitHub仓库"
          href="https://github.com/athlan20/slg"
          target="_blank"
          rel="noreferrer"
          title={COPY.login.repoLink}
        >
          GitHub ↗
        </a>
        <button
          type="button"
          role="侧栏-账号按钮"
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          title={account ?? NAV_COPY.account}
          onClick={() => {
            setCityOpen(false);
            setAccountOpen((open) => !open);
          }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-[5px] border border-line bg-panel-2 px-2.5 py-1.5 text-left text-[12px] hover:border-accent-dim hover:text-accent max-xl:justify-center max-xl:px-0 max-lg:h-full max-lg:w-12 max-lg:flex-col max-lg:gap-0.5 max-lg:py-1 max-lg:text-[10.5px]"
        >
          <i
            role="顶栏-本人在线状态"
            title={`${COPY.topbar.self}${lang === 'zh' ? '：' : ': '}${lamp.label}`}
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${lamp.lamp}`}
          />
          <span role="侧栏-账号" className="min-w-0 flex-1 truncate max-xl:hidden max-lg:hidden">
            {account ?? NAV_COPY.account}
          </span>
          <span className="hidden max-xl:inline max-lg:inline">{NAV_COPY.accountShort}</span>
          <span className="text-faint max-xl:hidden max-lg:hidden">▾</span>
        </button>
        {accountOpen ? (
          <div
            role="账号菜单"
            className="absolute bottom-[calc(100%+4px)] left-0 z-30 flex w-[220px] flex-col rounded-md border border-line bg-panel-2 p-1 shadow-2xl max-lg:bottom-[calc(100%+8px)] max-lg:left-auto max-lg:right-0"
          >
            {cityLoaded ? menuItem('账号菜单-城池改名', NAV_COPY.rename, props.onRename) : null}
            {menuItem('账号菜单-账号设置', NAV_COPY.settings, props.onSettings)}
            {menuItem('账号菜单-切换账号', NAV_COPY.switchAccount, props.onSwitchAccount)}
            {menuItem('账号菜单-重置账号', NAV_COPY.reset, props.onReset, 'text-st-error')}
            <div className="hidden max-lg:block">
              {menuItem('账号菜单-集市', NAV_COPY.exchangeMobile, props.onExchange)}
              {menuItem('账号菜单-排行榜', NAV_COPY.leaderboardMobile, props.onLeaderboard)}
              {cities.length > 1 ? (
                <>
                  <p className="px-2.5 pt-1.5 text-[11px] text-faint">{NAV_COPY.cityMenuTitle}</p>
                  {cities.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      role="账号菜单-城池"
                      onClick={() => chooseCity(item.id)}
                      className={`flex w-full cursor-pointer items-baseline justify-between gap-2 rounded px-2.5 py-1 text-left text-[12.5px] hover:bg-accent-soft ${
                        item.id === activeCityId ? 'text-accent' : ''
                      }`}
                    >
                      <span className="truncate">{tName(item.name)}</span>
                      <span className="shrink-0 font-mono text-[11px] text-faint">{CITY_COPY.switcher.levelTag(item.level)}</span>
                    </button>
                  ))}
                </>
              ) : null}
            </div>
            <div className="border-t border-line-soft">
              <LanguageSwitcher />
            </div>
            <div className="mt-1 border-t border-line-soft">
              <ThemeSwitcher />
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/** 城池下拉：全部城池（名字 / 等级 / 主城·分城 / 坐标），当前城打勾，底部给分城名额 */
function CityMenu({ cityList, onChoose, className }: { cityList: CityList; onChoose: (cityId: string) => void; className: string }) {
  const copy = useCopy();
  const { CITY_COPY, NAV_COPY } = copy;
  const { cities, activeCityId, branch } = cityList;
  return (
    <div
      role="导航-城池下拉"
      className={`absolute z-30 flex min-w-[200px] max-w-[320px] flex-col rounded-md border border-line bg-panel-2 p-1 shadow-2xl ${className}`}
    >
      {cities.map((item) => {
        const active = item.id === activeCityId;
        return (
          <button
            key={item.id}
            type="button"
            role="城池下拉-城池"
            title={CITY_COPY.switcher.tabTitle(tName(item.name), item.level, item.x, item.y)}
            onClick={() => onChoose(item.id)}
            className={`flex cursor-pointer items-baseline justify-between gap-3 rounded px-2.5 py-1.5 text-left text-[12.5px] hover:bg-accent-soft ${
              active ? 'text-accent' : ''
            }`}
          >
            <span className="min-w-0 truncate">
              {active ? '✓ ' : ''}
              {tName(item.name)}{' '}
              <small className="text-faint">
                {CITY_COPY.switcher.levelTag(item.level)} · {item.isMain ? NAV_COPY.cityMain : NAV_COPY.cityBranch}
              </small>
            </span>
            <span className="shrink-0 font-mono text-[11px] text-faint">{item.x !== null && item.y !== null ? `${item.x},${item.y}` : ''}</span>
          </button>
        );
      })}
      {branch ? (
        <p role="城池下拉-分城名额" title={CITY_COPY.switcher.branchLocked(branch.minGovernment)} className="border-t border-line-soft px-2.5 pt-1 text-[11px] text-faint">
          {CITY_COPY.switcher.branchQuota(branch.count, branch.limit)}
        </p>
      ) : null}
    </div>
  );
}
