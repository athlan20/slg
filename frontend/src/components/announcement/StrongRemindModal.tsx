/** 强提醒公告弹窗（AISLG-162，v60）：玩家进主界面或强提醒公告到达时弹一次，多条合并成一个列表。
 *  点「知道了」才算已读（全部标记）；右上角 X 只是本次隐藏，下次进主界面还会弹。
 */

import type { AnnouncementDetailView } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { Modal } from '../ui/Modal';
import { AnnouncementBody } from './AnnouncementBody';

interface StrongRemindModalProps {
  queue: AnnouncementDetailView[];
  onConfirm: () => void;
  onHide: () => void;
}

export function StrongRemindModal({ queue, onConfirm, onHide }: StrongRemindModalProps) {
  const { ANNOUNCEMENT_COPY: COPY } = useCopy();
  return (
    <Modal role="强提醒公告弹窗" title={COPY.strong.title} accent="warn" onClose={onHide}>
      <div role="强提醒公告弹窗-列表" className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto pr-1">
        {queue.map((item) => (
          <section key={item.id} role="强提醒公告弹窗-条目" className="flex flex-col gap-1.5">
            <h3 className="text-[15px] font-semibold">{item.title}</h3>
            <AnnouncementBody text={item.body} />
          </section>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[12px] text-faint">{COPY.strong.hint}</span>
        <button
          type="button"
          role="强提醒公告弹窗-知道了"
          onClick={onConfirm}
          className="shrink-0 cursor-pointer rounded-[5px] border border-accent-dim bg-accent-soft px-3 py-1 text-[13px] text-accent hover:border-accent"
        >
          {COPY.strong.confirm}
        </button>
      </div>
    </Modal>
  );
}
