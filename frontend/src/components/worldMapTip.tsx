/** 世界地图悬浮提示与地块文案（从 WorldMapGrid 拆出以控制单文件行数）：
 *  NPC 库存档位色调、城池归属形状、地块标题 / 归属说明 / 读屏文案，以及悬浮提示卡本身。
 */

import { COPY, TERRAIN_LABEL } from '../copy';
import { CITY_COPY } from '../copy-cities';
import { YT_COPY } from '../copy-yt';
import type { NpcStockTier, TileView } from '../api/protocol';
import type { CitySide } from './worldMapMarks';

/** NPC 城库存档位的中文与色调（v23 AISLG-55）：已空变暗、见底警示、丰厚金色 */
export const NPC_TIER_LABEL: Record<NpcStockTier, string> = {
  rich: COPY.worldMap.npcTierRich,
  normal: COPY.worldMap.npcTierNormal,
  low: COPY.worldMap.npcTierLow,
  empty: COPY.worldMap.npcTierEmpty,
};

export const NPC_TIER_CLASS: Record<NpcStockTier, string> = {
  rich: 'text-gold',
  normal: 'text-dim',
  low: 'text-warn',
  empty: 'text-faint',
};

/** 悬浮提示：内容地块 + 相对视野容器的定位（左右 / 上下按地块所在半区翻转，不压住地块本身） */
export interface TileTip {
  tile: TileView;
  isOwn: boolean;
  style: { left?: number; right?: number; top?: number; bottom?: number };
}

export function citySide(tile: TileView, isOwn: boolean): CitySide {
  if (tile.kind === 'npc_city') {
    return tile.famous ? 'famous' : 'npc';
  }
  return isOwn ? 'own' : 'enemy';
}

/** 地块标题：悬浮提示与读屏共用 */
export function tileTitle(tile: TileView, isOwn: boolean): string {
  if (tile.kind === 'city') {
    return `${tile.owner?.cityName ?? '城池'} · ${isOwn ? '本方城池' : '玩家城池'}`;
  }
  if (tile.kind === 'npc_city') {
    return tile.famous ? `${CITY_COPY.famous.title(tile.famous.name)} Lv${tile.level}` : `NPC 城池 Lv${tile.level}`;
  }
  return `${TERRAIN_LABEL[tile.terrain] ?? tile.terrain} · 野地 Lv${tile.level}`;
}

/** 归属说明：城池写城主，野地写占领者 */
export function tileOwnerText(tile: TileView, isOwn: boolean): string {
  if (!tile.owner) {
    return tile.kind === 'npc_city' ? 'NPC 守城' : COPY.worldMap.ownerNone;
  }
  if (isOwn) {
    return tile.kind === 'city' ? '你的城池' : '本方占领';
  }
  return tile.kind === 'city' ? `城主：${tile.owner.username}` : COPY.worldMap.ownerRow(tile.owner.username);
}

export function tileAria(tile: TileView, isOwn: boolean): string {
  return `(${tile.x},${tile.y}) ${tileTitle(tile, isOwn)}，${tileOwnerText(tile, isOwn)}`;
}

interface WorldMapTooltipProps {
  tip: TileTip | null;
  clusters?: Map<string, { size: number; percent: number; resourceLabel: string }>;
}

/** 悬浮提示：名称 / 坐标 / 归属 / 驻军 + 操作提示 */
export function WorldMapTooltip({ tip, clusters }: WorldMapTooltipProps) {
  const cluster = tip ? clusters?.get(`${tip.tile.x},${tip.tile.y}`) : undefined;
  return (
    <div
      role="世界地图视野-悬浮提示"
      hidden={!tip}
      className="pointer-events-none absolute z-[5] min-w-[150px] whitespace-nowrap rounded-md border border-accent-dim bg-panel/95 px-2.5 py-1.5 text-[12px] leading-[1.6] text-fg shadow-lg backdrop-blur-sm"
      style={tip?.style}
    >
      {tip ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <b className="font-semibold">{tileTitle(tip.tile, tip.isOwn)}</b>
            <em className="font-mono text-[11px] not-italic text-faint">
              ({tip.tile.x},{tip.tile.y})
            </em>
          </div>
          <div className={tip.isOwn ? 'text-accent' : tip.tile.owner ? 'text-warn' : 'text-dim'}>{tileOwnerText(tip.tile, tip.isOwn)}</div>
          {tip.tile.famous ? (
            <div role="世界地图视野-名城提示" className="text-gold">
              <div>{tip.tile.famous.stage === 'outer' ? CITY_COPY.famous.stageOuter : CITY_COPY.famous.stageKeeper}</div>
              <div>{CITY_COPY.famous.bonus(tip.tile.famous.bonusPercent)}</div>
            </div>
          ) : null}
          {tip.tile.camp ? (
            <div role="世界地图视野-黄巾营地提示" className="text-warn">
              <div>{tip.tile.camp.label}</div>
              <div>{YT_COPY.tile.strength(tip.tile.camp.garrisonTotal.min, tip.tile.camp.garrisonTotal.max)}</div>
            </div>
          ) : null}
          {tip.tile.kind === 'npc_city' && tip.tile.npcStockTier ? (
            <div className={NPC_TIER_CLASS[tip.tile.npcStockTier]}>
              {tip.tile.npcStockTier === 'empty'
                ? COPY.worldMap.npcTierEmptyHint
                : COPY.worldMap.npcTierHint(NPC_TIER_LABEL[tip.tile.npcStockTier])}
            </div>
          ) : null}
          {cluster ? <div className="text-gold">{COPY.worldMap.clusterTip(cluster.resourceLabel, cluster.size, cluster.percent)}</div> : null}
          {tip.tile.garrison > 0 ? <div className="text-dim">{COPY.worldMap.garrisonRow(tip.tile.garrison)}</div> : null}
          <div className="mt-0.5 border-t border-line-soft pt-0.5 text-[11px] text-faint">{COPY.worldMap.tipAction}</div>
        </>
      ) : null}
    </div>
  );
}
