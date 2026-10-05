/** 已登录外壳（方案 D「导航工作区」）：侧栏 + 顶栏 + 单页工作区 + 底栏。工作区一次只放一页，每页是固定单屏网格，
 *  内容放不下就分页 / 截断，任何窗口尺寸都不出现竖向滚动条。账号相关确认框在这里挂载。 */

import { useState } from 'react';
import { useGame } from '../../state/GameContext';
import { useNav } from '../../state/NavContext';
import { activeMarches } from '../../state/progressItems';
import { AgentPage } from '../pages/AgentPage';
import { ArmyPage } from '../pages/ArmyPage';
import { CityPage } from '../pages/CityPage';
import { GrowthPage } from '../pages/GrowthPage';
import { IntelPage } from '../pages/IntelPage';
import { MapPage } from '../pages/MapPage';
import { OverviewPage } from '../pages/OverviewPage';
import { AccountDialogs, type AccountDialogMode } from './AccountDialogs';
import { BottomBar } from './BottomBar';
import { Sidebar, type NavBadges } from './Sidebar';
import { TopBar } from './TopBar';

export function AppShell() {
  const { session, incoming, openWarning, openLeaderboard } = useGame();
  const { page, go, seenReportId } = useNav();
  const [dialog, setDialog] = useState<AccountDialogMode | null>(null);
  const [exchangeRequest, setExchangeRequest] = useState(0);
  const city = session.city;

  // 导航角标（docs 第 4 节）：总览 = NPC 来袭数（红）；城池 = 建造队列条数；军队 = 在外行军数；
  // 养成 = 进行中的研究数；情报 = 进入情报页后新到的战报数；Agent 无
  const newReports = (session.world.battleReports ?? []).filter((report) => report.id > seenReportId).length;
  const badges: NavBadges = {
    overview: { count: incoming.length, hot: true },
    city: { count: city?.queue.length ?? 0 },
    army: { count: city ? activeMarches(city).length : 0 },
    growth: { count: session.techSession.tech?.research ? 1 : 0 },
    intel: { count: page === 'intel' ? 0 : newReports },
  };

  return (
    <div role="导航布局" className="nav-shell">
      <Sidebar
        page={page}
        onNavigate={go}
        badges={badges}
        cityList={session.cityList}
        switching={city === null}
        onSelectCity={(cityId) => void session.switchCity(cityId)}
        account={session.account?.username ?? null}
        connection={session.connection}
        cityLoaded={city !== null}
        onRename={() => setDialog('rename')}
        onSettings={() => setDialog('settings')}
        onSwitchAccount={() => setDialog('switch')}
        onReset={() => setDialog('reset')}
        onExchange={() => setExchangeRequest((n) => n + 1)}
        onLeaderboard={() => openLeaderboard()}
      />
      <TopBar
        page={page}
        city={city}
        incoming={incoming}
        onOpenWarning={openWarning}
        onOpenLeaderboard={() => openLeaderboard()}
        onExchange={session.exchangeGold}
        exchangeRequest={exchangeRequest}
        onStartTruce={session.startTruce}
      />
      <main role="导航-工作区" className="nav-work">
        {page === 'overview' ? <OverviewPage /> : null}
        {page === 'map' ? <MapPage /> : null}
        {page === 'city' ? <CityPage /> : null}
        {page === 'army' ? <ArmyPage /> : null}
        {page === 'growth' ? <GrowthPage /> : null}
        {page === 'intel' ? <IntelPage /> : null}
        {page === 'agent' ? <AgentPage /> : null}
      </main>
      <BottomBar
        city={city}
        research={session.techSession.tech?.research ?? null}
        broadcasts={session.broadcasts}
        onOpenBroadcasts={() => void session.fetchServerBroadcasts()}
      />
      {dialog ? (
        <AccountDialogs
          mode={dialog}
          cityName={city?.name ?? null}
          onClose={() => setDialog(null)}
          onSwitchAccount={() => void session.logout()}
          onResetAccount={session.resetAccount}
          onRenameCity={session.renameCity}
        />
      ) : null}
    </div>
  );
}
