/** 确认大按钮：选中详情面板每个操作的出口。禁用时把原因直接写在按钮上（悬停同样有 title）。 */

import { useCopy } from '../../../i18n/bundle';

interface ConfirmButtonProps {
  role?: string;
  label: string;
  busy: boolean;
  /** 非空 = 禁用并显示该原因 */
  disabledReason?: string | null;
  tone?: 'accent' | 'warn';
  onClick: () => void;
}

export function ConfirmButton({ role = '世界地图详情区-出征按钮', label, busy, disabledReason = null, tone = 'accent', onClick }: ConfirmButtonProps) {
  const copy = useCopy();
  const { COPY } = copy;
  const disabled = busy || disabledReason !== null;
  return (
    <button
      type="button"
      role={role}
      disabled={disabled}
      title={disabledReason ?? undefined}
      onClick={onClick}
      className={`w-full shrink-0 cursor-pointer truncate rounded py-1.5 text-[13px] font-semibold transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-transparent disabled:font-normal disabled:text-faint disabled:outline disabled:outline-1 disabled:outline-line ${
        tone === 'warn' ? 'bg-warn text-bg' : 'bg-accent text-bg'
      }`}
    >
      {busy ? COPY.worldMap.attackBusy : (disabledReason ?? label)}
    </button>
  );
}
