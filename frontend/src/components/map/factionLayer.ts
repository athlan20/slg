// 势力范围图层的纯计算（v99，AISLG-239）：按五家的老巢与当前半径算出窗口内每一格归哪家，
// 以及窗口里有没有老巢。判定口径与后端 common/src/faction.ts 的 factionAt 完全一致
//（切比雪夫距离、范围内离老巢最近的一家、距离相同按 factions 数组顺序），前端只负责铺色与标记。
// 只依赖 GET_FACTIONS 的公开数据（老巢坐标 + 半径），不读地块内容：迷雾里的格子也能铺色，
// 但不会因此显示地形 / 城池（那些仍由窗口数据决定）。

import type { FactionKey, FactionView } from '../../api/protocol-faction';

/** 每家一种颜色（半透明，铺在格子上不挡图标；需求「每家一种颜色」） */
/** 面板色标用的不透明版本，和地图色块同色相 */
export const FACTION_SOLID_COLORS: Record<FactionKey, string> = {
  liangzhou: 'rgb(214, 92, 62)',
  wuhuan: 'rgb(74, 130, 202)',
  nanman: 'rgb(62, 158, 112)',
  shanyue: 'rgb(166, 108, 200)',
  heishan: 'rgb(208, 168, 62)',
};

export const FACTION_COLORS: Record<FactionKey, string> = {
  liangzhou: 'rgba(214, 92, 62, 0.20)',
  wuhuan: 'rgba(74, 130, 202, 0.20)',
  nanman: 'rgba(62, 158, 112, 0.20)',
  shanyue: 'rgba(166, 108, 200, 0.20)',
  heishan: 'rgba(208, 168, 62, 0.20)',
};

/** 迷雾格里铺色时再淡一档（颜色只表示地盘，不揭开迷雾） */
export const FACTION_FOG_OPACITY = 0.12;

export interface FactionWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 某格归哪家：范围内离老巢最近的一家；距离相同按 factions 顺序取先出现的一家；都不在范围内返回 null */
export function factionAtCell(factions: readonly FactionView[], x: number, y: number): FactionKey | null {
  let best: FactionKey | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const faction of factions) {
    const distance = Math.max(Math.abs(faction.lair.x - x), Math.abs(faction.lair.y - y));
    if (distance <= faction.radius && distance < bestDistance) {
      best = faction.key;
      bestDistance = distance;
    }
  }
  return best;
}

/** 窗口内属于势力范围的格：键 "x,y" → 势力标识（窗口最多 20×20，逐格算即可） */
export function factionCellsOf(factions: readonly FactionView[], win: FactionWindow): Map<string, FactionKey> {
  const cells = new Map<string, FactionKey>();
  if (factions.length === 0) {
    return cells;
  }
  for (let y = win.y; y < win.y + win.h; y += 1) {
    for (let x = win.x; x < win.x + win.w; x += 1) {
      const key = factionAtCell(factions, x, y);
      if (key) {
        cells.set(`${x},${y}`, key);
      }
    }
  }
  return cells;
}

/** 窗口内的老巢（老巢坐标对全服公开，迷雾里的格也画标记） */
export function lairsInWindow(factions: readonly FactionView[], win: FactionWindow): Map<string, FactionView> {
  const map = new Map<string, FactionView>();
  for (const faction of factions) {
    const { x, y } = faction.lair;
    if (x >= win.x && x < win.x + win.w && y >= win.y && y < win.y + win.h) {
      map.set(`${x},${y}`, faction);
    }
  }
  return map;
}

/** 面板与标记用的显示名：中文界面取中文名，英文界面取英文名 */
export function factionName(faction: { name: string; nameEn: string }, lang: string): string {
  return lang === 'en' ? faction.nameEn : faction.name;
}

/** 首领名同样按语言取 */
export function factionLeaderName(faction: { leader: string; leaderEn: string }, lang: string): string {
  return lang === 'en' ? faction.leaderEn : faction.leader;
}
