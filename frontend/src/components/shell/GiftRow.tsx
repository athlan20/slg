/** 账号菜单里的礼金行（v89，AISLG-221）：「礼金 800 / 1000」，点开显示说明（每个赛季发 1,000，换季清零，只用于便利功能）。
 *  数值来自 GET_STATE 的 gift / giftSeasonGrant（经 useCityList 下发）；未拉到时显示占位。单行，不滚动。
 */

import { useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import type { GiftView } from '../../state/useCityList';

interface GiftRowProps {
  gift: GiftView | null;
}

export function GiftRow({ gift }: GiftRowProps) {
  const { GIFT_COPY } = useCopy();
  const [open, setOpen] = useState(false);
  return (
    <div role="账号菜单-礼金" className="flex flex-col">
      <button
        type="button"
        role="账号菜单-礼金-按钮"
        aria-expanded={open}
        title={gift ? GIFT_COPY.explain(gift.seasonGrant) : undefined}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left text-[12.5px] hover:bg-accent-soft"
      >
        <span className="min-w-0 truncate">{GIFT_COPY.label}</span>
        <b role="账号菜单-礼金-数值" className="shrink-0 font-mono tabular-nums">
          {gift ? GIFT_COPY.value(gift.balance, gift.seasonGrant) : GIFT_COPY.loading}
        </b>
      </button>
      {open && gift ? (
        <p role="账号菜单-礼金-说明" className="px-2.5 pb-1 text-[11.5px] leading-snug text-faint">
          {GIFT_COPY.explain(gift.seasonGrant)}
        </p>
      ) : null}
    </div>
  );
}
