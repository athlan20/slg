/** 世界地图舞台：容器内铺满的格子网格（格数按容器尺寸算：列 = round(宽 / 44)、行 = round(高 / 44)，容器变化时重算）、
 *  黄巾之乱浮卡（点开看详情弹窗）与可收起的图例。数据与动作来自 worldSession，这里只负责量尺寸与组装。
 *  移动目标标记（v28 AISLG-78）：当前格打徽章、尚未走过的路线格打小点，随本地时钟推进。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { movingIndexAt, type CityView, type MovingTargetView, type YellowTurbanState } from '../../api/protocol';
import { formatDurationText } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import type { MapLayers } from '../../state/NavContext';
import { viewportDims } from '../../state/mapZoom';
import { useNow } from '../../state/useNow';
import type { WorldSession } from '../../state/worldSession';
import { WorldMapGrid } from '../WorldMapGrid';
import { WorldMapLegend } from '../WorldMapLegend';

/** 每次平移的格数（键盘越过边缘 / 方向键按钮） */
export const PAN_STEP = 5;
/** 容器尺寸变化后等多久再重算窗口（毫秒）：拖拽改窗口大小时不连发请求 */
const RESIZE_DEBOUNCE_MS = 120;

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
}

export function WorldMapStage({ world, movingTargets, city, accountId, layers, yellowTurban, onOpenYellowTurban, onSelect }: WorldMapStageProps) {
  const copy = useCopy();
  const { COPY, RESOURCE_LABEL, MAPUI_COPY, YT_COPY } = copy;
  const boxRef = useRef<HTMLDivElement | null>(null);
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

  const now = useNow(movingTargets.length > 0);
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
            territoryClusters={layers.mine ? territoryClusters : undefined}
            movingMarks={movingMarks}
            onZoom={world.zoomTo}
            zoomSize={viewSize}
            layers={layers}
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
