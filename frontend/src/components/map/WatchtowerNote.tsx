/** 地块详情里的「望楼」一栏（AISLG-232，v96）：自己的野地可以建造 / 升级，显示等级、视野半径、
 *  花费与耗时；建造中显示倒计时。别人的望楼只给等级与视野半径（看不到进度）。
 *  望楼受迷雾开关影响：fog_enabled 关闭时照常可建，但不产生视野效果——这里注明「迷雾未开启」。
 *  数据来源：等级取自 tile.facility（所有人可见），进度取自 tile.facilityBuilding（只有主人可见），
 *  本城望楼名额取自 city.territory（同一座城才有意义）。
 */
import type { CityView, TileDetailView } from '../../api/protocol';
import { formatDurationText } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import { WATCHTOWER_PER_CITY_LIMIT, watchtowerNextLevel, watchtowerSeconds, watchtowerVisionRadius } from './watchtowerTable';

export interface WatchtowerNoteProps {
  detail: TileDetailView;
  city: CityView;
  /** 这块地是否归本账号 */
  isOwn: boolean;
  /** 迷雾开关（GET_WORLD_MAP 的 fogEnabled）；关闭时望楼不产生视野效果 */
  fogEnabled: boolean;
  /** 建造 / 升级进行中（按钮置灰） */
  busy: boolean;
  /** 发起建造 / 升级 */
  onBuild: () => void;
  /** 当前时刻（倒计时用） */
  now: number;
}

/** 距某时刻还有多少秒（到点为 0） */
function leftSeconds(iso: string | null | undefined, now: number): number {
  if (!iso) {
    return 0;
  }
  return Math.max(0, Math.ceil((Date.parse(iso) - now) / 1000));
}

export function WatchtowerNote({ detail, city, isOwn, fogEnabled, busy, onBuild, now }: WatchtowerNoteProps) {
  const W = useCopy().EXTRA_MAP.watchtower;
  // 望楼只可能在本账号占领的野地上；其余地块不显示这一栏
  if (detail.kind !== 'wilderness') {
    return null;
  }
  const level = detail.facility?.level ?? 0;
  // 别人的野地：只给「有望楼、几级、视野多少」，不含进度（进度字段本就只有主人拿得到）
  if (!isOwn) {
    if (level <= 0) {
      return null;
    }
    return (
      <div role="选中详情-望楼" className="flex shrink-0 flex-col gap-0.5 rounded border border-line-soft bg-panel-2 px-2 py-1">
        <span role="选中详情-望楼-标题" className="text-[11px] font-semibold text-faint">
          {W.sectionTitle}
        </span>
        <span role="选中详情-望楼-等级" className="text-[11.5px] text-dim">
          {W.othersLine(level, watchtowerVisionRadius(level))}
        </span>
      </div>
    );
  }

  // 自己的野地：名额只看「这块地所属的城」，与当前操作的城不同时不显示名额行
  const sameCity = detail.owner?.cityId === city.id;
  const owned = sameCity ? city.territory.filter((tile) => tile.facility !== null).length : null;
  const building = detail.facilityBuilding ?? (sameCity ? (city.territory.find((tile) => tile.x === detail.x && tile.y === detail.y)?.facility?.building ?? null) : null);
  const left = building ? leftSeconds(building.finishAt, now) : 0;
  const next = watchtowerNextLevel(level);
  const quotaFull = owned !== null && next !== null && !building && level === 0 && owned >= WATCHTOWER_PER_CITY_LIMIT;

  return (
    <div role="选中详情-望楼" className="flex shrink-0 flex-col gap-0.5 rounded border border-line-soft bg-panel-2 px-2 py-1">
      <span role="选中详情-望楼-标题" className="flex items-baseline justify-between gap-1 text-[11px] font-semibold text-faint">
        <span>{W.sectionTitle}</span>
        {level > 0 ? (
          <span role="选中详情-望楼-等级" className="font-normal text-accent">
            {W.levelLine(level, watchtowerVisionRadius(level))}
          </span>
        ) : null}
      </span>
      {level <= 0 ? <span className="text-[11.5px] text-dim">{W.noneLine}</span> : null}
      {building ? (
        <span role="选中详情-望楼-建造中" className="text-[11.5px] text-warn">
          {level > 0 ? W.buildingUpgrade(building.toLevel) : W.building(building.toLevel)} · {W.left(formatDurationText(left))}
        </span>
      ) : next ? (
        <div role="选中详情-望楼-操作" className="flex items-center justify-between gap-2">
          <span role="选中详情-望楼-花费" className="min-w-0 flex-1 text-[11.5px] text-dim">
            {W.costAndTime(next.cost.gold, next.cost.wood, next.cost.stone, formatDurationText(watchtowerSeconds(next, city.timeScale)))}
          </span>
          <button
            type="button"
            role="选中详情-望楼-建造按钮"
            disabled={busy || quotaFull}
            title={quotaFull ? W.quotaFull(WATCHTOWER_PER_CITY_LIMIT) : W.costLine(next.cost.gold, next.cost.wood, next.cost.stone)}
            onClick={onBuild}
            className="cursor-pointer rounded border border-accent bg-accent-soft px-2.5 py-0.5 text-[12px] text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            {level > 0 ? W.upgrade : W.build}
          </button>
        </div>
      ) : (
        <span role="选中详情-望楼-满级" className="text-[11.5px] text-gold">
          {W.maxLevel}
        </span>
      )}
      {owned !== null ? (
        <span role="选中详情-望楼-名额" className={`text-[11px] ${quotaFull ? 'text-warn' : 'text-faint'}`}>
          {quotaFull ? W.quotaFull(WATCHTOWER_PER_CITY_LIMIT) : W.quota(owned, WATCHTOWER_PER_CITY_LIMIT)}
        </span>
      ) : null}
      {fogEnabled ? null : (
        <span role="选中详情-望楼-迷雾未开启" className="text-[11px] text-muted">
          {W.fogOff}
        </span>
      )}
    </div>
  );
}
