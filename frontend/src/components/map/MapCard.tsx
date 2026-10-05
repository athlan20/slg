/** 地图卡（地图页左侧）：图层开关（流寇·商队 / 黄巾 / 领地）、工具条（回主城 · 缩放 · 坐标跳转 · 平移）、
 *  世界地图舞台。格数按容器算。建筑相关的操作在城池页，这里只放世界地图。
 */

import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { useNav, type MapLayers } from '../../state/NavContext';
// role 定位值取静态中文文案源（AISLG-137 约定：role 不随界面语言变）
import { MAPUI_COPY as MAPUI_COPY_ZH } from '../../copy-pages';
import { Card } from '../ui/Card';
import { MapToolbar } from './MapToolbar';
import { WorldMapStage } from './WorldMapStage';

interface MapCardProps {
  role: string;
}

export function MapCard({ role }: MapCardProps) {
  const copy = useCopy();
  const { MAPUI_COPY } = copy;
  const { session, openYellowTurban } = useGame();
  const { layers, toggleLayer } = useNav();
  const world = session.world;
  // 图层开关文案随语言取（原先在模块顶层取静态中文包）；role 用第三列固定中文
  const LAYER_LABELS: Array<[keyof MapLayers, string, string]> = [
    ['moving', MAPUI_COPY.layerMoving, MAPUI_COPY_ZH.layerMoving],
    ['yt', MAPUI_COPY.layerYt, MAPUI_COPY_ZH.layerYt],
    ['mine', MAPUI_COPY.layerMine, MAPUI_COPY_ZH.layerMine],
  ];

  return (
    <Card
      role={role}
      flush
      title={MAPUI_COPY.title}
      actions={
        <div role={`${role}-图层`} className="ml-auto flex min-w-0 items-center gap-2.5 text-[12px] text-dim max-sm:hidden">
          {LAYER_LABELS.map(([key, label, roleLabel]) => (
            <label key={key} className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap">
              <input type="checkbox" role={`${role}-图层-${roleLabel}`} checked={layers[key]} onChange={() => toggleLayer(key)} />
              {label}
            </label>
          ))}
        </div>
      }
    >
      <MapToolbar world={world} />
      <WorldMapStage
        world={world}
        movingTargets={session.moving.targets}
        city={session.city}
        accountId={session.account?.accountId ?? null}
        layers={layers}
        yellowTurban={session.yellowTurban.state}
        onOpenYellowTurban={openYellowTurban}
        onSelect={world.selectTile}
      />
    </Card>
  );
}
