// 账号菜单「迁城」弹窗（v91，AISLG-220）：列出当前城池的不可迁原因与两种方式的持有数。
// 随机迁直接进确认框；指定坐标迁关闭弹窗并切到地图选点（点空野地后出现「迁城到这里」）。

import { useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import type { ItemCounts, MoveCityView } from '../../api/protocol';
import type { MoveCitySession } from '../../state/moveCitySession';
import { Modal } from '../ui/Modal';
import { MoveCityConfirm } from './MoveCityConfirm';

interface MoveCityDialogProps {
  cityId: string | null;
  cityName: string | null;
  view: MoveCityView | null;
  items: ItemCounts | null;
  moveCity: MoveCitySession;
  onClose: () => void;
  /** 指定坐标迁：选点（调用方负责关闭弹窗并切到地图页） */
  onPickOnMap: (cityId: string) => void;
  onBuyItems: () => void;
}

export function MoveCityDialog({ cityId, cityName, view, items, moveCity, onClose, onPickOnMap, onBuyItems }: MoveCityDialogProps) {
  const { MOVE_CITY_COPY: C, ITEM_COPY } = useCopy();
  const [randomConfirm, setRandomConfirm] = useState(false);
  const state = view?.cities.find((item) => item.cityId === cityId) ?? null;
  const reasons = state?.reasons ?? [];
  const randomCount = view?.items.random.count ?? items?.city_order ?? 0;
  const pointingCount = view?.items.pointing.count ?? items?.city_order_adv ?? 0;
  const blocked = cityId === null || reasons.length > 0;
  const randomDisabled = blocked || randomCount < 1;
  const pointingDisabled = blocked || pointingCount < 1;

  return (
    <>
      <Modal role="迁城弹窗" title={C.title} size="sm" accent="none" onClose={onClose}>
        <p role="迁城弹窗-说明" className="break-words text-[13px] text-dim">{C.intro}</p>
        {cityName ? <p role="迁城弹窗-城池" className="break-words text-[12px] text-faint">{C.cityLine(cityName)}</p> : null}
        {reasons.length > 0 ? (
          <div role="迁城弹窗-不可迁原因" className="flex flex-col gap-0.5 rounded border border-line-soft bg-panel-2 px-2 py-1.5 text-[12px] text-warn">
            <p>{C.blockedTitle}</p>
            {reasons.map((reason) => (
              <p key={reason} role="迁城弹窗-不可迁条目" className="break-words">{C.reasons[reason]}</p>
            ))}
          </div>
        ) : null}
        <div role="迁城弹窗-方式" className="flex flex-col gap-2">
          <div role="迁城弹窗-随机迁" className="flex flex-col gap-1">
            <button
              type="button"
              role="迁城弹窗-随机迁按钮"
              className="btn self-start"
              disabled={randomDisabled}
              onClick={() => setRandomConfirm(true)}
            >
              {C.modeRandom}
            </button>
            <p className="break-words text-[12px] text-dim">{C.modeRandomHint}</p>
            <p role="迁城弹窗-随机迁持有" className="text-[12px] text-faint">
              {randomCount < 1 ? C.noItem(ITEM_COPY.names.city_order) : C.have(ITEM_COPY.names.city_order, randomCount)}
            </p>
          </div>
          <div role="迁城弹窗-指定坐标迁" className="flex flex-col gap-1">
            <button
              type="button"
              role="迁城弹窗-指定坐标迁按钮"
              className="btn self-start"
              disabled={pointingDisabled}
              onClick={() => cityId !== null && onPickOnMap(cityId)}
            >
              {C.modePointing}
            </button>
            <p className="break-words text-[12px] text-dim">{C.modePointingHint}</p>
            <p role="迁城弹窗-指定坐标迁持有" className="text-[12px] text-faint">
              {pointingCount < 1 ? C.noItem(ITEM_COPY.names.city_order_adv) : C.have(ITEM_COPY.names.city_order_adv, pointingCount)}
            </p>
          </div>
        </div>
        <div role="迁城弹窗-操作区" className="flex flex-wrap justify-end gap-2 pt-1">
          {randomCount < 1 || pointingCount < 1 ? (
            <button type="button" role="迁城弹窗-去商店按钮" className="btn" onClick={onBuyItems}>
              {C.buyItem}
            </button>
          ) : null}
          <button type="button" role="迁城弹窗-关闭按钮" className="btn" onClick={onClose}>
            {C.cancel}
          </button>
        </div>
      </Modal>
      {randomConfirm && cityId !== null ? (
        <MoveCityConfirm
          cityId={cityId}
          mode="random"
          target={null}
          moveCity={moveCity}
          onCancel={() => setRandomConfirm(false)}
          onDone={onClose}
          onBuyItems={onBuyItems}
        />
      ) : null}
    </>
  );
}
