/** 世界地图舞台：容器内铺满的格子网格（格数按容器尺寸算：列 = round(宽 / 44)、行 = round(高 / 44)，容器变化时重算）、
 *  黄巾之乱浮卡（点开看详情弹窗）与可收起的图例。数据与动作来自 worldSession，这里只负责量尺寸与组装。
 *  移动目标标记（v28 AISLG-78）：当前格打徽章、尚未走过的路线格打小点，随本地时钟推进。
 *  行军 / 领地色块边界 / 产出图层（AISLG-216）：数据在这里汇总成上图用的纯数据结构，
 *  覆盖层（WorldMapOverlay）与格子层（WorldMapGrid）各自取用；行军详情复用 AISLG-215 的弹窗。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  movingIndexAt,
  type AllianceMarkView,
  type CityRefView,
  type CityView,
  type MovingTargetView,
  type NpcAttackWarningPushData,
  type YellowTurbanState,
} from '../../api/protocol';
import { formatDurationText } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import { useNav, type MapLayers } from '../../state/NavContext';
import { viewportDims } from '../../state/mapZoom';
import { useNow } from '../../state/useNow';
import type { WorldSession } from '../../state/worldSession';
import { WorldMapGrid } from '../WorldMapGrid';
import { WorldMapLegend } from '../WorldMapLegend';
import type { MapOverviewSession } from '../../state/mapOverview';
import { MarchDetailModal } from '../army/MarchDetailModal';
import { WorldMinimap } from './WorldMinimap';
import { WorldExplorationReport } from './WorldExplorationReport';
import { mapMarchers } from './marchGeometry';
import { needsFogRefresh } from './fogPolling';
import { WorldMapOverlay } from './WorldMapOverlay';
import { territoryCells } from './territoryBorders';
import { showYieldNumber } from './YieldLayer';
import { yieldOfTile, type YieldInfo } from './yieldTable';

/** 每次平移的格数（键盘越过边缘 / 方向键按钮） */
export const PAN_STEP = 5;
/** 容器尺寸变化后等多久再重算窗口（毫秒）：拖拽改窗口大小时不连发请求 */
const RESIZE_DEBOUNCE_MS = 120;
/** 视野内他人部队的刷新间隔（AISLG-230，真实时间，不随 time_scale 变）：地图打开时每 5 秒拉一次当前窗口 */
const ENEMY_MARCH_POLL_MS = 5_000;

interface WorldMapStageProps {
  world: WorldSession;
  movingTargets: MovingTargetView[];
  city: CityView | null;
  accountId: string | null;
  layers: MapLayers;
  yellowTurban: YellowTurbanState | null;
  onOpenYellowTurban: () => void;
  /** 点地块：选中并在右侧显示详情与操作 */
  onSelect: (x: number, y: number) => void;
  /** 世界小地图（v58 AISLG-160）：全图城池点位与展开状态 */
  overview: MapOverviewSession;
  /** 本盟地图标记（AISLG-184 / F2）：服务端已过滤过期项，这里再按本地时钟去掉已到期的 */
  allianceMarks: AllianceMarkView[];
  /** 账号城池列表（AISLG-216）：行军的出发城坐标从这里取（x / y 为 null 的行军不上图） */
  cityList: CityRefView[];
  /** 未确认的敌人来袭预警（AISLG-216）：目标格红标与倒计时 */
  npcWarnings: NpcAttackWarningPushData[];
}

