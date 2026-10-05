/** 选中目标的标题与要点（地图页右侧）：图标 + 名称 + 坐标 / 地形 / 类型，三个要点（距离 / 守军 / 上次侦察，
 *  上次侦察可点开侦察报告），再往下是该目标的补充说明（占领者 / 名城 / 黄巾营地 / NPC 库存 / 冷却，每条一行，悬停看全文）。
 */

import { useState } from 'react';
import { TROOP_KINDS, type CityView, type TileDetailView } from '../../api/protocol';
import { getCopy, useCopy } from '../../i18n/bundle';
import { tName } from '../../i18n/names';
import { useScoutReportModal } from '../../state/scoutReportModal';
import type { WorldSession } from '../../state/worldSession';
import { FamousCityNote } from '../FamousCityNote';
import { relativeAgo } from '../ScoutReportModal';
import { YellowTurbanCampNote } from '../YellowTurbanCampNote';
import { plunderCooldownLeft, protectionLeftText } from '../worldPanelText';

interface TargetHeaderProps {
  world: WorldSession;
  city: CityView;
  x: number;
  y: number;
  detail: TileDetailView | null;
  origin: { x: number; y: number } | null;
  now: number;
  /** 经过此格的移动目标种类（标题图标用）；无为 null */
  mover: 'caravan' | 'bandit' | null;
  /** 目标是本账号的城池（任意一座） */
  isOwnCity: boolean;
  onClose: () => void;
}

function iconOf(detail: TileDetailView, mover: 'caravan' | 'bandit' | null, isOwnCity: boolean): string {
  // 非组件辅助：体内取当前语言文案包（模块顶层严禁取）
  const { TERRAIN_LABEL, EXTRA_MAP } = getCopy();
  const glyphs = EXTRA_MAP.tileGlyphs;
  if (mover) {
    return mover === 'bandit' ? glyphs.bandit : glyphs.caravan;
  }
  if (detail.camp) {
    return detail.camp.tier === 'boss' ? glyphs.ytBoss : glyphs.ytCamp;
  }
  if (detail.kind === 'city') {
    return isOwnCity ? glyphs.city : glyphs.enemy;
  }
  if (detail.kind === 'npc_city') {
    return detail.famous ? glyphs.famous : 'N';
  }
  return (TERRAIN_LABEL[detail.terrain] ?? glyphs.wild).slice(0, 1);
}

