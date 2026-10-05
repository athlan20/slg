// 游戏会话上下文：App 里 useGameSession 只调用一次，各页面经 useGame() 取会话与派生值，
// 不再逐层传一长串 props。派生值：出发城坐标（AISLG-72）、排行榜弹窗开关。

import { createContext, useContext } from 'react';
import type { LeaderboardKind, NpcAttackWarningPushData } from '../api/protocol';
import type { GameSession } from './useGameSession';

export interface GameState {
  session: GameSession;
  /** 出发城坐标：当前操作的城（缺省主城）在 GET_STATE cities 里的世界坐标；未分配坐标为 null */
  marchOrigin: { x: number; y: number } | null;
  /** 还没到达的 NPC 来袭（按到达时间升序）：顶栏胶囊 / 军情摘要用 */
  incoming: NpcAttackWarningPushData[];
  /** 重新打开某条来袭的提醒弹窗（顶栏胶囊 / 军情摘要点击） */
  openWarning: () => void;
  openLeaderboard: (kind?: LeaderboardKind) => void;
  /** 黄巾之乱详情弹窗（地图黄巾浮卡 / 总览摘要入口） */
  openYellowTurban: () => void;
}

export const GameContext = createContext<GameState | null>(null);

export function useGame(): GameState {
  const value = useContext(GameContext);
  if (!value) {
    throw new Error('useGame 需在 GameContext.Provider 内使用');
  }
  return value;
}
