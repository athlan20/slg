/** 公告弹窗（AISLG-162，v60）：「生效中 / 往期」两个页签的列表（置顶在前、未读带点），点开看正文；打开正文即标记已读。
 *  列表分页用 PagedList（往期可「更早」翻页）；正文超出弹窗高度时在正文区内滚动。
 */

import type { AnnouncementSlice } from '../../state/announcements';
import { formatReportTime } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import { Modal } from '../ui/Modal';
import { PagedList } from '../ui/PagedList';
import { AnnouncementBody } from './AnnouncementBody';

interface AnnouncementModalProps {
  slice: AnnouncementSlice;
  onClose: () => void;
}

const TAB_ROLE = { active: '生效中', history: '往期' } as const;

export function AnnouncementModal({ slice, onClose }: AnnouncementModalProps) {
  const { ANNOUNCEMENT_COPY: COPY } = useCopy();
  const showDetail = slice.detail !== null || slice.detailLoading || slice.detailError;
  return (
    <Modal role="公告弹窗" title={COPY.modal.title} accent="gold" fill onClose={onClose}>
      {showDetail ? (
        <div role="公告弹窗-正文" className="flex min-h-0 flex-1 flex-col gap-2">
          <button
            type="button"
            role="公告弹窗-返回"
            onClick={slice.backToList}
            className="shrink-0 cursor-pointer self-start rounded border border-line px-2.5 py-0.5 text-[12px] text-dim hover:text-fg"
          >
            ← {COPY.detail.back}
          </button>
          {slice.detailLoading ? <p className="py-6 text-center text-[13px] text-faint">{COPY.detail.loading}</p> : null}
          {!slice.detailLoading && slice.detailError ? <p className="py-6 text-center text-[13px] text-st-error">{COPY.modal.detailFailed}</p> : null}
          {slice.detail && !slice.detailLoading ? (
            <>
              <header className="flex shrink-0 flex-col gap-1">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="rounded border border-line px-1 text-faint">{COPY.category[slice.detail.category]}</span>
                  {slice.detail.pinned ? <span className="text-gold">{COPY.badge.pinned}</span> : null}
                </div>
                <h3 role="公告弹窗-标题" className="text-[15px] font-semibold">
                  {slice.detail.title}
                </h3>
                <p className="font-mono text-[11px] text-faint">
                  {COPY.detail.publishedAt(formatReportTime(slice.detail.publishedAt))}
                  {' · '}
                  {slice.detail.endsAt ? COPY.detail.endsAt(formatReportTime(slice.detail.endsAt)) : COPY.detail.noEnd}
                </p>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <AnnouncementBody text={slice.detail.body} />
              </div>
            </>
          ) : null}
        </div>
      ) : (
        <div role="公告弹窗-列表区" className="flex min-h-0 flex-1 flex-col gap-2">
          <div role="公告弹窗-页签" className="flex shrink-0 items-center gap-1">
            {(['active', 'history'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                role={`公告弹窗-页签-${TAB_ROLE[tab]}`}
                aria-pressed={slice.tab === tab}
                onClick={() => slice.setTab(tab)}
                className={`cursor-pointer rounded border px-2.5 py-0.5 text-[13px] transition-colors ${
                  slice.tab === tab ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'
                }`}
              >
                {COPY.tabs[tab]}
              </button>
            ))}
            {slice.listError ? <span className="ml-auto truncate text-[11px] text-st-error">{COPY.modal.loadFailed}</span> : null}
          </div>
          {slice.tab === 'active' ? (
            <PagedList
              role="公告弹窗-列表"
              items={slice.items}
              keyOf={(item) => item.id}
              empty={<p className="py-6 text-center text-[13px] text-faint">{COPY.modal.empty}</p>}
              renderRow={(item) => (
                <button
                  type="button"
                  role="公告弹窗-条目"
                  onClick={() => void slice.openDetail(item.id)}
                  className="flex w-full min-w-0 cursor-pointer items-center gap-2 border-b border-line-soft py-1.5 text-left text-[13px] hover:text-accent"
                >
                  <i className={`h-1.5 w-1.5 shrink-0 rounded-full ${item.read ? 'bg-transparent' : 'bg-st-error'}`} aria-label={item.read ? undefined : COPY.badge.unread} />
                  <span className="shrink-0 rounded border border-line px-1 text-[10.5px] text-faint">{COPY.category[item.category]}</span>
                  {item.pinned ? <span className="shrink-0 text-[10.5px] text-gold">{COPY.badge.pinned}</span> : null}
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">{formatReportTime(item.publishedAt)}</span>
                </button>
              )}
            />
          ) : (
            <PagedList
              role="公告弹窗-往期列表"
              items={slice.historyItems}
              keyOf={(item) => item.id}
              empty={<p className="py-6 text-center text-[13px] text-faint">{COPY.modal.empty}</p>}
              hasMore={slice.historyHasMore}
              onLoadMore={() => void slice.loadMoreHistory()}
              renderRow={(item) => (
                <button
                  type="button"
                  role="公告弹窗-往期条目"
                  onClick={() => void slice.openDetail(item.id)}
                  className="flex w-full min-w-0 cursor-pointer items-center gap-2 border-b border-line-soft py-1.5 text-left text-[13px] text-dim hover:text-fg"
                >
                  <span className="shrink-0 rounded border border-line px-1 text-[10.5px] text-faint">{COPY.category[item.category]}</span>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">{formatReportTime(item.publishedAt)}</span>
                </button>
              )}
            />
          )}
        </div>
      )}
    </Modal>
  );
}
