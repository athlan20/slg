/** 世界地图视野（参考 prototypes/city-dark.html「地图视野」模块）：撑满容器的地形色块网格 +
 *  城池形状标记 + 悬浮提示。野地 = 地形图标 + 右下角等级（越高越醒目）；
 *  城池按形状区分敌我，名字写在格内底部（窄屏隐藏，看悬浮提示），不再浮出遮挡相邻格。
 *  键盘：方向键在格间移动焦点，越过视野边缘自动平移；Enter / 空格选中。
 *  拖曳（v23 AISLG-64）：按住地图拖动即平移视口——每拖过一格请求相邻窗口，剩余亚格
 *  位移用 transform 跟手；位移小于阈值视为点击选中，边界由服务端钳制，松手停在原地不回弹。
 *  只负责渲染与悬浮 / 选中态；地图数据与动作在 worldSession，组装在 WorldMapView。
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { TileView, WorldMapResponseData } from '../api/protocol';
import { useMapZoomGestures, type ZoomHandler } from '../state/useMapZoomGestures';
import { zoomStep } from '../state/mapZoom';
import { WorldTileBadges } from './WorldTileBadges';
import { CityMark, TERRAIN_CLASS, TerrainIcon, levelTone } from './worldMapMarks';
import { NPC_TIER_CLASS, NPC_TIER_LABEL, WorldMapTooltip, citySide, tileAria, type TileTip } from './worldMapTip';

interface WorldMapGridProps {
  win: WorldMapResponseData;
  selected: { x: number; y: number } | null;
  /** 当前账号 id：区分本方城池 / 本方占领 */
  accountId: string | null;
  onSelect: (x: number, y: number) => void;
  /** 键盘越过视野边缘时平移（格数，与方向键按钮同步长） */
  onPan: (dx: number, dy: number) => void;
  /** 拖曳平移到指定窗口原点（v23 AISLG-64；越界由服务端钳制） */
  onPanTo: (x: number, y: number) => void;
  panStep: number;
  /** 连片领地（v23 AISLG-59）：键 "x,y" → 连片信息（本账号有加成的野地才有值），
   *  用于地图统一描边与悬浮提示 */
  territoryClusters?: Map<string, { size: number; percent: number; resourceLabel: string }>;
  /** 移动目标标记（v28 AISLG-78）：键 "x,y" → 目标种类；current=true 为当前所在格（徽章），否则为尚未走过的路线格（小点） */
  movingMarks?: Map<string, { kind: 'caravan' | 'bandit'; label: string; level: number; current: boolean }>;
  /** 缩放（AISLG-103）：滚轮 / 捏合 / 键盘触发；size = 目标缩放档位，focus = 视口内比例位置（缩放中心） */
  onZoom: ZoomHandler;
  /** 当前缩放档位（world.viewSize）：滚轮 / 键盘缩放按它步进 */
  zoomSize: number;
  /** 图层开关：黄巾营地徽章 / 我的领地描边（流寇·商队由调用方控制 movingMarks） */
  layers?: { yt: boolean; mine: boolean };
}

/** 拖曳会话（v23 AISLG-64；AISLG-102 重写为「理想原点」模型）：pointerdown 建立、move 换算理想原点、up 结束 */
interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  /** 拖曳起点的窗口原点（小数；上一次吸附尚未到位时取其吸附目标，保证起手不跳） */
  baseX: number;
  baseY: number;
  /** 已请求过的整格原点（相同不重复发请求） */
  requestedX: number;
  requestedY: number;
  /** 最近一次换算的理想原点（松手吸附用） */
  idealX: number;
  idealY: number;
  /** 位移已越过点击阈值（true = 本次松手不触发选中） */
  moved: boolean;
}

/** 网格列间距（像素，对应 gap-[3px]）：单格步长 = (网格宽 + 间距) ÷ 列数 */
const TILE_GAP_PX = 3;
/** 野地满级（金色常显的等级数字） */
const MAX_TILE_LEVEL = 10;
/** 点击与拖曳的分界位移（像素）：小于它视为点击选中，达到即判定为拖曳 */
const DRAG_THRESHOLD_PX = 6;

const ARROW_DELTA: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

