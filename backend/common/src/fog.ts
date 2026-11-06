// 战争迷雾的纯函数（AISLG-224 第一步）：区块位图、视野半径、行军路线与当前位置。
// 不碰数据库与协议运行时，API 与 Worker 共用。位置与几何口径与前端 marchGeometry.ts 一致
//（行军进度 = (now − startedAt) ÷ (结束时刻 − startedAt)，返程从目标格回出发城）。
// 区块：全图切成 10×10 的块，共 10,000 块，第 i 块对应位图第 i>>3 字节的第 (i&7) 位。

import { WORLD_SIZE } from './world';
import { facilityVisionRadiusOf } from './facility';

/** 区块边长（格） */
export const FOG_CHUNK_SIZE = 10;
/** 每边区块数 */
export const FOG_CHUNKS_PER_SIDE = WORLD_SIZE / FOG_CHUNK_SIZE;
/** 区块总数 */
export const FOG_CHUNK_COUNT = FOG_CHUNKS_PER_SIDE * FOG_CHUNKS_PER_SIDE;
/** 位图字节数（每账号一份，base64 后约 1.7 KB） */
export const FOG_BITMAP_BYTES = FOG_CHUNK_COUNT / 8;

/** 视野半径（格，Chebyshev 距离）：来源 → 半径 */
export const FOG_VISION = {
  /** 主城 */
  mainCity: 12,
  /** 分城 */
  branchCity: 8,
  /** 占领的野地 */
  wilderness: 3,
  /** 行军中的部队（不含斥候） */
  march: 3,
  /** 含斥候的部队，侦察科技 Lv0–2 */
  scout: 5,
  /** 侦察科技 Lv3 起 */
  scoutTech3: 6,
  /** 侦察科技 Lv6 起 */
  scoutTech6: 7,
} as const;

/**
 * 丘陵上的野地视野加成（AISLG-233「丘陵视野」）：站得高望得远，只对**占领的野地**生效——
 * 主城 / 分城（地形开局随机，加成会变成看运气）与行军中的部队（一路走一路变半径，视野会闪）都不加成。
 */
export const HILL_VISION_BONUS = 2;
/** 视野半径上限（格）：与主城持平，丘陵加成不再往上叠（AISLG-233；3 级望楼 10 + 2 正好封顶） */
export const FOG_VISION_MAX = 12;

/** 开局 / 存量初始化：主城周围该半径内的区块记为已探索 */
export const FOG_OPENING_RADIUS = 30;
/** 探索简报最多列出的坐标数 */
export const FOG_REPORT_CELL_LIMIT = 10;
/** 战力榜前 N 名的主城在小地图上公开（分城不公开） */
export const FOG_POWER_TOP_N = 20;

/**
 * 一块占领野地的视野半径：野地原来 3 格，地上的望楼按等级给 6 / 8 / 10 格，**取大不叠加**
 *（v97，AISLG-232；望楼的半径取代野地那 3 格）。丘陵上的野地在这之上再 +2（v97，AISLG-233：
 * 没望楼 3 → 5，1 / 2 / 3 级望楼 6 / 8 / 10 → 8 / 10 / 12），半径上限 12、与主城持平。
 * 这是「视野半径怎么算」的唯一入口——地形影响视野的规则加在这里，不要在别处另写一份。
 * 其他地形（平原 / 草原 / 森林 / 荒漠 / 沼泽 / 湖泊 / 金矿）不变。
 */
export function wildernessVisionRadius(facilityLevel: number | null | undefined, terrain?: string | null): number {
  const base = Math.max(FOG_VISION.wilderness, facilityVisionRadiusOf(facilityLevel));
  const radius = terrain === 'hill' ? base + HILL_VISION_BONUS : base;
  return Math.min(FOG_VISION_MAX, radius);
}

/**
 * 下发给客户端的设施视野半径（city.territory[].facility.visionRadius / GET_TILE 的 facility）：
 * 望楼还没建成（0 级）时为 0；建成后是该地块**加成后的有效半径**（丘陵外 6 / 8 / 10，丘陵上 8 / 10 / 12），
 * 界面显示的格数与实际视野一致（AISLG-233 技术细节）。
 */
export function builtFacilityVisionRadius(facilityLevel: number | null | undefined, terrain?: string | null): number {
  return facilityLevel && facilityLevel > 0 ? wildernessVisionRadius(facilityLevel, terrain) : 0;
}

