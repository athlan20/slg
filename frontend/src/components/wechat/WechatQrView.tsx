// 微信二维码展示块（登录分页与绑定微信共用）：码图 + 倒计时 + 状态提示 + 刷新按钮。
// 状态流转由 useWechatQr 驱动，这里只按 phase 渲染。

import type { WxQrPhase } from '../../state/useWechatQr';
import { useNow } from '../../state/useNow';
import { WECHAT_COPY } from '../../copy-wechat';
import type { WxQrPurpose } from '../../api/protocol-wechat';

interface WechatQrViewProps {
  purpose: WxQrPurpose;
  phase: WxQrPhase;
  onRefresh: () => void;
}

/** 本机时钟与服务端相差过大时倒计时没有意义：剩余秒数不在 (0, 600] 内就不显示 */
function remainingSeconds(expiresAt: number, now: number): number | null {
  const seconds = Math.ceil((expiresAt - now) / 1000);
  return seconds > 0 && seconds <= 600 ? seconds : null;
}

export function WechatQrView({ purpose, phase, onRefresh }: WechatQrViewProps) {
  const now = useNow(phase.kind === 'ready');
  const dim = phase.kind !== 'ready';
  const statusText = (() => {
    switch (phase.kind) {
      case 'loading':
        return phase.retrying ? WECHAT_COPY.qr.retrying : WECHAT_COPY.qr.loading;
      case 'ready':
        return purpose === 'bind' ? WECHAT_COPY.qr.readyBind : WECHAT_COPY.qr.ready;
      case 'scanned':
        return WECHAT_COPY.qr.scanned;
      case 'done':
        return purpose === 'bind' ? WECHAT_COPY.qr.confirmedBind : WECHAT_COPY.qr.confirmed;
      case 'stale':
        return phase.message;
      default:
        return '';
    }
  })();
  const seconds = phase.kind === 'ready' ? remainingSeconds(phase.expiresAt, now) : null;

  return (
    <div role="微信二维码" className="flex flex-col items-center gap-2 py-1">
      <div className="relative grid h-[184px] w-[184px] place-items-center overflow-hidden rounded border border-line-soft bg-white">
        {phase.kind === 'ready' ? (
          <img role="微信二维码-图片" src={phase.qrImage} alt={WECHAT_COPY.qr.alt} className="h-full w-full" />
        ) : null}
        {dim ? (
          <div
            role="微信二维码-遮罩"
            className={`absolute inset-0 grid place-items-center text-center text-[12.5px] text-dim ${
              phase.kind === 'loading' || phase.kind === 'stale' || phase.kind === 'idle' ? 'bg-panel-2' : 'bg-panel-2/90'
            }`}
          >
            {phase.kind === 'loading' ? <i className="h-2 w-2 animate-pulse rounded-full bg-accent" /> : null}
            {phase.kind === 'scanned' || phase.kind === 'done' ? <span className="text-[26px] text-accent">✓</span> : null}
          </div>
        ) : null}
      </div>
      <p role="微信二维码-状态" className="text-center text-[13px] text-dim">
        {statusText}
        {seconds !== null ? (
          <span role="微信二维码-倒计时" className="ml-2 font-mono text-[12px] text-faint">
            {WECHAT_COPY.qr.countdown(seconds)}
          </span>
        ) : null}
      </p>
      {phase.kind === 'stale' ? (
        <button type="button" role="微信二维码-刷新按钮" className="btn px-3 py-1" onClick={onRefresh}>
          {WECHAT_COPY.qr.refreshButton}
        </button>
      ) : null}
      <p role="微信二维码-安全提示" className="max-w-[300px] text-center text-[11.5px] text-faint">
        {WECHAT_COPY.qr.safety}
      </p>
    </div>
  );
}