export function WorldMapGrid({ win, selected, accountId, onSelect, onPan, onPanTo, panStep, territoryClusters, movingMarks, onZoom, zoomSize, layers }: WorldMapGridProps) {
  const showYt = layers?.yt ?? true;
  const showMine = layers?.mine ?? true;
  const [tip, setTip] = useState<TileTip | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // 滚轮 / 双指捏合缩放（AISLG-103）；捏合期间拖曳让路
  const { pinchingRef } = useMapZoomGestures(viewportRef, zoomSize, onZoom);
  /** 键盘越界平移后，新窗口到达时要接回焦点的坐标 */
  const pendingFocus = useRef<{ x: number; y: number } | null>(null);
  /** 拖曳会话（v23 AISLG-64）：非 null 表示按住拖动中 */
  const dragRef = useRef<DragSession | null>(null);
  /** 最近一次按住是否构成拖曳（true 时吞掉随后的 click，避免拖完误选地块） */
  const lastDragMovedRef = useRef(false);
  /**
   * 拖曳锚点（AISLG-102）：手指当前对应的「理想窗口原点」（世界格坐标，小数）。网格的 transform 由
   * 「已渲染窗口原点 − 锚点」× 单格步长算出——换窗请求回来、渲染原点变化时位移自动抵消，
   * 视图不再因「整格换窗 / 位移归零」来回跳；到位（渲染原点 = 锚点）后清空。
   */
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  /** 松手后的短暂吸附动画开关（拖曳中无动画保证跟手） */
  const [dragSettling, setDragSettling] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);

  /** 单格步长（像素）：网格内容宽 / 高含列行间距 ÷ 列 / 行数（格子随容器铺满，横纵步长可略有差异） */
  const tileStep = (): { w: number; h: number } => {
    const el = gridRef.current;
    if (!el || win.w <= 0 || win.h <= 0) {
      return { w: 48, h: 48 };
    }
    return { w: (el.clientWidth + TILE_GAP_PX) / win.w, h: (el.clientHeight + TILE_GAP_PX) / win.h };
  };

  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 主键 / 触屏 / 手柄指针才开始；右键等不动
    if (e.button !== 0 || pinchingRef.current) {
      return;
    }
    const baseX = anchor?.x ?? win.x;
    const baseY = anchor?.y ?? win.y;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX,
      baseY,
      requestedX: Math.round(baseX),
      requestedY: Math.round(baseY),
      idealX: baseX,
      idealY: baseY,
      moved: false,
    };
    lastDragMovedRef.current = false;
    setDragSettling(false);
  };

  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) {
      return;
    }
    if (pinchingRef.current) {
      // 第二根手指落下 = 捏合：放弃进行中的拖曳（已换的窗口保留），松手后才能再拖
      dragRef.current = null;
      setAnchor(null);
      return;
    }
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      return;
    }
    if (!drag.moved) {
      drag.moved = true;
      setTip(null);
      // 捕获要等真正开始拖曳再做：pointerdown 立即 capture 会把 click 的
      // 派发目标重定向到容器，格子按钮收不到 click（点击选中失效）
      e.currentTarget.setPointerCapture(drag.pointerId);
    }
    // 理想原点 = 起点原点 − 位移 ÷ 步长（向右拖 = 内容右移 = 窗口原点左移，AISLG-84），按世界边界钳制；
    // 画面位移始终 = (已渲染原点 − 理想原点) × 步长，整格换窗只是把位移从 transform 换给原点，视觉连续
    const step = tileStep();
    const maxX = Math.max(0, win.size - win.w);
    const maxY = Math.max(0, win.size - win.h);
    drag.idealX = Math.min(Math.max(0, drag.baseX - dx / step.w), maxX);
    drag.idealY = Math.min(Math.max(0, drag.baseY - dy / step.h), maxY);
    setAnchor({ x: drag.idealX, y: drag.idealY });
    const nx = Math.round(drag.idealX);
    const ny = Math.round(drag.idealY);
    if (nx !== drag.requestedX || ny !== drag.requestedY) {
      drag.requestedX = nx;
      drag.requestedY = ny;
      onPanTo(nx, ny);
    }
  };

  const onDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) {
      return;
    }
    dragRef.current = null;
    lastDragMovedRef.current = drag.moved;
    if (!drag.moved) {
      return;
    }
    // 松手吸附到最近的整格：锚点滑到整格原点（短动画），窗口到位后清空
    const fx = Math.round(drag.idealX);
    const fy = Math.round(drag.idealY);
    if (fx !== drag.requestedX || fy !== drag.requestedY) {
      onPanTo(fx, fy);
    }
    setDragSettling(true);
    setAnchor({ x: fx, y: fy });
  };

  // 锚点到位（渲染窗口原点 = 锚点）即清空；兜底：松手后 1.5 秒仍未到位（请求失败 / 被服务端钳到别处）也清空
  useEffect(() => {
    if (!anchor || dragRef.current) {
      return undefined;
    }
    if (anchor.x === win.x && anchor.y === win.y) {
      setAnchor(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setAnchor(null), 1500);
    return () => window.clearTimeout(timer);
  }, [anchor, win]);

  const focusTile = (x: number, y: number): boolean => {
    const btn = viewportRef.current?.querySelector<HTMLButtonElement>(`button[data-x="${x}"][data-y="${y}"]`);
    btn?.focus();
    return Boolean(btn);
  };

  // 窗口重拉（平移 / 推送替换）后旧定位失效：收起提示，必要时把键盘焦点接到目标格
  useEffect(() => {
    setTip(null);
    if (pendingFocus.current && focusTile(pendingFocus.current.x, pendingFocus.current.y)) {
      pendingFocus.current = null;
    }
  }, [win]);

  const showTip = (tile: TileView, isOwn: boolean, el: HTMLElement) => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const gap = 6;
    const rightHalf = el.offsetLeft + el.offsetWidth / 2 > viewport.clientWidth / 2;
    const lowerHalf = el.offsetTop + el.offsetHeight / 2 > viewport.clientHeight / 2;
    setTip({
      tile,
      isOwn,
      style: {
        ...(rightHalf
          ? { right: viewport.clientWidth - el.offsetLeft + gap }
          : { left: el.offsetLeft + el.offsetWidth + gap }),
        ...(lowerHalf
          ? { bottom: viewport.clientHeight - el.offsetTop - el.offsetHeight }
          : { top: el.offsetTop }),
      },
    });
  };

  const hideTip = () => {
    setTip(null);
  };

  const onTileKey = (e: KeyboardEvent<HTMLButtonElement>, tile: TileView) => {
    // 键盘缩放（AISLG-103）：+ / = 放大、- / _ 缩小，缩放中心取当前聚焦的格
    if (['+', '=', '-', '_'].includes(e.key)) {
      e.preventDefault();
      const zoomIn = e.key === '+' || e.key === '=';
      onZoom(zoomSize + (zoomIn ? -1 : 1) * zoomStep(zoomSize), {
        fx: (tile.x - win.x + 0.5) / win.w,
        fy: (tile.y - win.y + 0.5) / win.h,
      });
      return;
    }
    const delta = ARROW_DELTA[e.key];
    if (!delta) {
      return;
    }
    e.preventDefault();
    const nx = tile.x + delta[0];
    const ny = tile.y + delta[1];
    if (nx < 0 || ny < 0 || nx >= win.size || ny >= win.size) {
      return;
    }
    if (!focusTile(nx, ny)) {
      pendingFocus.current = { x: nx, y: ny };
      onPan(delta[0] * panStep, delta[1] * panStep);
    }
  };

  const tileAt = new Map(win.tiles.map((tile) => [`${tile.x},${tile.y}`, tile]));
  const cols = Array.from({ length: win.w }, (_, i) => win.x + i);
  const rows = Array.from({ length: win.h }, (_, i) => win.y + i);
  // 漫游 tabindex：整张图只占一个 Tab 位（选中格 > 本方城池 > 左上角）
  const ownCity = win.tiles.find((t) => t.kind === 'city' && t.owner?.accountId === accountId);
  const selectedInView = selected ? tileAt.get(`${selected.x},${selected.y}`) : undefined;
  const tabTarget = selectedInView ?? ownCity ?? win.tiles[0];

  return (
    <div
      ref={viewportRef}
      role="世界地图视野"
      className="@container relative h-full w-full touch-none select-none overflow-hidden rounded-md border border-line-soft bg-panel-2 p-1"
      onMouseLeave={hideTip}
      onPointerDown={onDragStart}
      onPointerMove={onDragMove}
      onPointerUp={onDragEnd}
      onPointerCancel={onDragEnd}
    >
      <div
        ref={gridRef}
        role="世界地图视野-网格"
        className="grid h-full gap-[3px] will-change-transform"
        style={{
          gridTemplateColumns: `repeat(${win.w}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${win.h}, minmax(0, 1fr))`,
          transform: anchor
            ? `translate(${(win.x - anchor.x) * tileStep().w}px, ${(win.y - anchor.y) * tileStep().h}px)`
            : undefined,
          transition: dragSettling ? 'transform 120ms ease-out' : 'none',
        }}
      >
        {rows.flatMap((y) =>
          cols.map((x) => {
            const tile = tileAt.get(`${x},${y}`);
            if (!tile) {
              return <span key={`${x}-${y}`} role="世界地图视野-空格" className="rounded bg-panel" />;
            }
            const isOwn = tile.owner !== null && tile.owner.accountId === accountId;
            const isSelected = selected !== null && selected.x === x && selected.y === y;
            const isCity = tile.kind !== 'wilderness';
            const occupied = tile.kind === 'wilderness' && tile.owner !== null;
            // 连片领地（v23 AISLG-59）：本账号有连片加成的野地统一描金边
            const cluster = showMine ? territoryClusters?.get(`${x},${y}`) : undefined;
            // 占领 / 本方城池：内描边 + 角旗；本方强调色、他方警示色（「我的领地」图层关闭时不描本方）
            const ownership = cluster
              ? 'ring-2 ring-inset ring-gold'
              : (occupied || (tile.kind === 'city' && isOwn)) && (showMine || !isOwn)
                ? isOwn
                  ? 'ring-2 ring-inset ring-accent/80'
                  : 'ring-2 ring-inset ring-warn/70'
                : '';
            return (
              <button
                key={`${x}-${y}`}
                type="button"
                role="世界地图视野-地块"
                data-x={x}
                data-y={y}
                tabIndex={tile === tabTarget ? 0 : -1}
                aria-label={tileAria(tile, isOwn)}
                aria-pressed={isSelected}
                onClick={() => {
                  // 拖曳结束后的 click 不触发选中（点击与拖曳按位移阈值区分）
                  if (lastDragMovedRef.current) {
                    lastDragMovedRef.current = false;
                    return;
                  }
                  onSelect(x, y);
                }}
                onKeyDown={(e) => onTileKey(e, tile)}
                onMouseEnter={(e) => showTip(tile, isOwn, e.currentTarget)}
                onFocus={(e) => showTip(tile, isOwn, e.currentTarget)}
                onBlur={hideTip}
                className={`group relative grid cursor-pointer place-items-center overflow-hidden rounded transition-[filter,box-shadow] duration-100 hover:brightness-125 focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 ${
                  TERRAIN_CLASS[tile.terrain] ?? TERRAIN_CLASS.plain
                } ${ownership} ${
                  // 已掠空的 NPC 城：整格变暗（v23 AISLG-55）
                  tile.kind === 'npc_city' && tile.npcStockTier === 'empty' ? 'opacity-45 saturate-50' : ''
                } ${
                  isSelected ? 'z-[1] shadow-[0_0_0_2px_var(--accent),0_0_14px_var(--accent-dim)]' : ''
                }`}
              >
                {isCity ? (
                  <>
                    <CityMark side={citySide(tile, isOwn)} className="w-[42%] text-[clamp(9px,2.2cqw,18px)]" />
                    {tile.kind === 'npc_city' && tile.npcStockTier ? (
                      <span
                        role="世界地图视野-NPC库存档位"
                        className={`absolute left-[6%] top-[4%] font-mono text-[clamp(8px,1.25cqw,12px)] leading-none ${NPC_TIER_CLASS[tile.npcStockTier]}`}
                        title={NPC_TIER_LABEL[tile.npcStockTier]}
                      >
                        {tile.npcStockTier === 'rich' ? '◆' : tile.npcStockTier === 'normal' ? '◇' : tile.npcStockTier === 'low' ? '·' : '×'}
                      </span>
                    ) : null}
                    <span
                      role="世界地图视野-城名"
                      className={`absolute inset-x-0.5 bottom-[4%] truncate @max-lg:hidden text-center text-[clamp(8px,1.25cqw,12px)] leading-tight ${
                        tile.kind === 'npc_city' ? 'text-gold' : isOwn ? 'font-semibold text-accent' : 'text-warn'
                      }`}
                    >
                      {tile.kind === 'npc_city' ? (tile.famous?.name ?? `NPC Lv${tile.level}`) : (tile.owner?.cityName ?? '城池')}
                    </span>
                  </>
                ) : (
                  <>
                    <TerrainIcon terrain={tile.terrain} className="w-[40%]" />
                    {/* 等级数字：默认隐藏，悬停 / 选中显示；满级（10 级）金色常显（docs 第 6 节） */}
                    <span
                      role="世界地图视野-等级"
                      className={`absolute bottom-[4%] right-[6%] font-mono text-[clamp(8px,1.25cqw,12px)] leading-none tabular-nums transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 ${
                        tile.level >= MAX_TILE_LEVEL ? 'font-semibold text-gold' : `${levelTone(tile.level)} ${isSelected ? '' : 'opacity-0'}`
                      }`}
                    >
                      {tile.level}
                    </span>
                  </>
                )}
                <WorldTileBadges tile={tile} mark={movingMarks?.get(`${x},${y}`)} hideCamp={!showYt} />
                {occupied ? (
                  <span
                    role="世界地图视野-占领角旗"
                    aria-hidden="true"
                    className={`absolute left-0 top-0 h-[22%] w-[22%] [clip-path:polygon(0_0,100%_0,0_100%)] ${
                      isOwn ? 'bg-accent' : 'bg-warn'
                    }`}
                  />
                ) : null}
              </button>
            );
          }),
        )}
      </div>

      <WorldMapTooltip tip={tip} clusters={territoryClusters} />
    </div>
  );
}
