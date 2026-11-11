// 商店的一行（v90，AISLG-222；v108 AISLG-251 双价与选货币）：名称 / 说明、礼金价与元宝价（玩家选一种付款，不自动混用）、
// 已有数量（其中元宝买的换季保留）、数量 ±1、购买按钮。数量上限取「还能买」与「所选货币够买」的较小值；
// 所选货币不够时按钮置灰并写明原因，不会自动换另一种货币。单价取自服务端目录，购买时连同货币一起带上。

import { useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import type { ItemCurrency, ItemDefView, ItemId } from '../../api/protocol';
import { itemPriceIn } from '../../api/itemPrice';

/** 单次最多买的张数（与服务端 BUY_COUNT_MAX 一致） */
const BUY_MAX = 99;

interface ItemShopRowProps {
  def: ItemDefView;
  owned: number;
  /** 其中元宝买的张数（换季保留） */
  paidKept: number;
  /** 两种货币的余额；未拉到为 null（按钮置灰） */
  balances: { gift: number | null; ingot: number | null };
  busy: boolean;
  onBuy: (itemId: ItemId, count: number, expectedPrice: number, currency: ItemCurrency) => void;
}

const CURRENCIES: ItemCurrency[] = ['gift', 'ingot'];

export function ItemShopRow({ def, owned, paidKept, balances, busy, onBuy }: ItemShopRowProps) {
  const { ITEM_COPY } = useCopy();
  // 默认选礼金（礼金不卖时选元宝）；之后只由玩家改动，余额不足不会自动换货币
  const [currency, setCurrency] = useState<ItemCurrency>(def.shopPrice !== null ? 'gift' : 'ingot');
  const [qty, setQty] = useState(1);
  const price = itemPriceIn(def, currency) ?? 0;
  const balance = currency === 'ingot' ? balances.ingot : balances.gift;
  const room = Math.max(0, def.stackMax - owned);
  const affordable = balance !== null && price > 0 ? Math.floor(balance / price) : 0;
  const maxQty = Math.max(0, Math.min(BUY_MAX, room, affordable));
  const shown = maxQty > 0 ? Math.min(Math.max(qty, 1), maxQty) : 0;
  const reason =
    room <= 0
      ? ITEM_COPY.reasonFull
      : balance !== null && affordable <= 0
        ? currency === 'ingot'
          ? ITEM_COPY.reasonIngot
          : ITEM_COPY.reasonGift
        : null;
  const name = ITEM_COPY.names[def.id];
  const desc = ITEM_COPY.descs[def.id];

  const priceText = (cur: ItemCurrency, value: number) => (cur === 'ingot' ? ITEM_COPY.priceIngot(value) : ITEM_COPY.price(value));

  return (
    <div role="背包商店-商店行" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-line-soft px-2.5 py-1.5">
      <div className="min-w-0 flex-1 basis-[160px]">
        <b className="block truncate text-[13px]">{name}</b>
        <small className="block truncate text-[11.5px] text-dim" title={desc}>
          {desc}
        </small>
      </div>
      <div role="item-currency-choice" aria-label={ITEM_COPY.currencyChoice} className="flex shrink-0 overflow-hidden rounded border border-line">
        {CURRENCIES.map((cur) => {
          const value = itemPriceIn(def, cur);
          const active = currency === cur;
          return (
            <button
              key={cur}
              type="button"
              role={cur === 'ingot' ? 'item-currency-choice-ingot' : 'item-currency-choice-gift'}
              aria-pressed={active}
              disabled={busy || value === null}
              onClick={() => {
                setCurrency(cur);
                setQty(1);
              }}
              className={`cursor-pointer px-2 py-0.5 font-mono text-[11.5px] tabular-nums disabled:cursor-not-allowed disabled:opacity-40 ${
                active ? 'bg-accent-soft text-accent' : 'bg-panel-2 text-dim hover:text-fg'
              }`}
            >
              {value === null ? ITEM_COPY.currencyNotSold : priceText(cur, value)}
            </button>
          );
        })}
      </div>
      <span role="背包商店-商店行-已有" className="shrink-0 text-[11.5px] text-faint">
        {ITEM_COPY.owned(owned)}
      </span>
      {paidKept > 0 ? (
        <span role="item-paid-count" className="shrink-0 text-[11.5px] text-accent">
          {ITEM_COPY.paidKept(paidKept)}
        </span>
      ) : null}
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
        onClick={() => onBuy(def.id, shown, price, currency)}
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
