// 充值面板（v108，AISLG-251）：道具弹窗里点「充值」后替换列表。一张商品卡（1.99 美元 = 1000 元宝，一次性付款）与「购买」按钮；
// 点购买时服务端创建订单，结账页在新窗口打开。下面是淘宝券号入口（AISLG-255，中文界面且配了
// PUBLIC_TAOBAO_URL 时才显示）。底部是元宝用途说明，链到服务条款与定价页（AISLG-252 提供）。

import { useCopy } from '../../i18n/bundle';
import { TOPUP_INGOT } from '../../api/topupProduct';
import { isSafeCheckoutUrl, type TopupSession } from '../../state/topupSession';
import { TopupTaobaoCard } from './TopupTaobaoCard';

interface TopupPanelProps {
  topup: TopupSession;
}

export function TopupPanel({ topup }: TopupPanelProps) {
  const { TOPUP_COPY } = useCopy();
  const buyDisabled = topup.busy || topup.unavailable;
  return (
    <section role="topup-panel" className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div role="topup-panel-head" className="flex shrink-0 items-center">
        <button
          type="button"
          role="topup-back-button"
          onClick={topup.closePanel}
          className="cursor-pointer rounded border border-line bg-panel-2 px-3 py-1 text-[12.5px] text-dim hover:text-fg"
        >
          {TOPUP_COPY.backToShop}
        </button>
      </div>
      <div role="topup-product-card" className="flex shrink-0 flex-col items-start gap-2 rounded border border-accent-dim bg-accent-soft p-4">
        <b role="topup-product-name" className="text-[15px]">
          {TOPUP_COPY.productName(TOPUP_INGOT)}
        </b>
        <span role="topup-product-price" className="font-mono text-[20px] tabular-nums text-accent">
          {TOPUP_COPY.productPrice}
        </span>
        <small className="text-[11.5px] text-dim">{TOPUP_COPY.productNote}</small>
        <button
          type="button"
          role="topup-buy-button"
          disabled={buyDisabled}
          onClick={() => void topup.buy()}
          className="cursor-pointer rounded border border-accent-dim bg-panel px-4 py-1.5 text-[13px] text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {topup.busy ? TOPUP_COPY.buying : TOPUP_COPY.buy}
        </button>
      </div>
      <TopupTaobaoCard />
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
