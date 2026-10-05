/** 顶栏的账号级保护徽标（v38 AISLG-122；界面重构后挂在 shell/TopBar 警报胶囊旁）：主动免战（生效中 / 可开启按钮 / 周冷却）
 *  与新手保护倒计时。城级被动免战的胶囊在 shell/AlertPills（与 v22 同源），此处只管账号级。
 */

import { useState } from 'react';
import { formatDurationText } from '../api/mapping';
import { useCopy } from '../i18n/bundle';
import { useNow } from '../state/useNow';

interface TruceShieldBadgeProps {
  /** 新手保护截止；非空且未到期时显示徽标 */
  newbieUntil: string | null;
  /** 主动免战截止；生效中显示徽标 */
  shieldUntil: string | null;
  /** 下次可开启主动免战的时刻（每周一次）；未到时按钮禁用并提示剩余 */
  shieldNextAt: string | null;
  /** 开启主动免战：成功返回 null，失败返回人读错误（悬浮提示展示） */
  onStartTruce: () => Promise<string | null>;
}

export function TruceShieldBadge({ newbieUntil, shieldUntil, shieldNextAt, onStartTruce }: TruceShieldBadgeProps) {
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
  const canStart = !shieldActive && !cooling;
  const submit = async () => {
    if (busy || !canStart) {
      return;
    }
    setBusy(true);
    setError(await onStartTruce());
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
        onClick={() => void submit()}
        className="grid h-7 min-w-7 place-items-center rounded border border-gold/50 bg-gold/10 px-1 font-mono text-[12px] text-gold transition-colors hover:border-gold disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? '…' : copy.EXTRA_MAP.truceBadge.glyph}
      </button>
    </span>
  );
}
