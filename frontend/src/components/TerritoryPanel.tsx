/** 领地卡（军队页右）：本城占领的野地一览——地形 / 等级 / 坐标 / 加成 / 连片标注 / 驻军；
 *  点「定位」在世界地图居中并选中该地块（跳地图页，可就地增援 / 撤回驻军）。数据来自城池状态，占领 / 失守后自动刷新。 */

import { useCopy } from '../i18n/bundle';
import { useGame } from '../state/GameContext';
import { useNav } from '../state/NavContext';
import { Card } from './ui/Card';
import { PagedList } from './ui/PagedList';

export function TerritoryPanel() {
  const copy = useCopy();
  const { COPY, RESOURCE_LABEL, TERRAIN_LABEL, ARMY_COPY } = copy;
  const { session } = useGame();
  const { go } = useNav();
  const city = session.city;
  const world = session.world;
  const territory = city?.territory ?? [];

  return (
    <Card role="左列-领地列表" title={ARMY_COPY.territoryTitle} meta={city ? ARMY_COPY.territoryMeta(territory.length, city.levels.government) : undefined}>
      <PagedList
        role="领地-列表"
        items={territory}
        keyOf={(tile) => `${tile.x}-${tile.y}`}
        empty={<p className="py-4 text-center text-[12px] text-faint">{COPY.worldMap.territoryEmpty}</p>}
        renderRow={(tile) => (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-1">
            <span className="min-w-0">
              <b className="block truncate text-[12px] font-medium" title={COPY.worldMap.territoryRow(TERRAIN_LABEL[tile.terrain], tile.level, RESOURCE_LABEL[tile.resource], tile.bonusRate + tile.gatherRate)}>
                {COPY.worldMap.territoryRow(TERRAIN_LABEL[tile.terrain], tile.level, RESOURCE_LABEL[tile.resource], tile.bonusRate + tile.gatherRate)}
              </b>
              <small className="block truncate text-[11px] text-faint">
                ({tile.x},{tile.y}) · {COPY.worldMap.territoryGarrison(tile.garrison)}
                {tile.clusterBonusPercent > 0 ? (
                  <span role="左列-领地连片标注" className="ml-1.5 rounded border border-gold-dim px-1 text-gold" title={COPY.worldMap.clusterTip(RESOURCE_LABEL[tile.resource], tile.clusterSize, tile.clusterBonusPercent)}>
                    {COPY.worldMap.territoryCluster(tile.clusterSize, tile.clusterBonusPercent)}
                  </span>
                ) : null}
              </small>
            </span>
            <button
              type="button"
              role="左列-领地定位"
              className="btn"
              onClick={() => {
                world.centerOn(tile.x, tile.y);
                world.selectTile(tile.x, tile.y);
                go('map');
              }}
            >
              {ARMY_COPY.marchLocate}
            </button>
          </div>
        )}
      />
    </Card>
  );
}