export function WorldMapStage({
  world, movingTargets, city, accountId, layers, yellowTurban, onOpenYellowTurban, onSelect, overview, allianceMarks, cityList, npcWarnings,
}: WorldMapStageProps) {
  const copy = useCopy();
  // 迷雾（AISLG-224 复核）：有在途行军且路线与窗口相交时，每 15 秒重拉一次窗口；否则不拉
  const fogWindow = world.window;
  const fogMarchers = useMemo(() => (fogWindow && city ? mapMarchers(city.marches, cityList, Date.now()) : []), [fogWindow, city, cityList]);
  const fogRouteHit = needsFogRefresh(fogMarchers, fogWindow);
  useEffect(() => {
    if (!fogRouteHit) {
      return undefined;
    }
    const timer = globalThis.setInterval(() => {
      void world.refresh();
    }, 15_000);
    return () => globalThis.clearInterval(timer);
  }, [fogRouteHit, world.refresh]);
  // 视野内他人部队（AISLG-230）：地图打开（本组件挂载）且拿到窗口后每 5 秒按当前窗口拉一次；
  // 换窗口（平移 / 缩放）立刻补一次；切页或关地图时本组件卸载，定时器随之停掉。
  const { fetchEnemyMarches } = world;
  const windowX = world.window?.x ?? null;
  const windowY = world.window?.y ?? null;
  const windowW = world.window?.w ?? null;
  const windowH = world.window?.h ?? null;
  useEffect(() => {
    if (windowX === null || windowY === null) {
      return undefined;
    }
    void fetchEnemyMarches();
    const timer = globalThis.setInterval(() => {
      void fetchEnemyMarches();
    }, ENEMY_MARCH_POLL_MS);
    return () => globalThis.clearInterval(timer);
  }, [fetchEnemyMarches, windowX, windowY, windowW, windowH]);
  const { COPY, RESOURCE_LABEL, MAPUI_COPY, YT_COPY } = copy;
  const { go } = useNav();
  const boxRef = useRef<HTMLDivElement | null>(null);
  /** 地图上行军图标的「详情」目标（复用 AISLG-215 的行军详情弹窗） */
  const [detailId, setDetailId] = useState<string | null>(null);
  // 图例默认展开，手机等窄屏默认收起（不遮地图）
  const [legendOpen, setLegendOpen] = useState(() => window.innerWidth >= 1024);
  const { resizeWindow, viewSize } = world;
  const win = world.window;

  // 容器尺寸 / 缩放档位 → 窗口格数（docs 第 6 节）
  useEffect(() => {
    const el = boxRef.current;
    if (!el) {
      return undefined;
    }
    let timer = 0;
    const apply = () => {
      const { clientWidth, clientHeight } = el;
      if (clientWidth > 0 && clientHeight > 0) {
        const dims = viewportDims(clientWidth, clientHeight, viewSize);
        resizeWindow(dims.w, dims.h);
      }
    };
    apply();
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(apply, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(el);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [resizeWindow, viewSize, win === null]);

  // 每秒推进的时钟（移动目标 / 联盟标记）；行军与来袭倒计时的时钟在 WorldMapOverlay 里，
  // 免得每秒把整张地图的格子重渲一遍
  const now = useNow(movingTargets.length > 0 || allianceMarks.length > 0);
  const markMap = useMemo(() => {
    const map = new Map<string, AllianceMarkView>();
    for (const mark of allianceMarks) {
      if (Date.parse(mark.expiresAt) > now) {
        map.set(`${mark.x},${mark.y}`, mark);
      }
    }
    return map;
  }, [allianceMarks, now]);
  const movingMarks = useMemo(() => {
    const marks = new Map<string, { kind: MovingTargetView['kind']; label: string; level: number; current: boolean }>();
    if (!layers.moving) {
      return marks;
    }
    for (const target of movingTargets) {
      const current = movingIndexAt(target, now);
      if (current === null) {
        continue;
      }
      target.route.forEach((cell, index) => {
        const key = `${cell.x},${cell.y}`;
        if (index === current) {
          marks.set(key, { kind: target.kind, label: target.label, level: target.level, current: true });
        } else if (index > current && !marks.get(key)?.current) {
          marks.set(key, { kind: target.kind, label: target.label, level: target.level, current: false });
        }
      });
    }
    return marks;
  }, [movingTargets, now, layers.moving]);

  // 连片领地（v23 AISLG-59）：有连片加成的本方野地 → 地图描边 + 悬浮提示数据
  const territoryClusters = useMemo(() => {
    const map = new Map<string, { size: number; percent: number; resourceLabel: string }>();
    for (const tile of city?.territory ?? []) {
      if (tile.clusterBonusPercent > 0) {
        map.set(`${tile.x},${tile.y}`, { size: tile.clusterSize, percent: tile.clusterBonusPercent, resourceLabel: RESOURCE_LABEL[tile.resource] });
      }
    }
    return map;
  }, [city?.territory, RESOURCE_LABEL]);

  // 领地色块与边界（AISLG-216）：按占领者账号分片，自己的连片加成片外圈改金色
  const territoryView = useMemo(
    () => (layers.territory && win ? territoryCells(win.tiles, accountId, new Set(territoryClusters.keys())) : undefined),
    [layers.territory, win, accountId, territoryClusters],
  );
  // 产出图层（AISLG-216）：只有野地有产量；自己的地取领地数据的占领加成 + 驻军采集
  const yieldMap = useMemo(() => {
    if (!layers.yield || !win) {
      return undefined;
    }
    const own = new Map((city?.territory ?? []).map((tile) => [`${tile.x},${tile.y}`, tile]));
    const map = new Map<string, YieldInfo>();
    for (const tile of win.tiles) {
      const info = yieldOfTile(tile, own.get(`${tile.x},${tile.y}`), accountId);
      if (info) {
        map.set(`${tile.x},${tile.y}`, info);
      }
    }
    return map;
  }, [layers.yield, win, city?.territory, accountId]);

  const event = yellowTurban?.event ?? null;
  const ytActive = layers.yt && event !== null && event.status === 'active';
  const ytNow = useNow(ytActive);

  return (
    <div ref={boxRef} role="世界地图视图-舞台" className="relative min-h-0 flex-1 p-1.5">
      {win ? (
        <div role="世界地图视图-地图" className={`h-full transition-opacity ${world.loading ? 'opacity-70' : ''}`}>
          <WorldMapGrid
            win={win}
            selected={world.selected}
            accountId={accountId}
            onSelect={onSelect}
            onPan={world.pan}
            onPanTo={world.panTo}
            panStep={PAN_STEP}
            territoryClusters={territoryClusters}
            movingMarks={movingMarks}
            onZoom={world.zoomTo}
            zoomSize={viewSize}
            layers={layers}
            marks={markMap}
            territoryCells={territoryView}
            yieldMap={yieldMap}
            showYieldNumber={showYieldNumber(win)}
            overlay={
              <WorldMapOverlay
                win={win}
                layers={layers}
                territory={territoryView}
                marches={city?.marches ?? []}
                cities={cityList}
                warnings={npcWarnings}
                enemyMarches={world.enemyMarches}
                onOpenMarch={setDetailId}
                onCenter={world.centerOn}
                onOpenMarchList={() => go('army')}
              />
            }
          />
        </div>
      ) : (
        <p role="世界地图视图-空态" className="grid h-full place-items-center text-[12px] text-faint">
          {world.loading ? COPY.worldMap.loading : COPY.worldMap.loadFailed}
        </p>
      )}

      {ytActive && event ? (
        <button
          type="button"
          role="世界地图视图-黄巾浮卡"
          title={YT_COPY.panel.title}
          onClick={onOpenYellowTurban}
          className="absolute left-3.5 top-3.5 flex w-[220px] max-w-[60%] cursor-pointer flex-col gap-1 rounded-md border border-warn/50 bg-panel/90 px-2.5 py-1.5 text-left text-[11.5px]"
        >
          <b className="truncate text-warn">{YT_COPY.panel.title}</b>
          <span className="block h-[3px] overflow-hidden rounded bg-line">
            <i
              className="block h-full bg-warn"
              style={{ width: `${event.totalCamps > 0 ? Math.min(100, Math.round((event.clearedCamps / event.totalCamps) * 100)) : 0}%` }}
            />
          </span>
          <span className="truncate text-dim">
            {YT_COPY.panel.progress(event.clearedCamps, event.totalCamps)} ·{' '}
            {YT_COPY.panel.endsIn(formatDurationText(Math.max(0, Math.ceil((Date.parse(event.endsAt) - ytNow) / 1000))))}
          </span>
        </button>
      ) : null}

      {win ? <WorldMinimap overview={overview} win={win} onPanTo={world.panTo} /> : null}

      {/* 探索简报（AISLG-224）：去程新探索了区块时弹出 */}
      <WorldExplorationReport onCenter={world.centerOn} />


      {detailId ? (
        <MarchDetailModal march={city?.marches.find((march) => march.id === detailId) ?? null} onClose={() => setDetailId(null)} />
      ) : null}

      {win ? (
        <div className="pointer-events-none absolute bottom-3 left-3.5 flex max-w-[calc(100%-28px)] flex-col items-start gap-1">
          {legendOpen ? (
            <div className="rounded-md border border-line-soft bg-panel/90 px-2 py-1.5">
              <WorldMapLegend />
            </div>
          ) : null}
          <button
            type="button"
            role="世界地图视图-图例开关"
            aria-pressed={legendOpen}
            title={COPY.worldMap.keyHint}
            onClick={() => setLegendOpen((open) => !open)}
            className="pointer-events-auto cursor-pointer rounded border border-line-soft bg-panel/90 px-1.5 py-0.5 text-[10.5px] text-dim hover:text-fg"
          >
            {MAPUI_COPY.legendToggle}
          </button>
        </div>
      ) : null}
    </div>
  );
}
