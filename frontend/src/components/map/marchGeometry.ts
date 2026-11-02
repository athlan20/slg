// 行军图层的纯几何（AISLG-216）：进度插值、图标像素位置、视野外箭头、同格合并。
// 只做「数据 → 坐标」的换算，不碰 React 与协议运行时（只能用 import type），
// 这样 backend/test 的 node:test 可以直接 import 本文件做单元测试。

import type { CityRefView, MarchView } from '../../api/protocol';

export interface Cell {
  x: number;
  y: number;
}

/** 上图的一支行军：起终点、当前图标位置（世界格坐标，小数）与倒计时 */
export interface MapMarch {
  id: string;
  purpose: MarchView['purpose'];
  /** 起点格（返程已反向：目标格 → 出发城） */
  from: Cell;
  to: Cell;
  /** 图标当前所在位置（格坐标的小数插值，夹在起终点之间） */
  pos: Cell;
  /** 是否会停在埋伏点（截击已过 ambushAt，图标停在目标格并改用埋伏倒计时） */
  ambushing: boolean;
  /** 到 arriveAt 的剩余毫秒（不为负） */
  leftMs: number;
  march: MarchView;
}

/** 行军结束时刻（毫秒）：截击且已排埋伏点时用 ambushAt 代替 arriveAt（图标到埋伏点即停） */
export function marchEndMs(march: Pick<MarchView, 'arriveAt' | 'ambushAt' | 'purpose'>): number {
  const arrive = Date.parse(march.arriveAt);
  if (march.purpose === 'intercept' && march.ambushAt !== null) {
    const ambush = Date.parse(march.ambushAt);
    if (Number.isFinite(ambush)) {
      return ambush;
    }
  }
  return arrive;
}

/**
 * 行军进度 = (现在 − startedAt) ÷ (结束时刻 − startedAt)，夹在 0～1。
 * 服务端按切比雪夫距离匀速计时，所以按比例走与真实到达时刻一致。
 */
export function marchProgress(march: Pick<MarchView, 'startedAt' | 'arriveAt' | 'ambushAt' | 'purpose' | 'status'>, now: number): number {
  const start = Date.parse(march.startedAt);
  const end = marchEndMs(march);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return now >= end ? 1 : 0;
  }
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

export function lerpCell(from: Cell, to: Cell, t: number): Cell {
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/** 城池坐标（出发城 / 返程终点）；未定位的城（x / y 为 null）返回 null，该条行军不上图 */
export function cityCell(cities: CityRefView[], cityId: string): Cell | null {
  const city = cities.find((item) => item.id === cityId);
  if (!city || city.x === null || city.y === null) {
    return null;
  }
  return { x: city.x, y: city.y };
}

/** 当前城池在途行军 → 上图数据（只取 status = marching；出发城查不到坐标的跳过） */
export function mapMarchers(marches: MarchView[], cities: CityRefView[], now: number): MapMarch[] {
  const result: MapMarch[] = [];
  for (const march of marches) {
    if (march.status !== 'marching') {
      continue;
    }
    const home = cityCell(cities, march.fromCityId);
    if (!home) {
      continue;
    }
    const target = { x: march.x, y: march.y };
    const returning = march.purpose === 'return';
    const from = returning ? target : home;
    const to = returning ? home : target;
    const ambushing = march.purpose === 'intercept' && march.ambushAt !== null && now >= Date.parse(march.ambushAt);
    result.push({
      id: march.id,
      purpose: march.purpose,
      from,
      to,
      pos: lerpCell(from, to, marchProgress(march, now)),
      ambushing,
      leftMs: Math.max(0, Date.parse(march.arriveAt) - now),
      march,
    });
  }
  return result;
}

/** 倒计时标签：不足 1 小时 mm:ss，1 小时及以上 h:mm:ss（每秒刷新一次） */
export function formatMarchLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 图标分组：落在同一格（取整格坐标）的行军合成一组，lead = 剩余时间最短的那支 */
export interface MarchIconGroup {
  key: string;
  lead: MapMarch;
  /** 组内全部行军，剩余时间短的在前 */
  marches: MapMarch[];
}

export function groupMarchIcons(marches: MapMarch[]): MarchIconGroup[] {
  const groups = new Map<string, MapMarch[]>();
  for (const item of marches) {
    const key = `${Math.round(item.pos.x)},${Math.round(item.pos.y)}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return [...groups.entries()].map(([key, bucket]) => {
    const sorted = [...bucket].sort((a, b) => a.leftMs - b.leftMs);
    return { key, lead: sorted[0], marches: sorted };
  });
}

/** 覆盖层的像素几何：步长含 3px 格间距，cellW / cellH 是格子本身的边长（横纵可能不等） */
export interface GridMetrics {
  stepW: number;
  stepH: number;
  cellW: number;
  cellH: number;
  gap: number;
}

export const TILE_GAP_PX = 3;

export function gridMetrics(win: { w: number; h: number; x: number; y: number }, size: { w: number; h: number }, gap = TILE_GAP_PX): GridMetrics {
  const cols = Math.max(1, win.w);
  const rows = Math.max(1, win.h);
  const stepW = size.w > 0 ? (size.w + gap) / cols : 0;
  const stepH = size.h > 0 ? (size.h + gap) / rows : 0;
  return { stepW, stepH, cellW: Math.max(0, stepW - gap), cellH: Math.max(0, stepH - gap), gap };
}

/** 格坐标 → 覆盖层像素（整数格坐标落在格子中心，小数坐标线性插值） */
export function cellToPx(pos: Cell, origin: Cell, m: GridMetrics): { px: number; py: number } {
  return {
    px: (pos.x - origin.x) * m.stepW + m.cellW / 2,
    py: (pos.y - origin.y) * m.stepH + m.cellH / 2,
  };
}

/** 覆盖层内容像素尺寸（网格总宽高，含格间距） */
export function layerSize(win: { w: number; h: number }, m: GridMetrics): { w: number; h: number } {
  return {
    w: Math.max(0, win.w * m.stepW - (m.stepW > 0 ? m.gap : 0)),
    h: Math.max(0, win.h * m.stepH - (m.stepH > 0 ? m.gap : 0)),
  };
}

/** 行军图标直径：约格子边长 45%，夹在 14～24px */
export function marchIconSize(m: GridMetrics): number {
  const side = Math.min(m.cellW, m.cellH);
  return Math.min(24, Math.max(14, Math.round(side * 0.45)));
}

/** 视野外箭头：位置夹到边框内沿（pad 像素），angle 指向图标真实位置（度，0 = 向右）；图标在视野内返回 null */
export function edgeArrow(
  pos: Cell,
  origin: Cell,
  win: { w: number; h: number },
  m: GridMetrics,
  pad = 14,
): { px: number; py: number; angle: number } | null {
  const size = layerSize(win, m);
  if (size.w <= 0 || size.h <= 0) {
    return null;
  }
  const p = cellToPx(pos, origin, m);
  const inside = p.px >= 0 && p.px <= size.w && p.py >= 0 && p.py <= size.h;
  if (inside) {
    return null;
  }
  const px = Math.min(Math.max(p.px, pad), size.w - pad);
  const py = Math.min(Math.max(p.py, pad), size.h - pad);
  const angle = (Math.atan2(p.py - py, p.px - px) * 180) / Math.PI;
  return { px, py, angle };
}

/** 视野外箭头上限：超过这个数只留剩余时间最短的几支，其余合并成 +N 角标 */
export const EDGE_ARROW_LIMIT = 6;
