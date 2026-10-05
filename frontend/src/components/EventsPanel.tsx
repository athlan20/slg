import { useCopy } from '../i18n/bundle';
import { useBattleReportModal } from '../state/battleReportModal';
import { useScoutReportModal } from '../state/scoutReportModal';
import type { Actor, SessionEvent } from '../types';
import { Card } from './ui/Card';
import { PagedList } from './ui/PagedList';

interface EventsPanelProps {
  events: SessionEvent[];
  /** 服务端是否还有更早的历史可翻页 */
  hasMoreEvents: boolean;
  /** 「加载更早」分页进行中 */
  loadingOlder: boolean;
  onLoadOlder: () => void;
  /** 只看某类发起者（Agent 页的操作记录）；缺省看全部 */
  actor?: Actor;
  title?: string;
  role?: string;
}

function tagClass(actor: SessionEvent['actor']): string {
  if (actor === 'player') return 'tag actor-player';
  if (actor === 'system') return 'tag actor-system';
  return 'tag';
}

/** 动态卡（情报页中 / Agent 页中）：事件流，发起者标签「玩家 / Agent / 系统」，战斗类事件带战报入口、侦察类带侦察报告入口。
 *  分页列表（行定高、文本截断，悬停看全文）；翻到最后一页后「更早」按钮向服务端加载更早的历史。 */
export function EventsPanel({ events, hasMoreEvents, loadingOlder, onLoadOlder, actor, title, role = '事件面板' }: EventsPanelProps) {
  const copy = useCopy();
  const { COPY, IDENTITY_LABEL, INTEL_COPY } = copy;
  const heading = title ?? INTEL_COPY.eventsTitle;
  const { openBattleReportById } = useBattleReportModal();
  const { openScoutReport } = useScoutReportModal();
  // 内部按时间正序存放，渲染时倒转：最新在最上
  const ordered = events
    .filter((event) => actor === undefined || event.actor === actor)
    .slice()
    .reverse();

  return (
    <Card role={role} title={heading} meta={actor ? INTEL_COPY.agentLogMeta(ordered.length) : undefined}>
      <PagedList
        role={actor ? `${role}-列表` : '事件面板-列表'}
        items={ordered}
        keyOf={(event) => event.id}
        gap={2}
        gapClass="gap-0.5"
        hasMore={hasMoreEvents}
        loadingMore={loadingOlder}
        onLoadMore={onLoadOlder}
        empty={
          <p className="py-3 text-center text-[12.5px] text-faint" role="事件面板-空状态">
            {actor ? INTEL_COPY.agentLogEmpty : COPY.eventsPanel.empty}
          </p>
        }
        renderRow={(event) => (
          <div className="flex items-center gap-2 border-b border-line-soft py-1 text-[12.5px] text-dim">
            <span className="shrink-0 font-mono text-[11.5px] text-faint">{event.at}</span>
            <span className={tagClass(event.actor)}>{IDENTITY_LABEL[event.actor]}</span>
            <span className="min-w-0 flex-1 truncate" title={event.text}>
              {event.text}
            </span>
            {event.reportId !== undefined ? (
              <button
                type="button"
                role="事件面板-战报入口"
                onClick={() => openBattleReportById(event.reportId as number)}
                className="shrink-0 cursor-pointer rounded border border-accent-dim px-1.5 text-[11px] leading-4 text-accent transition-colors hover:bg-accent-soft"
              >
                {COPY.eventsPanel.viewReport}
              </button>
            ) : event.scoutIntel ? (
              <button
                type="button"
                role="事件面板-侦察报告入口"
                onClick={() => openScoutReport(event.scoutIntel as NonNullable<SessionEvent['scoutIntel']>)}
                className="shrink-0 cursor-pointer rounded border border-accent-dim px-1.5 text-[11px] leading-4 text-dim transition-colors hover:bg-accent-soft"
              >
                {COPY.eventsPanel.viewScoutReport}
              </button>
            ) : null}
          </div>
        )}
      />
    </Card>
  );
}
