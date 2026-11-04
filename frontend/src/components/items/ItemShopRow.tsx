// 商店的一行（v90，AISLG-222）：名称 / 说明、单价、已有数量、数量 ±1（上限取「还能买」与「礼金够买」的较小值）、购买按钮。
// 买不了时按钮置灰并写明原因（已达堆叠上限 / 礼金不足）。单价取自服务端目录，购买时把它带上（expectedPrice）。

import { useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import type { ItemDefView, ItemId } from '../../api/protocol';

/** 单次最多买的张数（与服务端 BUY_COUNT_MAX 一致） */
const BUY_MAX = 99;

interface ItemShopRowProps {
  def: ItemDefView;
  owned: number;
  /** 礼金余额；未拉到为 null（按钮置灰） */
  gift: number | null;
  busy: boolean;
  onBuy: (itemId: ItemId, count: number, expectedPrice: number) => void;
}

export function ItemShopRow({ def, owned, gift, busy, onBuy }: ItemShopRowProps) {
  const { ITEM_COPY } = useCopy();
  const [qty, setQty] = useState(1);
  const price = def.shopPrice ?? 0;
  const room = Math.max(0, def.stackMax - owned);
  const affordable = gift !== null && price > 0 ? Math.floor(gift / price) : 0;
  const maxQty = Math.max(0, Math.min(BUY_MAX, room, affordable));
  const shown = maxQty > 0 ? Math.min(Math.max(qty, 1), maxQty) : 0;
  const reason = room <= 0 ? ITEM_COPY.reasonFull : affordable <= 0 ? ITEM_COPY.reasonGift : null;
  const name = ITEM_COPY.names[def.id];
  const desc = ITEM_COPY.descs[def.id];

  return (
    <div role="背包商店-商店行" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-line-soft px-2.5 py-1.5">
      <div className="min-w-0 flex-1 basis-[160px]">
        <b className="block truncate text-[13px]">{name}</b>
        <small className="block truncate text-[11.5px] text-dim" title={desc}>
          {desc}
        </small>
      </div>
      <span role="背包商店-商店行-单价" className="shrink-0 font-mono text-[12px] tabular-nums text-gold">
        {ITEM_COPY.price(price)}
      </span>
      <span role="背包商店-商店行-已有" className="shrink-0 text-[11.5px] text-faint">
        {ITEM_COPY.owned(owned)}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          role="背包商店-商店行-减"
          aria-label={ITEM_COPY.qtyDown}
          disabled={busy || shown <= 1}
          onClick={() => setQty(Math.max(1, shown - 1))}
          className="grid h-6 w-6 cursor-pointer place-items-center rounded border border-line bg-panel-2 text-dim disabled:cursor-not-allowed disabled:opacity-40"
        >
          −
        </button>
        <span role="背包商店-商店行-数量" className="w-7 text-center font-mono tabular-nums">
          {shown}
        </span>
        <button
          type="button"
          role="背包商店-商店行-加"
          aria-label={ITEM_COPY.qtyUp}
          disabled={busy || shown >= maxQty}
          onClick={() => setQty(Math.min(maxQty, shown + 1))}
          className="grid h-6 w-6 cursor-pointer place-items-center rounded border border-line bg-panel-2 text-dim disabled:cursor-not-allowed disabled:opacity-40"
        >
          +
        </button>
      </div>
      <button
        type="button"
        role="背包商店-商店行-购买"
        disabled={busy || maxQty <= 0}
        onClick={() => onBuy(def.id, shown, price)}
        className="shrink-0 cursor-pointer rounded border border-accent-dim bg-accent-soft px-2.5 py-1 text-[12px] text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        {ITEM_COPY.buy}
      </button>
      {reason ? (
        <span role="背包商店-商店行-原因" className="w-full text-[11.5px] text-faint">
          {reason}
        </span>
      ) : null}
    </div>
  );
}
