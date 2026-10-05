/** 城池页：顶部 = 建造队列（三个槽位，一直可见）；左下 = 城内视图（15 座建筑按资源 / 内政 / 军事分三行，紧凑格）；
 *  右下 340px = 选中建筑的详情（就地建造 / 升级）。 */

import { KIND_ORDER, CityGrid } from '../city/CityGrid';
import { BuildingDetail } from '../city/BuildingDetail';
import { CityStatsCard } from '../city/CityStatsCard';
import { BuildQueuePanel } from '../BuildQueuePanel';
import { Card } from '../ui/Card';
import { CITY_PAGE_COPY } from '../../copy-pages';
import { DEFENSE_COPY } from '../../copy-defense';
import { useGame } from '../../state/GameContext';
import { useNav } from '../../state/NavContext';
import { PageGrid } from './PageGrid';

export function CityPage() {
  const { session } = useGame();
  const { building, selectBuilding } = useNav();
  const city = session.city;
  const built = city ? KIND_ORDER.filter((kind) => (city.levels[kind] ?? 0) > 0).length : 0;

  return (
    <PageGrid
      role="城池页"
      layout="p-city"
      forceTab={building !== null ? 'detail' : null}
      hideTabs
      defaultTab="grid"
      blocks={[
        {
          key: 'queue',
          label: '队列',
          areaClass: 'a-queue',
          always: true,
          fit: true,
          node: <BuildQueuePanel city={city} buildError={session.buildError} onCancelBuild={(id) => void session.cancelBuild(id)} />,
        },
        {
          key: 'grid',
          label: '城内',
          areaClass: 'a-grid',
          fit: true,
          node: (
            <Card
              role="城池页-城内视图"
              flush
              title={CITY_PAGE_COPY.gridTitle}
              meta={
                city ? (
                  <span title={DEFENSE_COPY.deploy.hint}>
                    {CITY_PAGE_COPY.gridMeta(built, KIND_ORDER.length)} · {DEFENSE_COPY.deploy.meta(city.deploy.count, city.deploy.limit)}
                  </span>
                ) : undefined
              }
            >
              <CityGrid city={city} selected={building} onPick={selectBuilding} />
            </Card>
          ),
        },
        { key: 'stats', label: '概况', areaClass: 'a-stats', node: <CityStatsCard city={city} /> },
        {
          key: 'detail',
          label: '详情',
          areaClass: 'a-detail',
          node: (
            <Card role="城池页-建筑详情卡">
              {city && building ? (
                <BuildingDetail
                  key={building}
                  city={city}
                  kind={building}
                  connection={session.connection}
                  onClose={() => selectBuilding(null)}
                  onStartBuild={(kind) => void session.startBuild(kind)}
                  onStartUpgrade={(kind, toLevel) => void session.startUpgrade(kind, toLevel)}
                />
              ) : (
                <p role="城池页-建筑详情-空态" className="grid flex-1 place-items-center text-[12.5px] text-faint">
                  {city ? CITY_PAGE_COPY.placeholder : '尚未获取城池状态'}
                </p>
              )}
            </Card>
          ),
        },
      ]}
    />
  );
}
