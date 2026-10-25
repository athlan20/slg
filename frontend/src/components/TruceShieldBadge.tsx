/** 顶栏的账号级保护徽标（v38 AISLG-122；界面重构后挂在 shell/TopBar 警报胶囊旁）：主动免战（生效中 / 可开启按钮 / 周冷却）
 *  与新手保护倒计时。城级被动免战的胶囊在 shell/AlertPills（与 v22 同源），此处只管账号级。
 */

import { useState } from 'react';
import { formatDurationText } from '../api/mapping';
import { useCopy } from '../i18n/bundle';
import { useNow } from '../state/useNow';
import { Modal } from './ui/Modal';

interface TruceShieldBadgeProps {
  /** 新手保护截止；非空且未到期时显示徽标 */
  newbieUntil: string | null;
  /** 主动免战截止；生效中显示徽标 */
  shieldUntil: string | null;
  /** 下次可开启主动免战的时刻（每周一次）；未到时按钮禁用并提示剩余 */
  shieldNextAt: string | null;
  /** 开启主动免战：成功返回 null，失败返回人读错误（悬浮提示展示） */
  onStartTruce: () => Promise<string | null>;
  /** 提前解除主动免战（v71，AISLG-190）：仅生效中显示按钮；成功返回 null，失败返回人读错误 */
  onCancelTruce: () => Promise<string | null>;
}

export function TruceShieldBadge({ newbieUntil, shieldUntil, shieldNextAt, onStartTruce, onCancelTruce }: TruceShieldBadgeProps) {
  const copy = useCopy();
  const { COPY } = copy;
  const shieldDeadline = shieldUntil !== null ? Date.parse(shieldUntil) : NaN;
  const shieldActive = Number.isFinite(shieldDeadline) && shieldDeadline - Date.now() > 0;
  const newbieDeadline = newbieUntil !== null ? Date.parse(newbieUntil) : NaN;
  const newbieActive = Number.isFinite(newbieDeadline) && newbieDeadline - Date.now() > 0;
  const now = useNow(shieldActive || newbieActive);
  const shieldLeftText = shieldActive ? formatDurationText((shieldDeadline - now) / 1000) : null;
  const newbieLeftText = newbieActive ? formatDurationText((newbieDeadline - now) / 1000) : null;
  const nextDeadline = shieldNextAt !== null ? Date.parse(shieldNextAt) : NaN;
  const cooling = Number.isFinite(nextDeadline) && nextDeadline - now > 0;
  const nextLeftText = cooling ? formatDurationText((nextDeadline - now) / 1000) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 二次确认框是否打开：开启不可撤销，误触会白白浪费本周额度 */
  const [confirming, setConfirming] = useState(false);
  /** 提前解除的确认框：解除后本周次数不返还，误触代价同样大 */
  const [cancelConfirming, setCancelConfirming] = useState(false);
  const canStart = !shieldActive && !cooling;
  const submit = async () => {
    if (busy || !canStart) {
      return;
    }
    setBusy(true);
    setError(await onStartTruce());
    setBusy(false);
  };
  const confirmStart = () => {
    setConfirming(false);
    void submit();
  };
  const confirmCancel = async () => {
    setCancelConfirming(false);
    if (busy) {
      return;
    }
    setBusy(true);
    setError(await onCancelTruce());
    setBusy(false);
  };
  return (
    <span role="顶栏-账号保护区" className="flex items-center gap-1">
      {shieldLeftText !== null ? (
        <span
          role="顶栏-主动免战状态"
          title={COPY.topbar.shieldHint}
          className="rounded border border-gold/50 bg-gold/10 px-1.5 py-0.5 font-mono text-[11px] text-gold"
        >
          {COPY.topbar.shieldLeft(shieldLeftText)}
        </span>
      ) : null}
      {newbieLeftText !== null ? (
        <span
          role="顶栏-新手保护状态"
          title={COPY.topbar.newbieHint}
          className="rounded border border-accent-dim/50 bg-accent-soft px-1.5 py-0.5 font-mono text-[11px] text-accent"
        >
          {COPY.topbar.newbieLeft(newbieLeftText)}
        </span>
      ) : null}
      <button
        type="button"
        role="顶栏-开启免战按钮"
        title={error ?? (nextLeftText !== null ? COPY.topbar.shieldNextHint(nextLeftText) : COPY.topbar.shieldHint)}
        aria-label={COPY.topbar.shieldButton}
        disabled={!canStart || busy}
        onClick={() => setConfirming(true)}
        className="grid h-7 min-w-7 place-items-center rounded border border-gold/50 bg-gold/10 px-1 font-mono text-[12px] text-gold transition-colors hover:border-gold disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? '…' : copy.EXTRA_MAP.truceBadge.glyph}
      </button>
      {shieldActive ? (
        <button
          type="button"
          role="顶栏-提前解除免战按钮"
          title={error ?? COPY.topbar.cancelShieldHint}
          disabled={busy}
          onClick={() => setCancelConfirming(true)}
          className="rounded border border-line px-1.5 py-0.5 text-[11px] text-dim transition-colors hover:border-warn hover:text-warn disabled:cursor-not-allowed disabled:opacity-40"
        >
          {COPY.topbar.cancelShieldButton}
        </button>
      ) : null}
      {cancelConfirming ? (
        <Modal
          role="顶栏-提前解除免战确认"
          title={COPY.topbar.cancelShieldConfirmTitle}
          size="sm"
          accent="gold"
          onClose={() => setCancelConfirming(false)}
        >
          <p className="text-[13px] text-dim">{COPY.topbar.cancelShieldConfirmBody}</p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" role="顶栏-提前解除免战确认-取消按钮" className="btn" onClick={() => setCancelConfirming(false)}>
              {COPY.topbar.shieldConfirmCancel}
            </button>
            <button type="button" role="顶栏-提前解除免战确认-确认按钮" className="btn px-3" onClick={() => void confirmCancel()}>
              {COPY.topbar.cancelShieldConfirmSubmit}
            </button>
          </div>
        </Modal>
      ) : null}
      {confirming ? (
        <Modal
          role="顶栏-开启免战确认"
          title={COPY.topbar.shieldConfirmTitle}
          size="sm"
          accent="gold"
          onClose={() => setConfirming(false)}
        >
          <p className="text-[13px] text-dim">{COPY.topbar.shieldConfirmBody}</p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" role="顶栏-开启免战确认-取消按钮" className="btn" onClick={() => setConfirming(false)}>
              {COPY.topbar.shieldConfirmCancel}
            </button>
            <button type="button" role="顶栏-开启免战确认-确认按钮" className="btn px-3" onClick={confirmStart}>
              {COPY.topbar.shieldConfirmSubmit}
            </button>
          </div>
        </Modal>
      ) : null}
    </span>
  );
}
