// 地图选点（v91，AISLG-220）：指定坐标迁时，地图页顶部的选点提示条，以及选中空野地后的「迁城到这里」。
// 选点状态在 session.moveCity.pickCityId；确认仍走 MoveCityConfirm（preview → confirm）。

import { useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { MoveCityConfirm } from '../shell/MoveCityConfirm';

/** 选点提示条（地图页详情区顶部）：选点中才显示，给出取消选点 */
export function MoveCityPickBar() {
  const { MOVE_CITY_COPY: C } = useCopy();
  const { session } = useGame();
  const cityId = session.moveCity.pickCityId;
  if (cityId === null) {
    return null;
  }
  const name = session.cityList.cities.find((item) => item.id === cityId)?.name ?? '';
  return (
    <div role="迁城选点-提示条" className="flex flex-col gap-1.5 rounded border border-accent-dim bg-panel-2 px-2.5 py-2">
      <p className="break-words text-[12px] text-accent">{C.pickBanner(name)}</p>
      <button type="button" role="迁城选点-取消按钮" className="btn self-start" onClick={session.moveCity.cancelPick}>
        {C.pickCancel}
      </button>
    </div>
  );
}

/** 选中地块的「迁城到这里」：仅选点中生效；非空野地给出原因 */
export function MoveCityPickAction({ x, y, empty }: { x: number; y: number; empty: boolean }) {
  const { MOVE_CITY_COPY: C } = useCopy();
  const { session } = useGame();
  const [open, setOpen] = useState(false);
  const cityId = session.moveCity.pickCityId;
  if (cityId === null) {
    return null;
  }
  return (
    <div role="迁城选点-操作区" className="flex flex-col gap-1">
      {empty ? (
        <button type="button" role="选中详情-迁城到这里" className="btn self-start" onClick={() => setOpen(true)}>
          {C.pickHere}
        </button>
      ) : (
        <p role="迁城选点-非空提示" className="break-words text-[12px] text-warn">{C.pickNotEmpty}</p>
      )}
      {open && empty ? (
        <MoveCityConfirm
          cityId={cityId}
          mode="pointing"
          target={{ x, y }}
          moveCity={session.moveCity}
          onCancel={() => setOpen(false)}
          onDone={() => setOpen(false)}
          onBuyItems={session.items.openPanel}
        />
      ) : null}
    </div>
  );
}
