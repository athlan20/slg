import { useMemo, useState } from 'react';
import type { LeaderboardKind } from './api/protocol';
import { AppShell } from './components/shell/AppShell';
import { LoginPanel } from './components/LoginPanel';
import { ModalHost } from './components/shell/ModalHost';
import { BattleReportModalProvider } from './state/battleReportModal';
import { GameContext, type GameState } from './state/GameContext';
import { HeroContext, type HeroPickState } from './state/heroContext';
import { NavProvider } from './state/NavContext';
import { ScoutReportModalProvider } from './state/scoutReportModal';
import { useGameSession } from './state/useGameSession';
import { useIncomingAttacks } from './state/useIncomingAttacks';

export default function App() {
  const session = useGameSession();
  const loggedIn = session.account !== null;
  // 出发城坐标（AISLG-72）：当前操作的城（缺省主城）在 GET_STATE cities 里的世界坐标；未分配坐标的城不给行军时长预估
  const activeCityRef = session.cityList.cities.find((item) => item.id === session.cityList.activeCityId) ?? session.cityList.cities[0] ?? null;
  const marchOrigin = activeCityRef !== null && activeCityRef.x !== null && activeCityRef.y !== null ? { x: activeCityRef.x, y: activeCityRef.y } : null;

  // 弹窗开关：排行榜（v23 AISLG-61）/ 黄巾之乱详情 / 顶栏胶囊重开的来袭提醒
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [leaderboardKind, setLeaderboardKind] = useState<LeaderboardKind>('power');
  const [ytOpen, setYtOpen] = useState(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const { fetchLeaderboard } = session;
  const openLeaderboard = (kind: LeaderboardKind = leaderboardKind) => {
    setLeaderboardKind(kind);
    setLeaderboardOpen(true);
    void fetchLeaderboard(kind);
  };

  // NPC 来袭记录（到达前一直有效）：顶栏警报胶囊 / 军情摘要用
  const incoming = useIncomingAttacks(session.npcWarnings, session.account?.accountId ?? null);

  // 出征带将上下文（v36 AISLG-114）：出征 / 侦察 / 截击 / 运输表单的「随队将领」选择器共用
  const heroSession = session.heroSession;
  const heroPick = useMemo<HeroPickState>(
    () => ({
      heroes: heroSession.state?.heroes ?? [],
      selectedHeroId: heroSession.selectedHeroId,
      selectHero: heroSession.selectHero,
      afterMarch: () => {
        heroSession.selectHero(null);
        void heroSession.fetchHeroes();
      },
    }),
    [heroSession.state, heroSession.selectedHeroId, heroSession.selectHero, heroSession.fetchHeroes],
  );

  const game: GameState = {
    session,
    marchOrigin,
    incoming,
    openWarning: () => setWarningOpen(true),
    openLeaderboard,
    openYellowTurban: () => setYtOpen(true),
  };

  return (
    <HeroContext.Provider value={heroPick}>
      <BattleReportModalProvider fetchReportById={session.world.fetchBattleReportById}>
        <ScoutReportModalProvider city={session.city}>
          <GameContext.Provider value={game}>
            <NavProvider>
              {loggedIn ? (
                <>
                  <AppShell />
                  <ModalHost
                    leaderboardOpen={leaderboardOpen}
                    leaderboardKind={leaderboardKind}
                    onSelectLeaderboardKind={openLeaderboard}
                    onCloseLeaderboard={() => {
                      setLeaderboardOpen(false);
                      session.closeLeaderboard();
                    }}
                    ytOpen={ytOpen}
                    onCloseYt={() => setYtOpen(false)}
                    warningOpen={warningOpen}
                    onCloseWarning={() => setWarningOpen(false)}
                  />
                </>
              ) : (
                <main role="主体-未登录" className="flex h-dvh justify-center overflow-y-auto p-3">
                  <div role="主体-登录框" className="mt-[10vh] h-fit w-full max-w-lg">
                    <LoginPanel
                      booting={session.booting}
                      loginBusy={session.loginBusy}
                      loginError={session.loginError}
                      lastUsername={session.lastUsername}
                      onLogin={(username, password) => void session.login(username, password)}
                      connectForWechat={session.connectForWechat}
                      onWechatToken={(token) => void session.loginWithWechatToken(token)}
                      onGoogleToken={(token) => void session.loginWithGoogleToken(token)}
                    />
                  </div>
                </main>
              )}
            </NavProvider>
          </GameContext.Provider>
        </ScoutReportModalProvider>
      </BattleReportModalProvider>
    </HeroContext.Provider>
  );
}