/** 斥候视野半径：侦察科技等级 → 半径（Lv3 起 6，Lv6 起 7） */
export function scoutVisionRadius(scoutingLevel: number): number {
  if (scoutingLevel >= 6) {
    return FOG_VISION.scoutTech6;
  }
  if (scoutingLevel >= 3) {
    return FOG_VISION.scoutTech3;
  }
  return FOG_VISION.scout;
}

/** 区块下标：floor(y/10)*100 + floor(x/10)；越界坐标调用方自行保证 inWorld */
export function chunkIndexOf(x: number, y: number): number {
  return Math.floor(y / FOG_CHUNK_SIZE) * FOG_CHUNKS_PER_SIDE + Math.floor(x / FOG_CHUNK_SIZE);
}

/** 全未探索的空位图 */
export function newFogBits(): Uint8Array {
  return new Uint8Array(FOG_BITMAP_BYTES);
}

/** 从库里取出的字节（bytea）规整为位图；长度不对视为空位图（不让坏数据撑出越界） */
export function fogBitsFrom(bytes: Uint8Array | null | undefined): Uint8Array {
  if (!bytes || bytes.length !== FOG_BITMAP_BYTES) {
    return newFogBits();
  }
  return new Uint8Array(bytes);
}

/** 区块是否已探索 */
export function isChunkExplored(bits: Uint8Array, index: number): boolean {
  return (bits[index >> 3] & (1 << (index & 7))) !== 0;
}

/** 置位一个区块；返回是否由未探索变为已探索 */
export function setChunkExplored(bits: Uint8Array, index: number): boolean {
  const byte = index >> 3;
  const mask = 1 << (index & 7);
  if ((bits[byte] & mask) !== 0) {
    return false;
  }
  bits[byte] |= mask;
  return true;
}

/** 格子所在区块是否已探索（只看区块，不看实时视野） */
export function isCellExplored(bits: Uint8Array, x: number, y: number): boolean {
  return isChunkExplored(bits, chunkIndexOf(x, y));
}

/** 已探索的区块数 */
export function exploredChunkCount(bits: Uint8Array): number {
  let count = 0;
  for (let index = 0; index < FOG_CHUNK_COUNT; index += 1) {
    if (isChunkExplored(bits, index)) {
      count += 1;
    }
  }
  return count;
}

/** 探索进度（百分比，保留 1 位小数）：已探索区块 ÷ 总区块 */
export function exploredPercentOf(bits: Uint8Array): number {
  return Math.round((exploredChunkCount(bits) / FOG_CHUNK_COUNT) * 1000) / 10;
}

/** 以 (x, y) 为中心、半径 r 的方块覆盖到的区块下标（裁到世界边界内） */
export function chunksCoveredBySquare(x: number, y: number, radius: number): number[] {
  const x0 = Math.max(0, Math.floor((x - radius) / FOG_CHUNK_SIZE));
  const x1 = Math.min(FOG_CHUNKS_PER_SIDE - 1, Math.floor((Math.min(WORLD_SIZE - 1, x + radius)) / FOG_CHUNK_SIZE));
  const y0 = Math.max(0, Math.floor((y - radius) / FOG_CHUNK_SIZE));
  const y1 = Math.min(FOG_CHUNKS_PER_SIDE - 1, Math.floor((Math.min(WORLD_SIZE - 1, y + radius)) / FOG_CHUNK_SIZE));
  const out: number[] = [];
  for (let cy = y0; cy <= y1; cy += 1) {
    for (let cx = x0; cx <= x1; cx += 1) {
      out.push(cy * FOG_CHUNKS_PER_SIDE + cx);
    }
  }
  return out;
}

/** 把一个方块视野带写入位图；返回本次新变为已探索的区块下标 */
export function markSquare(bits: Uint8Array, x: number, y: number, radius: number): number[] {
  const fresh: number[] = [];
  for (const index of chunksCoveredBySquare(x, y, radius)) {
    if (setChunkExplored(bits, index)) {
      fresh.push(index);
    }
  }
  return fresh;
}

/** 视野来源（格坐标 + 半径）：行军当前位置、城池、领地、盟友城格都归一成这种形状 */
export interface VisionSource {
  x: number;
  y: number;
  radius: number;
}

