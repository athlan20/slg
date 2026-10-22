/** 换季预告弹窗（v65，AISLG-134）：PUSH_SEASON warning 的 T-1d / T-1h / T-10m 各弹一次（参照 StrongRemindModal）。
 *  点「知道了」关闭；Esc / 点遮罩同样关闭。每个阶段的已弹记录在 seasonSession 里按赛季记入 localStorage。
 */

import type { SeasonPushData } from '../../api/protocol';
import { formatReportTime } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import { Modal } from '../ui/Modal';

interface SeasonWarningModalProps {
  warning: SeasonPushData;
  onConfirm: () => void;
}

export function SeasonWarningModal({ warning, onConfirm }: SeasonWarningModalProps) {
  const { SEASON_COPY: COPY } = useCopy();
  const stage = COPY.warning.stage[warning.stage ?? ''] ?? '';
  return (
    <Modal role="换季预告弹窗" title={COPY.warning.title} accent="warn" size="sm" onClose={onConfirm}>
      <p role="换季预告弹窗-正文" className="text-[13px] leading-relaxed text-dim">
        <b className="text-warn">{stage}</b>
        {' · '}
        {COPY.warning.body(warning.seasonId, formatReportTime(warning.endsAt))}
      </p>
      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[12px] text-faint">{COPY.warning.hint}</span>
        <button
          type="button"
          role="换季预告弹窗-知道了"
          onClick={onConfirm}
          className="shrink-0 cursor-pointer rounded-[5px] border border-accent-dim bg-accent-soft px-3 py-1 text-[13px] text-accent hover:border-accent"
        >
          {COPY.warning.confirm}
        </button>
      </div>
    </Modal>
  );
}
