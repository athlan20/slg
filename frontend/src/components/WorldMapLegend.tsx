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
import { ENEMY_MARCH_TONE_COLOR, type EnemyMarchTone } from './map/enemyMarchGeometry';

/** 领地图例的四种关系（顺序固定：自己 → 盟友 → 敌对 → 其他） */
const TERRITORY_LEGEND_ORDER: TerritoryRelation[] = ['own', 'ally', 'hostile', 'other'];

/** 他人部队图例的顺序（来袭 → 敌对 → 中立 → 同盟友盟）与对应的文案键 */
const ENEMY_MARCH_LEGEND_ORDER: EnemyMarchTone[] = ['incoming', 'hostile', 'neutral', 'friend'];
const ENEMY_MARCH_LEGEND_LABEL: Record<EnemyMarchTone, 'legendIncoming' | 'legendHostile' | 'legendNeutral' | 'legendFriend'> = {
  incoming: 'legendIncoming',
  hostile: 'legendHostile',
  neutral: 'legendNeutral',
  friend: 'legendFriend',
};

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
      {/* 视野（v97，AISLG-232）：望楼把这块野地的视野扩到 6 / 8 / 10 格（取代野地原来的 3 格） */}
      <ul role="世界地图图例-视野" className="flex flex-wrap gap-x-2.5 gap-y-1">
        <li className={itemCls}>
          <span role="世界地图图例-望楼" className={`${swatchCls} border-accent/60 font-semibold text-accent`}>
            {EXTRA_MAP.watchtower.glyph}
          </span>
          {EXTRA_MAP.fog.watchtowerVision}
        </li>
        {/* 丘陵视野（AISLG-233）：丘陵上的野地与望楼视野 +2 */}
        <li role="世界地图图例-丘陵视野" className={itemCls}>
          <span role="世界地图图例-丘陵视野-图标" className={`${swatchCls} border-line-soft text-[9px] text-dim`}>
            {TERRAIN_LABEL.hill.slice(0, 1)}
          </span>
          {EXTRA_MAP.fog.hillVision}
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
      {/* 他人部队（AISLG-230）：跟「行军」图层走，颜色按与你的关系：来袭 / 敌对 / 中立 / 同盟友盟 */}
      <ul role="世界地图图例-他人部队" className="flex flex-wrap gap-x-2.5 gap-y-1">
        <li className={itemCls}>
          <span
            role="世界地图图例-他人部队-图标"
            className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-semibold leading-none text-bg"
            style={{ background: ENEMY_MARCH_TONE_COLOR.neutral }}
          >
            {EXTRA_MAP.enemyMarch.glyph}
          </span>
          {EXTRA_MAP.enemyMarch.legend}
        </li>
        {ENEMY_MARCH_LEGEND_ORDER.map((tone) => (
          <li key={tone} className={itemCls}>
            <span
              role={`世界地图图例-他人部队-${tone}`}
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: ENEMY_MARCH_TONE_COLOR[tone] }}
            />
            {EXTRA_MAP.enemyMarch[ENEMY_MARCH_LEGEND_LABEL[tone]]}
          </li>
        ))}
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
