// 兑换码区块（v109 AISLG-253；AISLG-255 起从独立面板改成充值面板里的内嵌区块，放在淘宝卡片下面）。
// 小标题 + 一行「输入框 + 兑换按钮」（窄屏换行，走原生 form 提交，回车也能兑换）+ 本次结果 / 错误 + 底部一行小字。
// 码原样发给服务端：不 trim、不转大小写、不校验格式；输入长度上限见 state/redeemSession.ts。
// 成功时余额与背包由状态层写回（useCityList.applyItems），其他在线连接靠 PUSH_ACCOUNT_STATE 同步。

import { useCopy } from '../../i18n/bundle';
import { TAOBAO_SHOP_URL, isSafeShopUrl } from '../../api/shopUrl';
import { REDEEM_CODE_MAX_LENGTH, type RedeemSession } from '../../state/redeemSession';

interface RedeemCodeSectionProps {
  redeem: RedeemSession;
}

export function RedeemCodeSection({ redeem }: RedeemCodeSectionProps) {
  const { REDEEM_COPY } = useCopy();
  const canSubmit = redeem.code.trim().length > 0 && !redeem.busy;
  const submit = () => {
    if (canSubmit) {
      void redeem.submit();
    }
  };
  return (
    <section
      role="topup-redeem-section"
      className="flex shrink-0 flex-col gap-1.5 rounded border border-line bg-panel-2 p-2.5"
    >
      <b role="redeem-code-section-title" className="text-[13px]">
        {REDEEM_COPY.sectionTitle}
      </b>
      <form
        role="redeem-code-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          role="redeem-code-input"
          type="text"
          value={redeem.code}
          onChange={(event) => redeem.setCode(event.target.value)}
          maxLength={REDEEM_CODE_MAX_LENGTH}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={REDEEM_COPY.placeholder}
          aria-label={REDEEM_COPY.placeholder}
          className="min-w-[8rem] flex-1 basis-[10rem] rounded border border-line bg-panel px-2 py-1 font-mono text-[13px] tracking-wider text-fg outline-none placeholder:text-faint focus:border-accent-dim"
        />
        <button
          type="submit"
          role="redeem-code-submit"
          disabled={!canSubmit}
          className="shrink-0 cursor-pointer rounded border border-accent-dim bg-panel px-3 py-1 text-[12.5px] text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {redeem.busy ? REDEEM_COPY.submitting : REDEEM_COPY.submit}
        </button>
      </form>
      {redeem.result ? (
        <p role="redeem-code-result" className="text-[12.5px] text-st-online">
          {redeem.result}
        </p>
      ) : null}
      {redeem.error ? (
        <p role="redeem-code-error" className="text-[11.5px] leading-relaxed text-st-error">
          {redeem.error}
        </p>
      ) : null}
      {/* 配了淘宝入口时提示「券号在淘宝订单里查看」，没配置的环境不提到淘宝（AISLG-255） */}
      <p role="redeem-code-hint" className="text-[11.5px] leading-relaxed text-faint">
        {isSafeShopUrl(TAOBAO_SHOP_URL) ? REDEEM_COPY.hintTaobao : REDEEM_COPY.hint}
      </p>
    </section>
  );
}