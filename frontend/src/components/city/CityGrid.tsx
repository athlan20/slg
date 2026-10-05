/** 城内视图：15 座建筑按用途分三行（资源 / 内政 / 军事），每格固定的紧凑尺寸（不再撑满容器）= 简称 / 名字 / 等级或「未建」/ 一句效果；
 *  在建的有高亮并显示剩余时间，排队的描边，选中的高亮。点格子 = 选中建筑（城池页右侧出详情，在地图页「城内」视图则跳城池页）。
 *  每种建筑同城唯一（v5），等级成长；在队冲突与队满的判断在详情区。
 */

import { buildingEffectText } from '../../api/mapping';
import { type BuildingKind, type CityView } from '../../api/protocol';
// role 定位值取静态中文文案源（AISLG-137 约定：role 不随界面语言变）
import { BUILDING_LABEL as BUILDING_LABEL_ZH } from '../../copy';
import { useCopy } from '../../i18n/bundle';
import { useNow } from '../../state/useNow';

/** 建筑分组（城内视图按用途分三行，每行一个标签）：资源产出 / 内政民生 / 军事守备，共 15 座 */
export const KIND_GROUPS: Array<{ key: string; label: string; kinds: BuildingKind[] }> = [
  { key: 'resource', label: '资源', kinds: ['farm', 'lumber_mill', 'quarry', 'iron_mine'] },
  { key: 'civil', label: '内政', kinds: ['house', 'government', 'warehouse', 'academy', 'tavern', 'post_station'] },
  { key: 'military', label: '军事', kinds: ['barracks', 'parade_ground', 'wall', 'arrow_tower', 'beacon'] },
];

/** 全部建筑（按分组顺序） */
export const KIND_ORDER: BuildingKind[] = KIND_GROUPS.flatMap((group) => group.kinds);

interface CityGridProps {
  city: CityView | null;
  selected: BuildingKind | null;
  onPick: (kind: BuildingKind) => void;
}

export function CityGrid({ city, selected, onPick }: CityGridProps) {
  const copy = useCopy();
  const { BUILDING_LABEL, COPY, EXTRA_PANEL } = copy;
  const queue = city?.queue ?? [];
  const activeEntry = queue.find((item) => item.status === 'building') ?? null;
  // 到期时间由服务端给出；剩余秒数按本地时钟推进，完成与否以服务端推送 / 查询为准
  const now = useNow(activeEntry !== null);
  const remaining = activeEntry?.dueAt ? Math.max(0, Math.ceil((Date.parse(activeEntry.dueAt) - now) / 1000)) : 0;

  return (
    <div role="城内视图-建筑格" className="flex shrink-0 flex-col gap-3 p-3 short:gap-2 short:p-2">
      {KIND_GROUPS.map((group) => (
        <section key={group.key} role={`城内视图-分组-${group.label}`} className="flex min-w-0 flex-col gap-1.5">
          {/* role 沿用分组的中文 label（定位约定），显示文案按界面语言取 */}
          <h3 className="text-[11.5px] text-faint">{EXTRA_PANEL.cityGrid.groupLabel[group.key] ?? group.label}</h3>
          <div className="grid grid-cols-4 gap-2 sm:[grid-template-columns:repeat(6,minmax(0,8.5rem))]">
            {group.kinds.map((kind) => {
              const label = BUILDING_LABEL[kind];
              const level = city?.levels[kind] ?? 0;
              const entry = queue.find((item) => item.kind === kind);
              const active = entry?.status === 'building';
              const isSelected = selected === kind;
              const tone = isSelected
                ? 'border-accent bg-accent-soft text-accent'
                : active
                  ? 'border-accent-dim bg-accent-soft'
                  : entry
                    ? 'border-accent-dim bg-panel-2'
                    : level === 0
                      ? 'border-dashed border-line bg-panel-2 text-faint hover:border-accent-dim'
                      : 'border-line bg-panel-2 hover:border-accent-dim hover:bg-accent-soft';
              return (
                <button
                  key={kind}
                  type="button"
                  role={`城内视图-建筑-${BUILDING_LABEL_ZH[kind].short}`}
                  aria-pressed={isSelected}
                  disabled={city === null}
                  onClick={() => onPick(kind)}
                  className={`relative flex h-[92px] short:h-[74px] min-w-0 max-sm:h-[66px] cursor-pointer flex-col items-center justify-center gap-0.5 overflow-hidden rounded-md border px-1 transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${tone}`}
                >
                  {entry ? <i className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-gold" /> : null}
                  <b className="text-[19px] font-semibold leading-none">{label.short}</b>
                  <span className="max-w-full truncate text-[12px]">{label.name}</span>
                  <span className={`font-mono text-[11px] ${active ? 'text-accent' : 'text-dim'}`}>
                    {entry ? COPY.cityMap.levelTransition(level, entry.level) : level > 0 ? COPY.cityMap.levelNow(level) : COPY.cityMap.notBuilt}
                  </span>
                  <span
                    className={`max-w-full truncate px-1 text-[10.5px] max-sm:hidden short:hidden ${active ? 'font-mono text-accent' : 'text-faint'}`}
                    title={city ? buildingEffectText(kind, city) : undefined}
                  >
                    {active
                      ? activeEntry?.dueAt
                        ? remaining > 0
                          ? COPY.cityMap.remainingSeconds(remaining)
                          : COPY.cityMap.waitingSettle
                        : COPY.cityMap.activating
                      : entry
                        ? COPY.cityMap.queued
                        : level > 0 && city
                          ? buildingEffectText(kind, city)
                          : label.tag}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
