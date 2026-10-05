/** 世界地图图例（浮在地图左下角，可收起）：地形（底色 + 图标，与地图格子同一套符号）+ 城池 / 占领标记 + 等级说明。
 *  一屏地图里要尽量少遮挡：紧凑小字、自动换行，不含键盘说明（放在悬浮提示里）。
 */

import { COPY, TERRAIN_LABEL } from '../copy';
import { TERRAIN_KINDS } from '../api/protocol';
import { CITY_COPY } from '../copy-cities';
import { CityMark, TERRAIN_CLASS, TerrainIcon } from './worldMapMarks';

const itemCls = 'flex items-center gap-1 whitespace-nowrap text-[10.5px] text-dim';
const swatchCls = 'grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border border-line-soft';

export function WorldMapLegend() {
  return (
    <div role="世界地图图例" className="flex flex-col gap-1">
      <ul role="世界地图图例-地形" aria-label={COPY.worldMap.legendTerrain} className="flex flex-wrap gap-x-2.5 gap-y-1">
        {TERRAIN_KINDS.map((terrain) => (
          <li key={terrain} className={itemCls}>
            <span className={`${swatchCls} ${TERRAIN_CLASS[terrain]}`}>
              <TerrainIcon terrain={terrain} className="w-3" />
            </span>
            {TERRAIN_LABEL[terrain]}
          </li>
        ))}
      </ul>
      <ul role="世界地图图例-标记" aria-label={COPY.worldMap.legendMarks} className="flex flex-wrap gap-x-2.5 gap-y-1">
        <li className={itemCls}>
          <CityMark side="own" className="w-3.5 text-[9px]" />
          {COPY.worldMap.legendOwnCity}
        </li>
        <li className={itemCls}>
          <CityMark side="enemy" className="w-3.5 text-[9px]" />
          {COPY.worldMap.legendCity}
        </li>
        <li className={itemCls}>
          <CityMark side="npc" className="w-3.5 text-[9px]" />
          {COPY.worldMap.legendNpcCity}
        </li>
        <li className={itemCls}>
          <CityMark side="famous" className="w-3.5 text-[9px]" />
          {CITY_COPY.famous.legend}
        </li>
        <li className={itemCls}>
          <span className={`${swatchCls} relative overflow-hidden bg-t-plain ring-2 ring-inset ring-accent/80`}>
            <span className="absolute left-0 top-0 h-1.5 w-1.5 bg-accent [clip-path:polygon(0_0,100%_0,0_100%)]" />
          </span>
          {COPY.worldMap.legendOwnTile}
        </li>
        <li className={itemCls}>
          <span className={`${swatchCls} relative overflow-hidden bg-t-plain ring-2 ring-inset ring-warn/70`}>
            <span className="absolute left-0 top-0 h-1.5 w-1.5 bg-warn [clip-path:polygon(0_0,100%_0,0_100%)]" />
          </span>
          {COPY.worldMap.legendEnemyTile}
        </li>
        <li className={itemCls}>
          <span className="font-mono text-[10px] font-semibold text-gold">10</span>
          {COPY.worldMap.legendLevel}
        </li>
      </ul>
    </div>
  );
}
