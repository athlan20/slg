// 淘宝购买入口卡片（AISLG-255）：放在充值面板的 Creem 商品卡下面，紧凑一行（标题 + 说明 + 右侧按钮）。
// - 只在中文界面显示（淘宝买家是中文用户，英文界面保持只有 Creem）；
// - 只在构建期配了合规的 PUBLIC_TAOBAO_URL 时显示（见 api/shopUrl.ts），没配置就不渲染；
// - 卡片里不写价格（价格在淘宝上随时会调，写死会过期）；
// - 按钮是 <a target="_blank" rel="noopener noreferrer">：锚点点击天然不会被拦，无需 window.open
//   （noopener 下拿不到窗口句柄，判断不了是否被拦截，所以不用弹窗方案）。

import { useCopy, useLang } from '../../i18n/bundle';
import { TAOBAO_SHOP_URL, isSafeShopUrl } from '../../api/shopUrl';

export function TopupTaobaoCard() {
  const { TOPUP_COPY } = useCopy();
  const lang = useLang();
  if (lang !== 'zh' || !isSafeShopUrl(TAOBAO_SHOP_URL)) {
    return null;
  }
  return (
    <div
      role="topup-taobao-card"
      className="flex shrink-0 items-center gap-2 rounded border border-line bg-panel-2 p-2.5"
    >
      <div role="topup-taobao-info" className="min-w-0 flex-1">
        <b role="topup-taobao-title" className="block truncate text-[13px]">
          {TOPUP_COPY.taobaoTitle}
        </b>
        {/* 窗口很矮时不显示说明行，避免挤压兑换码区块（不加滚动条） */}
        <small role="topup-taobao-note" className="block truncate text-[11.5px] text-dim [@media(max-height:560px)]:hidden">
          {TOPUP_COPY.taobaoNote}
        </small>
      </div>
      <div role="topup-taobao-button" className="flex shrink-0">
        <a
          role="topup-taobao-link"
          href={TAOBAO_SHOP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-accent-dim bg-panel px-3 py-1 text-[12.5px] text-accent"
        >
          {TOPUP_COPY.taobaoButton}
        </a>
      </div>
    </div>
  );
}