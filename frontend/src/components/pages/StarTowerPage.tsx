/** 将星塔页（v55，AISLG-146）：单机爬塔的进度与挑战、阵容（与竞技场共用一份）、战报。
 *  桌面三栏（1024–1279 两栏，战报横跨第二行）；手机用分段条。 */

import { useEffect } from 'react';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { Card } from '../ui/Card';
import { LineupEditor } from '../LineupEditor';
import { StarTowerProgressCard } from '../star-tower/StarTowerProgressCard';
import { StarTowerReportsCard } from '../star-tower/StarTowerReportsCard';
import { PageGrid } from './PageGrid';

export function StarTowerPage() {
  const copy = useCopy();
  const { STAR_TOWER_COPY } = copy;
  const { session } = useGame();
  const star = session.starTowerSession;
  const { fetchTower } = star;

  // 进入页面时拉一次：阵容可能在竞技场页改过（两边共用一份）
  useEffect(() => {
    void fetchTower();
  }, [fetchTower]);

  return (
    <PageGrid
      role="将星塔页"
      layout="p-star-tower"
      blocks={[
        { key: 'progress', label: '进度', tab: STAR_TOWER_COPY.tabs.progress, areaClass: 'a-star-progress', node: <StarTowerProgressCard session={star} /> },
        {
          key: 'lineup',
          label: '阵容',
          tab: STAR_TOWER_COPY.tabs.lineup,
          areaClass: 'a-star-lineup',
          node: (
            <Card role="将星塔页-阵容" title={STAR_TOWER_COPY.lineup.title}>
              <LineupEditor
                role="将星塔页-阵容-编辑"
                heroes={session.heroSession.state?.heroes ?? []}
                lineup={star.tower ? star.tower.lineup : null}
                busy={star.busy}
                copy={STAR_TOWER_COPY.lineup}
                showTitle={false}
                onSave={(heroIds) => void star.saveLineup(heroIds)}
              />
            </Card>
          ),
        },
        { key: 'reports', label: '战报', tab: STAR_TOWER_COPY.tabs.reports, areaClass: 'a-star-reports', node: <StarTowerReportsCard session={star} /> },
      ]}
    />
  );
}