/** 格子是否落在某个视野来源的方块内（Chebyshev 距离） */
export function inVisionSource(source: VisionSource, x: number, y: number): boolean {
  return Math.max(Math.abs(x - source.x), Math.abs(y - source.y)) <= source.radius;
}

/** 格子是否被任一视野来源覆盖 */
export function inAnyVision(sources: readonly VisionSource[], x: number, y: number): boolean {
  for (const source of sources) {
    if (inVisionSource(source, x, y)) {
      return true;
    }
  }
  return false;
}

/**
 * 两点之间的路线格（Chebyshev 步进，每步两轴各动至多 1 格，首尾都含）。
 * 步数 = 切比雪夫距离，与行军时长口径一致；同一点返回单格。
 */
export function routeCells(fromX: number, fromY: number, toX: number, toY: number): Array<{ x: number; y: number }> {
  const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY));
  const cells: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = steps === 0 ? 0 : i / steps;
    cells.push({
      x: Math.round(fromX + (toX - fromX) * t),
      y: Math.round(fromY + (toY - fromY) * t),
    });
  }
  return cells;
}

/**
 * 去程走过的路线（从出发城起，按进度 fraction ∈ [0,1] 截止）。
 * 撤回时 fraction = 撤回时已走的比例；到达时为 1。
 */
export function walkedRoute(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  fraction: number,
): Array<{ x: number; y: number }> {
  const full = routeCells(fromX, fromY, toX, toY);
  const clamped = Math.min(1, Math.max(0, fraction));
  const upto = Math.floor(clamped * (full.length - 1));
  const cells = full.slice(0, upto + 1);
  // 当前所在的插值格也算走过（与视野带一致，防止整数截断少算一格）
  const here = {
    x: Math.round(fromX + (toX - fromX) * clamped),
    y: Math.round(fromY + (toY - fromY) * clamped),
  };
  const last = cells[cells.length - 1];
  if (!last || last.x !== here.x || last.y !== here.y) {
    cells.push(here);
  }
  return cells;
}

/**
 * 沿路线的视野带写入位图（路线上每格的半径 r 方块的并集）。返回本次新变为已探索的区块下标。
 * 只要视野方块碰到区块的任何一格，整块记为已探索（需求第二节）。
 */
export function markRoute(bits: Uint8Array, cells: ReadonlyArray<{ x: number; y: number }>, radius: number): number[] {
  const fresh: number[] = [];
  for (const cell of cells) {
    for (const index of markSquare(bits, cell.x, cell.y, radius)) {
      fresh.push(index);
    }
  }
  return fresh;
}

/** 视野带覆盖的全部格（用于 Worker 刷新路线视野带内的已探索地块） */
export function routeBandKeys(cells: ReadonlyArray<{ x: number; y: number }>, radius: number): Set<string> {
  const keys = new Set<string>();
  for (const cell of cells) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (x >= 0 && y >= 0 && x < WORLD_SIZE && y < WORLD_SIZE) {
          keys.add(`${x},${y}`);
        }
      }
    }
  }
  return keys;
}

/** 行军几何（与前端 MapMarch 同口径）：返程 from = 目标格、to = 出发城 */
export interface MarchGeometry {
  /** 出发城坐标 */
  homeX: number;
  homeY: number;
  /** 行军目标格 */
  targetX: number;
  targetY: number;
  /** 是否返程 */
  returning: boolean;
  /** 开始时刻（毫秒） */
  startMs: number;
  /** 结束时刻（毫秒；截击埋伏时为 ambush_at，与前端 marchEndMs 一致） */
  endMs: number;
}

/** 行军进度 ∈ [0,1]（与前端 marchProgress 一致） */
export function marchProgressAt(geometry: Pick<MarchGeometry, 'startMs' | 'endMs'>, nowMs: number): number {
  const { startMs, endMs } = geometry;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return nowMs >= endMs ? 1 : 0;
  }
  return Math.min(1, Math.max(0, (nowMs - startMs) / (endMs - startMs)));
}

