/** 情报页（三等分）：战报（含侦察记录，点行开详情弹窗）· 动态（事件流，「更早」翻页）· 行军（同军队页中栏，方便对照）。
 *  进入页面即视为已读最新战报（导航角标清零）。 */

import { useGame } from '../../state/GameContext';
import { useNav } from '../../state/NavContext';
import { MarchesCard } from '../army/MarchesCard';
import { EventsPanel } from '../EventsPanel';
import { WorldReportsPanel } from '../WorldReportsPanel';
import { PageGrid } from './PageGrid';

export function IntelPage() {
  const { session } = useGame();
  const { markReportsSeen } = useNav();
  return (
    <PageGrid
      role="情报页"
      layout="p-intel"
      blocks={[
        { key: 'report', label: '战报', node: <WorldReportsPanel world={session.world} onSeen={markReportsSeen} /> },
        {
          key: 'event',
          label: '动态',
          node: (
            <EventsPanel
              events={session.events}
              hasMoreEvents={!session.eventsExhausted}
              loadingOlder={session.eventsLoadingOlder}
              onLoadOlder={() => void session.loadOlderEvents()}
            />
          ),
        },
        { key: 'march', label: '行军', hideMd: true, node: <MarchesCard role="情报页-行军" /> },
      ]}
    />
  );
}
