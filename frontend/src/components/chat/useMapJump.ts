// 在地图上查看某格（AISLG-138）：切到地图页、以该格为中心并选中。聊天浮窗保持原样不收起（验收 9：切换页面时浮窗的
// 展开状态与当前频道不变）。
// 聊天卡片（坐标 / 城池）与地图页的分享入口共用。

import { useGame } from '../../state/GameContext';
import { useNav } from '../../state/NavContext';

export function useMapJump(): (x: number, y: number) => void {
  const { session } = useGame();
  const { go } = useNav();
  return (x: number, y: number) => {
    session.world.centerOn(x, y);
    session.world.selectTile(x, y);
    go('map');
  };
}
