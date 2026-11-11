// 兑换码面板（v109，AISLG-253）：道具弹窗里点「兑换码」后替换背包 / 商店列表。
// 一个输入框 +「兑换」按钮（回车也能提交，走原生 form 提交），下面显示本次结果 / 错误，底部一行小字说明码从哪来。
// 码原样发给服务端：不 trim、不转大小写、不校验格式；输入长度上限见 state/redeemSession.ts。
// 成功时余额与背包由状态层写回（useCityList.applyItems），其他在线连接靠 PUSH_ACCOUNT_STATE 同步。

import { useCopy } from '../../i18n/bundle';
import { REDEEM_CODE_MAX_LENGTH, type RedeemSession } from '../../state/redeemSession';

interface RedeemCodePanelProps {
  redeem: RedeemSession;
}

export function RedeemCodePanel({ redeem }: RedeemCodePanelProps) {
  const { REDEEM_COPY } = useCopy();
  const canSubmit = redeem.code.trim().length > 0 && !redeem.busy;
  const submit = () => {
    if (canSubmit) {
      void redeem.submit();
    }
  };
  return (
    <section role="redeem-code-panel" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-hidden">
      <div role="redeem-code-panel-head" className="flex shrink-0 items-center">
        <button
          type="button"
          role="redeem-code-back-button"
          onClick={redeem.closePanel}
          className="cursor-pointer rounded border border-line bg-panel-2 px-3 py-1 text-[12.5px] text-dim hover:text-fg"
        >
          {REDEEM_COPY.backToShop}
        </button>
      </div>
      <form
        role="redeem-code-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="flex shrink-0 flex-col items-stretch gap-2 rounded border border-accent-dim bg-accent-soft p-4"
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
          className="w-full rounded border border-line bg-panel px-2.5 py-1.5 font-mono text-[14px] tracking-wider text-fg outline-none placeholder:text-faint focus:border-accent-dim"
        />
        <button
          type="submit"
          role="redeem-code-submit"
          disabled={!canSubmit}
          className="cursor-pointer self-start rounded border border-accent-dim bg-panel px-4 py-1.5 text-[13px] text-accent disabled:cursor-not-allowed disabled:opacity-40"
        >
          {redeem.busy ? REDEEM_COPY.submitting : REDEEM_COPY.submit}
        </button>
      </form>
      {redeem.result ? (
        <p role="redeem-code-result" className="shrink-0 text-[13px] text-st-online">
          {redeem.result}
        </p>
      ) : null}
      {redeem.error ? (
        <p role="redeem-code-error" className="shrink-0 text-[12px] leading-relaxed text-st-error">
          {redeem.error}
        </p>
      ) : null}
      <p role="redeem-code-hint" className="mt-auto shrink-0 text-[11.5px] leading-relaxed text-faint">
        {REDEEM_COPY.hint}
      </p>
    </section>
  );
}