import { useCopy } from '../i18n/bundle';
import { tName } from '../i18n/names';
import { useGame } from '../state/GameContext';
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
  /** 排除某类发起者（情报页动态不重复显示 Agent 操作，Agent 的战斗 / 侦察条目也在此隐藏，战报仍在情报页战报卡里）；缺省不排除 */
  excludeActor?: Actor;
  title?: string;
  role?: string;
}

function tagClass(actor: SessionEvent['actor']): string {
  if (actor === 'player') return 'tag actor-player';
  if (actor === 'system') return 'tag actor-system';
  return 'tag';
}

/** 城池标签最多显示的字符数（AISLG-213）：超出截断加省略号，全名放 title */
const CITY_TAG_MAX_CHARS = 6;

/** 城池标签文字：按码点截断到 6 个字，超出用省略号 */
function cityTagText(name: string): string {
  const chars = Array.from(name);
  return chars.length > CITY_TAG_MAX_CHARS ? `${chars.slice(0, CITY_TAG_MAX_CHARS).join('')}…` : name;
}

/** 动态卡（情报页中 / Agent 页中）：事件流，发起者标签「玩家 / Agent / 系统」，战斗类事件带战报入口、侦察类带侦察报告入口。
 *  多城账号（AISLG-213）每行额外带城池名称标签（超过 6 字截断，悬停看全名，点击切城）。
 *  分页列表（行定高、文本截断，悬停看全文）；翻到最后一页后「更早」按钮向服务端加载更早的历史。 */
export function EventsPanel({
  events,
  hasMoreEvents,
  loadingOlder,
  onLoadOlder,
  actor,
  excludeActor,
  title,
  role = '事件面板',
}: EventsPanelProps) {
  const copy = useCopy();
  const { COPY, IDENTITY_LABEL, INTEL_COPY } = copy;
  const heading = title ?? INTEL_COPY.eventsTitle;
  const { openBattleReportById } = useBattleReportModal();
  const { openScoutReport } = useScoutReportModal();
  // 城池名称标签（AISLG-213）：从会话的城池集合（与城池下拉同源）查名字，点标签切城
  const { session } = useGame();
  const { cities, activeCityId } = session.cityList;
  // 单城不显示标签（没有区分的必要）；多城时只给带 cityId 的事件显示
  const showCityTags = cities.length >= 2;
  // 内部按时间正序存放，渲染时倒转：最新在最上
  const ordered = events
    .filter((event) => (actor === undefined || event.actor === actor) && (excludeActor === undefined || event.actor !== excludeActor))
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
        // 排除发起者时过滤后可能整页为空：自动补更早的历史（Agent 页保持原行为，不补）
        autoLoadMore={excludeActor !== undefined}
        autoLoadKey={events.length}
        empty={
          <p className="py-3 text-center text-[12.5px] text-faint" role="事件面板-空状态">
            {actor ? INTEL_COPY.agentLogEmpty : excludeActor !== undefined ? INTEL_COPY.eventsEmptyWithoutAgent : COPY.eventsPanel.empty}
          </p>
        }
        renderRow={(event) => {
          // 查不到（分城已放弃 / 名城被占走）→ 「原城池」且不可点；名字取自当前城池列表，改名后历史事件跟着变
          const eventCity =
            showCityTags && event.cityId !== undefined ? cities.find((item) => item.id === event.cityId) : undefined;
          return (
            <div className="flex items-center gap-2 border-b border-line-soft py-1 text-[12.5px] text-dim">
              <span className="shrink-0 font-mono text-[11.5px] text-faint">{event.at}</span>
              <span className={tagClass(event.actor)}>{IDENTITY_LABEL[event.actor]}</span>
              {showCityTags && event.cityId !== undefined ? (
                eventCity ? (
                  <button
                    type="button"
                    role="事件面板-城池标签"
                    title={COPY.eventsPanel.cityTagHint(tName(eventCity.name))}
                    onClick={() => {
                      if (eventCity.id !== activeCityId) {
                        void session.switchCity(eventCity.id);
                      }
                    }}
                    className="tag city-tag clickable cursor-pointer whitespace-nowrap"
                  >
                    {cityTagText(tName(eventCity.name))}
                  </button>
                ) : (
                  <span
                    role="事件面板-城池标签"
                    title={COPY.eventsPanel.cityGoneHint}
                    className="tag city-tag whitespace-nowrap"
                  >
                    {COPY.eventsPanel.cityGone}
                  </span>
                )
              ) : null}
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
          );
        }}
      />
    </Card>
  );
}
