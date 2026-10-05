/** Agent 页（三等分）：Agent 状态与计划 · Agent 操作记录（事件流里发起者是 Agent 的条目）· 离线日报摘要。 */

import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { AgentPanel } from '../AgentPanel';
import { OfflineSummaryCard } from '../agent/OfflineSummaryCard';
import { EventsPanel } from '../EventsPanel';
import { PageGrid } from './PageGrid';

export function AgentPage() {
  const copy = useCopy();
  const { EXTRA_PANEL, INTEL_COPY } = copy;
  const { session } = useGame();
  return (
    <PageGrid
      role="Agent页"
      layout="p-agent"
      blocks={[
        {
          key: 'agent',
          label: 'Agent',
          node: (
            <AgentPanel
              agent={session.agent}
              offlineReportError={session.offlineReportError}
              onOpenOfflineReport={() => void session.openOfflineReport()}
            />
          ),
        },
        {
          key: 'log',
          label: '记录',
          tab: EXTRA_PANEL.pageTabs.log,
          node: (
            <EventsPanel
              role="Agent页-操作记录"
              title={INTEL_COPY.agentLogTitle}
              actor="agent"
              events={session.events}
              hasMoreEvents={!session.eventsExhausted}
              loadingOlder={session.eventsLoadingOlder}
              onLoadOlder={() => void session.loadOlderEvents()}
            />
          ),
        },
        { key: 'offline', label: '日报', tab: EXTRA_PANEL.pageTabs.daily, hideMd: true, node: <OfflineSummaryCard /> },
      ]}
    />
  );
}
