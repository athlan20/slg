/** 地图格上的活动徽章（从 WorldMapGrid 拆出以控制单文件行数）：黄巾营地 / 老巢（v29 AISLG-76）与移动目标
 *  （v28 AISLG-78：当前所在格画徽章、尚未走过的路线格画小点）。 */

import type { TileView } from '../api/protocol';

export interface MovingMark {
  kind: 'caravan' | 'bandit';
  label: string;
  level: number;
  current: boolean;
}

export function WorldTileBadges({ tile, mark, hideCamp = false }: { tile: TileView; mark: MovingMark | undefined; hideCamp?: boolean }) {
  return (
    <>
      {tile.camp && !hideCamp ? (
        <span
          role="世界地图视野-黄巾营地"
          title={tile.camp.label}
          className={`absolute left-[4%] top-[4%] grid h-[34%] w-[34%] place-items-center rounded-[3px] font-semibold leading-none text-bg shadow-[0_0_8px_currentColor] text-[clamp(8px,1.4cqw,13px)] ${
            tile.camp.tier === 'boss' ? 'bg-gold' : tile.camp.tier === 'large' ? 'bg-st-error' : 'bg-warn'
          }`}
        >
          {tile.camp.tier === 'boss' ? '巢' : '巾'}
        </span>
      ) : null}
      {mark ? (
        <span
          role={mark.current ? '世界地图视野-移动目标' : '世界地图视野-移动目标路线'}
          title={`${mark.label} Lv${mark.level}`}
          className={
            mark.current
              ? `absolute right-[4%] top-[4%] grid h-[34%] w-[34%] place-items-center rounded-full font-semibold leading-none text-bg shadow-[0_0_8px_currentColor] text-[clamp(8px,1.4cqw,13px)] ${
                  mark.kind === 'bandit' ? 'bg-warn' : 'bg-gold'
                }`
              : `absolute bottom-[8%] left-[8%] h-[14%] w-[14%] rounded-full opacity-80 ${mark.kind === 'bandit' ? 'bg-warn' : 'bg-gold'}`
          }
        >
          {mark.current ? (mark.kind === 'bandit' ? '寇' : '商') : null}
        </span>
      ) : null}
    </>
  );
}
