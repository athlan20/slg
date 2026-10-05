/** 地图页：左 1fr = 地图卡；右 360px = 选中目标详情与就地操作（未选中时是军情摘要 + 流寇商队列表）。 */

import { useEffect } from 'react';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { MilitarySummary } from '../intel/MilitarySummary';
import { MapCard } from '../map/MapCard';
import { MovingTargetList } from '../map/MovingTargetList';
import { TargetPanel } from '../map/TargetPanel';
import { Card } from '../ui/Card';
import { PageGrid } from './PageGrid';

export function MapPage() {
  const copy = useCopy();
  const { EXTRA_PANEL, MOVING_COPY, NAV_COPY, SUMMARY_COPY, TARGET_COPY } = copy;
  const { session } = useGame();
  const world = session.world;
  const hasTile = world.selected !== null;

  // 未选中时残留的出征 / 撤回错误不再有地方显示：收起
  useEffect(() => {
    if (!hasTile && world.error) {
      world.clearError();
    }
    // world.clearError 是稳定回调，只在选中状态变化时收敛
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasTile]);

  return (
    <PageGrid
      role="地图页"
      layout="p-map"
      forceTab={hasTile ? 'detail' : null}
      hideTabs
      blocks={[
        { key: 'map', label: '地图', tab: NAV_COPY.pages.map.label, node: <MapCard role="地图页-地图卡" /> },
        {
          key: 'detail',
          label: '详情',
          tab: EXTRA_PANEL.pageTabs.detail,
          node: hasTile ? (
            <Card role="地图页-选中详情">
              <TargetPanel />
            </Card>
          ) : (
            <div role="地图页-军情" className="flex min-h-0 flex-col gap-2">
              <Card role="地图页-军情摘要" title={SUMMARY_COPY.title} meta={TARGET_COPY.summaryHint}>
                <MilitarySummary role="地图页-军情摘要-列表" />
              </Card>
              <Card role="地图页-流寇商队" title={MOVING_COPY.panel.title}>
                <MovingTargetList targets={session.moving.targets} world={world} />
              </Card>
            </div>
          ),
        },
      ]}
    />
  );
}
