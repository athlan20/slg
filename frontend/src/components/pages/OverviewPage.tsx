/** 总览页 = 状态看板（不放地图，地图只在地图页）：军情摘要 · 进行中（建造 / 征兵 / 科技 / 行军四条泳道）·
 *  兵力与人口 · 最近动态。要看细节 / 动手：地图页（目标与出征）、城池页（建造）、军队页（征兵）、情报页（战报与完整动态）。 */

import { formatDurationText } from '../../api/format';
// role 定位值取静态中文文案源（AISLG-137 约定：role 不随界面语言变）
import { FOOT_COPY as FOOT_COPY_ZH } from '../../copy-ui';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { buildProgressItems, type Lane } from '../../state/progressItems';
import { useNow } from '../../state/useNow';
import { EventsPanel } from '../EventsPanel';
import { MilitarySummary } from '../intel/MilitarySummary';
import { ArmyOverviewCard } from '../overview/ArmyOverviewCard';
import { Card } from '../ui/Card';
import { PageGrid } from './PageGrid';

const LANES: Lane[] = ['build', 'recruit', 'tech', 'march'];
/** 每条泳道最多显示的条目数（多出的折成「+N」，避免泳道被撑高） */
const MAX_CHIPS = 6;

function LanesCard() {
  const copy = useCopy();
  const { EXTRA_PANEL, FOOT_COPY, IDENTITY_LABEL, OVERVIEW_COPY, SUMMARY_COPY } = copy;
  const { session } = useGame();
  const now = useNow(true);
  const items = buildProgressItems(session.city, session.techSession.tech?.research ?? null, now);

  return (
    <Card role="总览页-进行中" title={OVERVIEW_COPY.lanesTitle}>
      <div className="flex min-h-0 flex-1 flex-col justify-start gap-2.5 overflow-hidden">
        {LANES.map((lane) => {
          const laneItems = items.filter((item) => item.lane === lane);
          return (
            <div key={lane} role={`时间线-${FOOT_COPY_ZH.lane[lane]}`} className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-2">
              <span className="pt-0.5 text-[11.5px] text-faint">{FOOT_COPY.lane[lane]}</span>
              <div className="flex max-h-[3.2rem] flex-wrap gap-x-1.5 gap-y-1 overflow-hidden">
                {laneItems.length === 0 ? (
                  <span className="rounded border border-dashed border-line px-2 py-0.5 text-[11.5px] text-faint">{SUMMARY_COPY.idle}</span>
                ) : (
                  <>
                    {laneItems.slice(0, MAX_CHIPS).map((item) => (
                      <span
                        key={item.id}
                        title={`${item.text}${item.by ? ` · ${IDENTITY_LABEL[item.by]}` : ''}`}
                        className="relative inline-flex max-w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded border border-line bg-panel-2 px-2 py-0.5 text-[11.5px]"
                      >
                        <span className="truncate">{item.text}</span>
                        <span className={`font-mono tabular-nums ${item.ambush ? 'text-gold' : 'text-accent'}`}>{item.leftSec === null ? EXTRA_PANEL.overviewPage.queued : formatDurationText(item.leftSec)}</span>
                        <i className="absolute bottom-0 left-0 h-0.5 bg-accent" style={{ width: `${item.pct}%` }} />
                      </span>
                    ))}
                    {laneItems.length > MAX_CHIPS ? <span className="px-1 text-[11.5px] text-faint">+{laneItems.length - MAX_CHIPS}</span> : null}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function OverviewPage() {
  const copy = useCopy();
  const { EXTRA_PANEL, INTEL_COPY, OVERVIEW_COPY, SUMMARY_COPY } = copy;
  const { session } = useGame();
  return (
    <PageGrid
      role="总览页"
      layout="p-overview"
      blocks={[
        {
          key: 'ctx',
          label: '军情',
          tab: SUMMARY_COPY.title,
          areaClass: 'a-ctx',
          node: (
            <Card role="总览页-军情摘要" title={SUMMARY_COPY.title}>
              <MilitarySummary role="总览页-军情摘要-列表" />
            </Card>
          ),
        },
        { key: 'lanes', label: '进行中', tab: OVERVIEW_COPY.lanesTitle, areaClass: 'a-lanes', node: <LanesCard /> },
        { key: 'army', label: '兵力', tab: EXTRA_PANEL.pageTabs.troops, areaClass: 'a-army', node: <ArmyOverviewCard /> },
        {
          key: 'events',
          label: '动态',
          tab: INTEL_COPY.eventsTitle,
          areaClass: 'a-events',
          node: (
            <EventsPanel
              role="总览页-最近动态"
              title={OVERVIEW_COPY.eventsTitle}
              events={session.events}
              hasMoreEvents={false}
              loadingOlder={false}
              onLoadOlder={() => undefined}
            />
          ),
        },
      ]}
    />
  );
}
