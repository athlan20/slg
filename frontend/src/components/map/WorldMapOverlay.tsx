/** 世界地图覆盖层（AISLG-216）：挂在网格的同一个相对容器里，按网格实测像素尺寸换算坐标，
 *  自上而下分层——领地边界（SVG）、行军路线（SVG）、行军图标与视野外箭头（HTML）、
 *  他人部队（AISLG-230，SVG 短箭头 + HTML 图标，跟「行军」开关走）、敌人来袭标记。
 *  网格拖曳时随网格一起位移（由 WorldMapGrid 的外层 transform 负责），整层默认不挡点击。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CityRefView, MarchView, NpcAttackWarningPushData } from '../../api/protocol';
import type { MapLayers } from '../../state/NavContext';
import type { EnemyMarchSnapshot } from '../../state/worldSession';
import { useNow } from '../../state/useNow';
import { gridMetrics, layerSize, mapMarchers, type Cell } from './marchGeometry';
import { enemyMarchPos } from './enemyMarchGeometry';
import { EnemyMarchOverlay } from './EnemyMarchOverlay';
import { MarchEdgeArrows } from './MarchEdgeArrows';
import { MarchOverlay } from './MarchOverlay';
import { RaidOverlay } from './RaidOverlay';
import { TerritoryOverlay } from './TerritoryOverlay';
import type { TerritoryCell } from './territoryBorders';

interface WorldMapOverlayProps {
  win: { x: number; y: number; w: number; h: number };
  layers: MapLayers;
  /** 领地格（关掉领地图层时不传） */
  territory?: Map<string, TerritoryCell>;
  /** 本城行军（含已到达的，这里只取 status = marching） */
  marches: MarchView[];
  /** 账号城池列表：行军的出发城坐标（x / y 为 null 的不上图） */
  cities: CityRefView[];
  /** 未到到达时刻的来袭预警（不受行军图层开关影响） */
  warnings: NpcAttackWarningPushData[];
  /** 视野内他人部队的快照（AISLG-230；null = 还没拉过）。显示跟「行军」图层开关走 */
  enemyMarches?: EnemyMarchSnapshot | null;
  onOpenMarch: (id: string) => void;
  /** 地图以该格为中心跳过去（视野外箭头用） */
  onCenter: (x: number, y: number) => void;
  /** +N 角标：打开军队页的行军列表 */
  onOpenMarchList: () => void;
}

export function WorldMapOverlay({
  win, layers, territory, marches, cities, warnings, enemyMarches, onOpenMarch, onCenter, onOpenMarchList,
}: WorldMapOverlayProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // 每秒推进的本地时钟：开表条件只在这个子树里，避免每秒把整张地图的 400 个格子重渲一遍
  const marching = marches.some((march) => march.status === 'marching');
  const raiding = warnings.some((warning) => Date.parse(warning.arriveAt) > Date.now());
  const enemyMoving = (enemyMarches?.marches.length ?? 0) > 0;
  const now = useNow(marching || raiding || enemyMoving);
  const mapMarchList = useMemo(
    () => (layers.marches ? mapMarchers(marches, cities, now) : []),
    [layers.marches, marches, cities, now],
  );
  // 正在来袭自己的行军 id（= 来袭预警的 attackId）：图标转红并连线到被攻击格
  const incomingIds = useMemo(
    () => new Set(warnings.filter((warning) => Date.parse(warning.arriveAt) > now).map((warning) => warning.attackId)),
    [warnings, now],
  );
  // 他人部队这一帧的图标位置（来袭连线也从这里取起点，两点与图标一致）
  const enemyPositions = useMemo(() => {
    const map = new Map<string, Cell>();
    if (!layers.marches || !enemyMarches) {
      return map;
    }
    for (const march of enemyMarches.marches) {
      map.set(march.id, enemyMarchPos(march, enemyMarches.receivedAt, now));
    }
    return map;
  }, [layers.marches, enemyMarches, now]);

  // 覆盖层与网格同容器、等大：自己量尺寸，格子步长按实测像素换算（容器变化 / 缩放后重算）
  useEffect(() => {
    const el = boxRef.current;
    if (!el) {
      return undefined;
    }
    const apply = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, [win.w, win.h]);

  const metrics = useMemo(() => gridMetrics(win, size), [win.w, win.h, size.w, size.h]);
  const layer = layerSize(win, metrics);
  // 原点对象保持稳定，免得每秒重算箭头与背景时整层重排
  const origin = useMemo(() => ({ x: win.x, y: win.y }), [win.x, win.y]);

  return (
    <div ref={boxRef} role="世界地图-覆盖层" className="pointer-events-none absolute inset-0 overflow-hidden">
      {layers.territory && territory ? <TerritoryOverlay win={win} metrics={metrics} size={layer} cells={territory} /> : null}
      {mapMarchList.length > 0 ? <MarchOverlay marches={mapMarchList} now={now} size={layer} metrics={metrics} origin={origin} onOpenMarch={onOpenMarch} /> : null}
      {mapMarchList.length > 0 ? (
        <MarchEdgeArrows marches={mapMarchList} origin={origin} win={win} metrics={metrics} onCenter={onCenter} onOpenMarchList={onOpenMarchList} />
      ) : null}
      {layers.marches && enemyMarches && enemyMarches.marches.length > 0 ? (
        <EnemyMarchOverlay
          marches={enemyMarches.marches}
          receivedAt={enemyMarches.receivedAt}
          now={now}
          size={layer}
          metrics={metrics}
          origin={origin}
          incomingIds={incomingIds}
        />
      ) : null}
      <RaidOverlay
        warnings={warnings}
        now={now}
        origin={origin}
        win={win}
        metrics={metrics}
        size={layer}
        onCenter={onCenter}
        enemyPositions={enemyPositions}
      />
    </div>
  );
}