export function TargetHeader({ world, city, x, y, detail, origin, now, mover, isOwnCity, onClose }: TargetHeaderProps) {
  const copy = useCopy();
  const { COPY, RESOURCE_LABEL, TERRAIN_LABEL, TILE_KIND_LABEL, TARGET_COPY, TECH_COPY } = copy;
  const { openScoutReport } = useScoutReportModal();
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'missing'>('idle');

  const openLatest = async () => {
    if (lookup === 'loading') {
      return;
    }
    setLookup('loading');
    try {
      const intel = await world.findScoutIntel(x, y);
      if (intel) {
        openScoutReport(intel);
        setLookup('idle');
      } else {
        setLookup('missing');
      }
    } catch {
      setLookup('missing');
    }
  };

  const name = !detail
    ? TARGET_COPY.detailTitle(x, y)
    : detail.camp
      ? detail.camp.label
      : detail.kind === 'city'
        ? (detail.owner ? tName(detail.owner.cityName) : TILE_KIND_LABEL.city)
        : detail.kind === 'npc_city'
          ? detail.famous
            ? tName(detail.famous.name)
            : `${TILE_KIND_LABEL.npc_city} Lv${detail.level}`
          : `${TERRAIN_LABEL[detail.terrain]} Lv${detail.level}`;
  const distance = origin ? Math.abs(x - origin.x) + Math.abs(y - origin.y) : null;
  const range = detail?.npc?.scoutDetail && detail.npc.scoutDetail !== 'exact' ? detail.npc.garrisonTotal : null;
  const garrison = !detail
    ? TARGET_COPY.unknown
    : range
      ? TECH_COPY.scout.garrisonRangeShort(range.min, range.max)
      : detail.kind === 'city' && detail.garrison <= 0
        ? TARGET_COPY.unknown
        : String(TROOP_KINDS.reduce((sum, kind) => sum + (detail.garrisonDetail?.[kind] ?? 0), 0) || detail.garrison);
  const cooldown = plunderCooldownLeft(detail?.plunderedAt ?? null, now, city.timeScale);
  /** 对方保护 / 免战状态（v38 AISLG-122）：任一截止未到即受保护，出征会被服务端拒绝 */
  const protectionLeft = protectionLeftText(detail?.protection ?? null, now);

  return (
    <div role="选中详情-头部" className="flex shrink-0 flex-col gap-1.5">
      <div role="选中详情-标题" className="flex items-center gap-2.5">
        <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[5px] border border-line bg-panel-2 font-semibold">
          {detail ? iconOf(detail, mover, isOwnCity) : '…'}
        </span>
        <span className="min-w-0 flex-1 leading-tight">
          <b className="block truncate text-[14.5px]" title={name}>
            {name}
          </b>
          <small className="block truncate text-[11.5px] text-dim">
            ({x},{y})
            {detail ? ` · ${TERRAIN_LABEL[detail.terrain]} · ${TILE_KIND_LABEL[detail.kind]}` : ''}
          </small>
        </span>
        <button
          type="button"
          role="选中详情-关闭按钮"
          aria-label={TARGET_COPY.close}
          title={TARGET_COPY.close}
          onClick={onClose}
          className="cursor-pointer rounded px-1.5 py-0.5 text-[14px] leading-none text-faint hover:text-fg"
        >
          ✕
        </button>
      </div>

      {detail === null ? (
        <p className="text-[12px] text-faint">{TARGET_COPY.loading}</p>
      ) : (
        <>
          <div role="选中详情-要点" className="grid grid-cols-3 gap-1">
            <Fact label={TARGET_COPY.factDistance} value={distance === null ? TARGET_COPY.unknown : TARGET_COPY.distance(distance)} />
            <Fact label={TARGET_COPY.factGarrison} value={garrison} />
            <div role="世界地图详情区-上次侦察" className="min-w-0 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-0.5">
              <span className="block text-[10.5px] text-faint">{TARGET_COPY.factScout}</span>
              {detail.scoutedAt ? (
                <button
                  type="button"
                  role="世界地图详情区-侦察报告按钮"
                  disabled={lookup === 'loading'}
                  title={lookup === 'missing' ? COPY.worldMap.lastScoutMissing : COPY.worldMap.lastScoutView}
                  onClick={() => void openLatest()}
                  className={`block max-w-full cursor-pointer truncate text-[12.5px] hover:text-accent disabled:opacity-40 ${lookup === 'missing' ? 'text-warn' : 'text-accent'}`}
                >
                  {relativeAgo(detail.scoutedAt, now)}
                </button>
              ) : (
                <b className="block truncate text-[12.5px] font-medium text-faint">{TARGET_COPY.notScouted}</b>
              )}
            </div>
          </div>
          <div role="世界地图详情区-地块摘要" className="flex flex-col gap-1 text-[11.5px]">
            {detail.kind !== 'npc_city' ? (
              <p className="truncate text-dim" title={detail.owner ? `${detail.owner.username} · ${tName(detail.owner.cityName)}` : undefined}>
                {detail.owner ? COPY.worldMap.ownerRow(`${detail.owner.username} · ${tName(detail.owner.cityName)}`) : COPY.worldMap.ownerNone}
              </p>
            ) : null}
            {detail.famous ? <FamousCityNote famous={detail.famous} /> : null}
            {detail.camp ? <YellowTurbanCampNote camp={detail.camp} now={now} /> : null}
            {detail.nativePower > 0 ? <p className="truncate text-warn">{COPY.worldMap.nativePowerRow(detail.nativePower)}</p> : null}
            {detail.wilderness ? (
              <p className="truncate text-dim">
                {COPY.worldMap.wildernessBonusRow(RESOURCE_LABEL[detail.wilderness.resource], detail.wilderness.bonusRate)}
                {detail.wilderness.gatherRate > 0 ? ` · ${COPY.worldMap.wildernessGatherRow(RESOURCE_LABEL[detail.wilderness.resource], detail.wilderness.gatherRate)}` : ''}
              </p>
            ) : null}
            {detail.kind === 'npc_city' ? (
              detail.npc ? (
                <p role="世界地图详情区-NPC情报" className="truncate text-dim" title={COPY.worldMap.npcStockRow}>
                  {COPY.worldMap.npcStockRow}{' '}
                  {(Object.keys(RESOURCE_LABEL) as Array<keyof typeof RESOURCE_LABEL>).map((key) => `${RESOURCE_LABEL[key]} ${detail.npc?.stock[key] ?? 0}`).join(' · ')}
                </p>
              ) : (
                <p className="truncate text-warn" title={COPY.worldMap.npcNotScouted}>
                  {COPY.worldMap.npcNotScouted}
                </p>
              )
            ) : null}
            {cooldown ? <p className="truncate text-warn">{COPY.worldMap.taskCooldownRow(cooldown)}</p> : null}
            {protectionLeft ? (
              <p role="世界地图详情区-保护状态" className="truncate text-warn" title={protectionLeft}>
                {protectionLeft}
              </p>
            ) : null}
            {detail?.durability != null ? (
              <p role="世界地图详情区-城防值" title={COPY.worldMap.durabilityHint} className="truncate text-dim">
                {COPY.worldMap.durabilityRow(detail.durability)}
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-0.5">
      <span className="block text-[10.5px] text-faint">{label}</span>
      <b className="block truncate font-mono text-[12.5px] font-medium tabular-nums" title={value}>
        {value}
      </b>
    </div>
  );
}
