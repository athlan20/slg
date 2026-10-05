/** 全局弹窗宿主：离线日报（上线自动弹出 / 手动打开）、NPC 来袭提醒（推送立即弹出，逐条确认；顶栏胶囊可重新打开）、
 *  排行榜、黄巾之乱详情。战报 / 侦察报告弹窗由各自的 Provider 宿主（state/battleReportModal、scoutReportModal）。
 */

import type { LeaderboardKind } from '../../api/protocol';
import { useGame } from '../../state/GameContext';
import { useNav } from '../../state/NavContext';
import { LeaderboardModal } from '../LeaderboardModal';
import { NpcWarningModal } from '../NpcWarningModal';
import { OfflineReportModal } from '../OfflineReportModal';
import { YellowTurbanModal } from '../YellowTurbanModal';

interface ModalHostProps {
  leaderboardOpen: boolean;
  leaderboardKind: LeaderboardKind;
  onSelectLeaderboardKind: (kind: LeaderboardKind) => void;
  onCloseLeaderboard: () => void;
  ytOpen: boolean;
  onCloseYt: () => void;
  /** 顶栏胶囊手动重开的来袭提醒 */
  warningOpen: boolean;
  onCloseWarning: () => void;
}

export function ModalHost(props: ModalHostProps) {
  const { session, incoming } = useGame();
  const { go } = useNav();
  const { world } = session;
  // 推送刚到的待确认预警优先；否则是玩家点胶囊重开的最近一条
  const pending = session.npcWarnings[0] ?? null;
  const warning = pending ?? (props.warningOpen ? (incoming[0] ?? null) : null);

  const dismiss = () => {
    if (pending) {
      session.dismissNpcWarning(pending.attackId);
    } else {
      props.onCloseWarning();
    }
  };

  return (
    <>
      {session.offlineReport ? <OfflineReportModal data={session.offlineReport} onClose={session.closeOfflineReport} /> : null}
      {warning ? (
        <NpcWarningModal
          warning={warning}
          onDismiss={dismiss}
          onReinforce={() => {
            if (warning.target === 'city') {
              go('army');
            } else {
              world.centerOn(warning.x, warning.y);
              world.selectTile(warning.x, warning.y);
              go('map');
            }
            dismiss();
          }}
        />
      ) : null}
      {props.leaderboardOpen ? (
        <LeaderboardModal view={session.leaderboard} loading={session.leaderboardLoading} onClose={props.onCloseLeaderboard} onSelectKind={props.onSelectLeaderboardKind} />
      ) : null}
      {props.ytOpen ? <YellowTurbanModal state={session.yellowTurban.state} world={world} onClose={props.onCloseYt} /> : null}
    </>
  );
}