/** 部队当前位置（浮点格坐标，与前端图标插值一致） */
export function marchPositionAt(geometry: MarchGeometry, nowMs: number): { x: number; y: number } {
  const from = geometry.returning ? { x: geometry.targetX, y: geometry.targetY } : { x: geometry.homeX, y: geometry.homeY };
  const to = geometry.returning ? { x: geometry.homeX, y: geometry.homeY } : { x: geometry.targetX, y: geometry.targetY };
  const t = marchProgressAt(geometry, nowMs);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

/**
 * 行军行的行程段输入（AISLG-230 抽成共用函数，不要写第二份）：去程 出发城 → 目标格，返程 目标格 → 出发城，
 * 撤回（fog_turn_*）从撤回瞬间的实际位置回出发城。时刻都是毫秒。
 * 截击「到了先埋伏」的口径与前端 marchEndMs 一致：endMs = ambush_at（部队走到埋伏点即停）。
 */
export interface MarchPathInput {
  /** 出发城坐标 */
  homeX: number;
  homeY: number;
  /** 行军目标格 */
  targetX: number;
  targetY: number;
  /** 是否返程（purpose = 'return'；撤回后的返程另有 turn） */
  returning: boolean;
  /** 开始行进时刻（毫秒，一般为 started_at） */
  startMs: number;
  /** 结束时刻（毫秒）：arrive_at；截击埋伏为 ambush_at */
  endMs: number;
  /** 撤回时的实际位置与时刻（fog_turn_x / fog_turn_y / fog_turn_at）；未撤回为 null */
  turn?: { x: number; y: number; atMs: number } | null;
}

/** 行程段：起点、终点与起止时刻（毫秒） */
export interface MarchLeg {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startMs: number;
  endMs: number;
}

/** 行军 → 本次行进的行程段（返程反向、撤回从撤回点回城） */
export function marchLegOf(path: MarchPathInput): MarchLeg {
  if (path.turn) {
    return { fromX: path.turn.x, fromY: path.turn.y, toX: path.homeX, toY: path.homeY, startMs: path.turn.atMs, endMs: path.endMs };
  }
  if (path.returning) {
    return { fromX: path.targetX, fromY: path.targetY, toX: path.homeX, toY: path.homeY, startMs: path.startMs, endMs: path.endMs };
  }
  return { fromX: path.homeX, fromY: path.homeY, toX: path.targetX, toY: path.targetY, startMs: path.startMs, endMs: path.endMs };
}

/**
 * 部队在 nowMs 的位置（浮点格坐标）与速度（格/秒，只表明方向与快慢，不含目标）。
 * 位置与视野、他人行军上图（GET_VISIBLE_MARCHES）共用这一份算法。
 */
export function marchMoveAt(path: MarchPathInput, nowMs: number): { x: number; y: number; vx: number; vy: number } {
  const leg = marchLegOf(path);
  const t = marchProgressAt(leg, nowMs);
  const spanMs = leg.endMs - leg.startMs;
  const perSecond = spanMs > 0 ? 1000 / spanMs : 0;
  return {
    x: leg.fromX + (leg.toX - leg.fromX) * t,
    y: leg.fromY + (leg.toY - leg.fromY) * t,
    vx: (leg.toX - leg.fromX) * perSecond,
    vy: (leg.toY - leg.fromY) * perSecond,
  };
}

/**
 * 行军在当前时刻提供的实时视野来源：部队当前位置（取整格）+ 半径。
 * 含斥候的编队用斥候半径（侦察科技决定），否则用行军半径。
 */
export function marchVisionSourceOf(path: MarchPathInput, nowMs: number, hasScout: boolean, scoutingLevel: number): VisionSource {
  const move = marchMoveAt(path, nowMs);
  return {
    x: Math.round(move.x),
    y: Math.round(move.y),
    radius: hasScout ? scoutVisionRadius(scoutingLevel) : FOG_VISION.march,
  };
}

/** 同上，按 MarchGeometry（前端同口径、无撤回）取实时视野来源 */
export function marchVisionSource(geometry: MarchGeometry, nowMs: number, hasScout: boolean, scoutingLevel: number): VisionSource {
  return marchVisionSourceOf(geometry, nowMs, hasScout, scoutingLevel);
}

/** 去程已走比例（写入已探索用）：(结束时刻 − startedAt) ÷ (arriveAt − startedAt)，夹在 0～1 */
export function walkedFractionOf(startMs: number, arriveMs: number, atMs: number): number {
  if (!Number.isFinite(startMs) || !Number.isFinite(arriveMs) || arriveMs <= startMs) {
    return 1;
  }
  return Math.min(1, Math.max(0, (atMs - startMs) / (arriveMs - startMs)));
}
