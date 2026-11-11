// 充值面板（v108 AISLG-251；AISLG-255 把兑换码并入本面板）：道具弹窗里点「充值」后替换列表。
// 从上到下：Creem 商品卡（1.99 美元 = 1000 元宝，一次性付款；紧凑一行 + 右侧「购买」）→ 兑换码区块
// （AISLG-255：淘宝购买入口改成兑换码区块里「兑换」左边的「购买」锚点）→ 底部元宝用途说明
// （链到服务条款与定价页，AISLG-252）。三块都做紧凑样式：道具弹窗是固定高度且不加滚动条，
// 说明性小字在窗口很矮时隐藏。

import { useCopy } from '../../i18n/bundle';
import { TOPUP_INGOT } from '../../api/topupProduct';
import { isSafeCheckoutUrl, type TopupSession } from '../../state/topupSession';
import type { RedeemSession } from '../../state/redeemSession';
import { RedeemCodeSection } from './RedeemCodeSection';

interface TopupPanelProps {
  topup: TopupSession;
  redeem: RedeemSession;
}

export function TopupPanel({ topup, redeem }: TopupPanelProps) {
  const { TOPUP_COPY } = useCopy();
  const buyDisabled = topup.busy || topup.unavailable;
  // 关面板时顺带清掉兑换码输入与上一次结果（兑换码区块就在本面板里）
  const closePanel = () => {
    topup.closePanel();
    redeem.reset();
  };
  return (
    <section role="topup-panel" className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div role="topup-panel-head" className="flex shrink-0 items-center">
        <button
          type="button"
          role="topup-back-button"
          onClick={closePanel}
          className="cursor-pointer rounded border border-line bg-panel-2 px-2.5 py-0.5 text-[12px] text-dim hover:text-fg"
        >
          {TOPUP_COPY.backToShop}
        </button>
      </div>
      <div
        role="topup-product-card"
        className="flex shrink-0 items-center gap-2 rounded border border-accent-dim bg-accent-soft p-2.5"
      >
        <div role="topup-product-info" className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <b role="topup-product-name" className="text-[13.5px]">
              {TOPUP_COPY.productName(TOPUP_INGOT)}
            </b>
            <span role="topup-product-price" className="font-mono text-[15px] tabular-nums text-accent">
              {TOPUP_COPY.productPrice}
            </span>
            {/* 窗口很矮时不显示小字，避免挤压下面的兑换码区块（不加滚动条） */}
            <small role="topup-product-note" className="text-[11.5px] text-dim [@media(max-height:560px)]:hidden">
              {TOPUP_COPY.productNote}
            </small>
          </div>
        </div>
        <button
          type="button"
          role="topup-buy-button"
          disabled={buyDisabled}
          onClick={() => void topup.buy()}
          className="shrink-0 cursor-pointer self-start rounded border border-accent-dim bg-panel px-3 py-1 text-[12.5px] text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {topup.busy ? TOPUP_COPY.buying : TOPUP_COPY.buy}
        </button>
      </div>
      {topup.unavailable ? (
        <p role="topup-unavailable" className="shrink-0 text-[12px] text-st-error">
          {TOPUP_COPY.unavailableBadge}
        </p>
      ) : null}
      {topup.popupBlocked ? (
        <p role="topup-popup-blocked" className="shrink-0 text-[12px] text-st-error">
          {TOPUP_COPY.popupBlocked}
        </p>
      ) : null}
      {isSafeCheckoutUrl(topup.manualCheckoutUrl) ? (
        <a
          role="topup-checkout-link"
          href={topup.manualCheckoutUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-[13px] text-accent underline"
        >
          {TOPUP_COPY.manualLink}
        </a>
      ) : null}
      {topup.error ? (
        <p role="topup-error" className="shrink-0 text-[12px] text-st-error">
          {topup.error}
        </p>
      ) : null}
      {topup.notice ? (
        <p role="topup-notice" className="shrink-0 text-[12px] text-st-online">
          {topup.notice}
        </p>
      ) : null}
      <RedeemCodeSection redeem={redeem} />
      <p role="topup-note" className="shrink-0 text-[11.5px] leading-relaxed text-faint">
        {TOPUP_COPY.note} {TOPUP_COPY.noteLinks.prefix}{' '}
        <a role="topup-terms-link" href="/terms.html" target="_blank" rel="noopener noreferrer" className="text-accent underline">
          {TOPUP_COPY.noteLinks.terms}
        </a>
        {TOPUP_COPY.noteLinks.joiner}
        <a role="topup-pricing-link" href="/pricing.html" target="_blank" rel="noopener noreferrer" className="text-accent underline">
          {TOPUP_COPY.noteLinks.pricing}
        </a>
        {TOPUP_COPY.noteLinks.end}
      </p>
    </section>
  );
}