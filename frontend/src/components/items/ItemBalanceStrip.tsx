// 道具弹窗顶部的余额条（v108，AISLG-251）：礼金（换季清零）与元宝（永久）分开显示，右侧「充值」入口。
// 充值不可用（渠道报 TOPUP_UNAVAILABLE）后本次会话内按钮置灰并写明原因。

import { useCopy } from '../../i18n/bundle';
import type { TopupSession } from '../../state/topupSession';

interface ItemBalanceStripProps {
  /** 礼金余额；未拉到为 null */
  gift: number | null;
  /** 元宝余额；未拉到为 null */
  ingot: number | null;
  topup: TopupSession;
}

export function ItemBalanceStrip({ gift, ingot, topup }: ItemBalanceStripProps) {
  const { ITEM_COPY, TOPUP_COPY } = useCopy();
  return (
    <div role="背包商店-余额条" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      <span role="gift-balance" className="font-mono text-[12px] tabular-nums text-gold">
        {gift === null ? ITEM_COPY.loading : ITEM_COPY.balanceGift(gift)}
      </span>
      <span role="ingot-balance" className="font-mono text-[12px] tabular-nums text-accent">
        {ingot === null ? ITEM_COPY.loading : TOPUP_COPY.balanceIngot(ingot)}
      </span>
      <button
        type="button"
        role="topup-entry-button"
        disabled={topup.unavailable}
        onClick={topup.openPanel}
        className="ml-auto cursor-pointer rounded border border-accent-dim bg-accent-soft px-2.5 py-0.5 text-[12px] text-accent disabled:cursor-not-allowed disabled:opacity-40"
      >
        {topup.unavailable ? TOPUP_COPY.entryUnavailable : TOPUP_COPY.entry}
      </button>
    </div>
  );
}
