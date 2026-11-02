/** 世界地图图例（浮在地图左下角，可收起）：地形（底色 + 图标，与地图格子同一套符号）+ 城池 / 占领标记 + 等级说明。
 *  一屏地图里要尽量少遮挡：紧凑小字、自动换行，不含键盘说明（放在悬浮提示里）。
 *  AISLG-216 起领地图例改成四种关系色块（自己 / 盟友 / 敌对 / 其他）+「金边 = 连片加成」。
 */

import { useCopy } from '../i18n/bundle';
import { TERRAIN_KINDS } from '../api/protocol';
import { ALLIANCE_MARK_KINDS } from '../api/protocol';
import { AllianceMarkGlyph, CityMark, TERRAIN_CLASS, TerrainIcon } from './worldMapMarks';
import { TERRITORY_SWATCH_CLASS } from './map/TerritoryOverlay';
import type { TerritoryRelation } from './map/territoryBorders';

/** 领地图例的四种关系（顺序固定：自己 → 盟友 → 敌对 → 其他） */
const TERRITORY_LEGEND_ORDER: TerritoryRelation[] = ['own', 'ally', 'hostile', 'other'];

const itemCls = 'flex items-center gap-1 whitespace-nowrap text-[10.5px] text-dim';
const swatchCls = 'grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border border-line-soft';

export function WorldMapLegend() {
  const copy = useCopy();
  const { COPY, EXTRA_MAP, TERRAIN_LABEL, CITY_COPY, ALLIANCE_COPY } = copy;
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
          <span className="font-mono text-[10px] font-semibold text-gold">10</span>
          {COPY.worldMap.legendLevel}
        </li>
      </ul>
      {/* 领地关系色（AISLG-216）：铺色 20% + 外圈同色描边，连片加成的一片外圈转金色 */}
      <ul role="世界地图图例-领地" className="flex flex-wrap gap-x-2.5 gap-y-1">
        {TERRITORY_LEGEND_ORDER.map((relation) => (
          <li key={relation} className={itemCls}>
            <span role={`世界地图图例-领地-${relation}`} className={`grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border ${TERRITORY_SWATCH_CLASS[relation]}`} />
            {EXTRA_MAP.territoryLegend[relation]}
          </li>
        ))}
        <li className={itemCls}>
          <span role="世界地图图例-领地-连片金边" className="grid h-4 w-4 shrink-0 place-items-center rounded-[3px] border-2 border-gold bg-t-plain" />
          {EXTRA_MAP.territoryLegend.cluster}
        </li>
      </ul>
      {/* 联盟标记（AISLG-184 / F2）：四种符号，与地块上的徽章一致 */}
      <ul role="世界地图图例-联盟标记" aria-label={ALLIANCE_COPY.marks.legend} className="flex flex-wrap gap-x-2.5 gap-y-1">
        {ALLIANCE_MARK_KINDS.map((kind) => (
          <li key={kind} className={itemCls}>
            <AllianceMarkGlyph kind={kind} />
            {ALLIANCE_COPY.marks.kindLabel[kind]}
          </li>
        ))}
      </ul>
    </div>
  );
}
