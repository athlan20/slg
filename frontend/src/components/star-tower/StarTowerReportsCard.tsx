// 将星塔战报卡（v55，AISLG-146）：我每次挑战的结果，按时间从新到旧，分页（不滚动）。

import { useCopy } from '../../i18n/bundle';
import type { StarTowerMatchView } from '../../api/protocol';
import type { StarTowerSession } from '../../state/starTowerSession';
import { Card } from '../ui/Card';
import { PagedList } from '../ui/PagedList';

interface StarTowerReportsCardProps {
  session: StarTowerSession;
}

export function StarTowerReportsCard({ session }: StarTowerReportsCardProps) {
  const copy = useCopy();
  const R = copy.STAR_TOWER_COPY.reports;
  const { reports, reportsHasMore, fetchReports } = session;

  return (
    <Card role="将星塔页-战报" title={R.title}>
      <PagedList<StarTowerMatchView>
        role="将星塔页-战报-列表"
        items={reports ?? []}
        keyOf={(row) => row.id}
        gap={3}
        gapClass="gap-[3px]"
        hasMore={reportsHasMore}
        onLoadMore={() => void fetchReports(true)}
        empty={<p className="text-[12px] text-faint">{R.empty}</p>}
        renderRow={(row) => (
          <div role={`将星塔页-战报-${row.id}`} className="flex min-w-0 items-center gap-1.5 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-1 text-[12px]">
            <span className={`shrink-0 font-semibold ${row.won ? 'text-ok' : 'text-warn'}`}>{row.won ? R.won : R.lost}</span>
            <span className="min-w-0 flex-1 truncate">
              {R.floor(row.floor)}
              {row.boss ? <span className="ml-1 text-[11px] font-semibold text-warn">{R.boss}</span> : null}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-faint">{R.score(row.challengerWins, row.defenderWins)}</span>
          </div>
        )}
      />
    </Card>
  );
}
