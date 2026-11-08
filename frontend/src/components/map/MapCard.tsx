/** 地图卡（地图页左侧）：图层开关（流寇·商队 / 黄巾 / 领地 / 行军 / 产出，AISLG-216 起后三项见 dispatch）、
 *  工具条（回主城 · 缩放 · 坐标跳转 · 平移）、世界地图舞台。格数按容器算。建筑相关的操作在城池页，这里只放世界地图。
 *  图层开关的两种形态（AISLG-231）：宽度 >= 640px 横排复选框；< 640px 收进标题栏右侧的「图层」按钮 + 浮层面板。
 *  用 matchMedia 判断渲染哪一种，不用 CSS 藏一份，避免同一复选框的 role 在 DOM 里出现两次。
 */

import { useGame } from '../../state/GameContext';
import { useMediaQuery } from '../../state/useMediaQuery';
import { useNav } from '../../state/NavContext';
import { useCopy } from '../../i18n/bundle';
import { Card } from '../ui/Card';
import { MapLayerMenu } from './MapLayerMenu';
import { useLayerOptions } from './mapLayerOptions';
import { MapToolbar } from './MapToolbar';
import { WorldMapStage } from './WorldMapStage';

/** 横排复选框（电脑端）与手机端「图层」按钮的分界，与 Tailwind 的 sm 断点一致 */
const WIDE_QUERY = '(min-width: 640px)';

interface MapCardProps {
  role: string;
}

export function MapCard({ role }: MapCardProps) {
  const { MAPUI_COPY } = useCopy();
  const { session, openYellowTurban, incoming } = useGame();
  const { layers, toggleLayer } = useNav();
  const options = useLayerOptions();
  const wide = useMediaQuery(WIDE_QUERY);
  const world = session.world;

  return (
    <Card
      role={role}
      flush
      title={MAPUI_COPY.title}
      actions={
        wide ? (
          <div role={`${role}-图层`} className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-2.5 gap-y-1 text-[12px] text-dim">
            {options.map((option) => (
              <label key={option.key} className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap">
                <input
                  type="checkbox"
                  role={`${role}-图层-${option.roleLabel}`}
                  checked={layers[option.key]}
                  onChange={() => toggleLayer(option.key)}
                />
                {option.label}
              </label>
            ))}
          </div>
        ) : (
          <MapLayerMenu role={role} layers={layers} onToggle={toggleLayer} />
        )
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
        overview={session.mapOverview}
        allianceMarks={session.allianceMarks.marks}
        cityList={session.cityList.cities}
        npcWarnings={incoming}
        factions={session.factions.state}
      />
    </Card>
  );
}
