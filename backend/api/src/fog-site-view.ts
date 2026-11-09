// 遗迹、名将处所与名城首探者的地图裁剪（AISLG-227，v93）：叠加在 fog-view.ts 的窗口 / 详情结果上。
// 只给实时视野或已探索的格（判定与 fog-view 的 known 一致）；未探索的格不带任何遗迹 / 处所信息。
// 遗迹取实时状态（未领取才有），不走“上次看到”的快照，所以领取后所有人的地图立刻去掉。
// 只在 fog_enabled 开启时调用（fog-view 的开关分支保证）。
import type { HeroSiteView, RelicTileView, TileView } from '../../common/src/protocol';
import { isCellExplored } from '../../common/src/fog';
import { HERO_SITES } from '../../common/src/relic';
import { famousFirstExplorers, heroSitesInWindow, unclaimedRelicsInWindow } from '../../common/src/fog-relic-db';
import type { FogRequest } from './fog-view';

/** 窗口内的地块补上 relic / heroSite / 名城首探者；未探索且不在视野内的格保持 null */
export async function applySiteViews(req: FogRequest, tiles: TileView[], x: number, y: number, w: number, h: number): Promise<void> {
  if (tiles.length === 0) {
    return;
  }
  const relics = new Map<string, RelicTileView>();
  for (const row of await unclaimedRelicsInWindow(req.client, x, y, w, h)) {
    relics.set(`${row.x},${row.y}`, { tier: row.tier, kind: row.kind });
  }
  const sites = new Map<string, HeroSiteView>();
  for (const row of await heroSitesInWindow(req.client, req.accountId, x, y, w, h)) {
    const site = HERO_SITES.find((entry) => entry.hero === row.hero);
    if (site) {
      sites.set(`${row.x},${row.y}`, { name: site.name, hero: row.hero, claimed: row.claimed });
    }
  }
  const firsts = await famousFirstExplorers(req.client);
  for (const tile of tiles) {
    const known = tile.fog === 'visible' || isCellExplored(req.bits, tile.x, tile.y);
    const key = `${tile.x},${tile.y}`;
    tile.relic = known ? (relics.get(key) ?? null) : null;
    tile.heroSite = known ? (sites.get(key) ?? null) : null;
    if (tile.famous) {
      tile.famous = { ...tile.famous, firstExplorer: known ? (firsts.get(tile.famous.name) ?? null) : null };
    }
  }
}
