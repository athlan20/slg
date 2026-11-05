// 小地图的遗迹与名将处所点位（AISLG-227，v93）：只给实时视野或已探索的格；遗迹还要未领取。
// 与 fog-overview.ts 的城池点位合并（map-overview.ts 调用）。fog_enabled 关闭时不会走到这里。
import type { MapOverviewSide } from '../../common/src/protocol';
import { WORLD_SIZE } from '../../common/src/world';
import { inAnyVision, isCellExplored } from '../../common/src/fog';
import { allUnclaimedRelics, heroSitesInWindow } from '../../common/src/fog-relic-db';
import { fogOverview, type OverviewRow } from './fog-overview';
import type { FogRequest } from './fog-view';

/** 城池点位（fogOverview）+ 遗迹 / 名将处所点位，按坐标排序 */
export async function fogOverviewWithSites(req: FogRequest, rows: readonly OverviewRow[]) {
  const base = await fogOverview(req, rows);
  const known = (x: number, y: number): boolean => isCellExplored(req.bits, x, y) || inAnyVision(req.sources, x, y);
  const points: Array<[number, number, MapOverviewSide]> = [];
  for (const relic of await allUnclaimedRelics(req.client)) {
    if (known(relic.x, relic.y)) {
      points.push([relic.x, relic.y, 'relic']);
    }
  }
  for (const site of await heroSitesInWindow(req.client, 0, 0, WORLD_SIZE, WORLD_SIZE)) {
    if (known(site.x, site.y)) {
      points.push([site.x, site.y, site.claimed ? 'hero_site_claimed' : 'hero_site']);
    }
  }
  const cities = [...base.cities, ...points].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return { ...base, cities };
}
