/** 望楼的地图标记（AISLG-232，v96）：格内左侧居中的「望」字 + 等级点（几级几个点）。
 *  别人的望楼同样显示——想「断你的眼」得先知道眼在哪。独立组件：WorldMapGrid 已接近行数上限，
 *  标记不再往那里加。只渲染后端已裁剪的 field（explored 格按上次看到的等级显示），本组件不做探索判断。
 */
import type { TileView } from '../../api/protocol-world';
import { useCopy } from '../../i18n/bundle';
import { watchtowerVisionRadius } from './watchtowerTable';

export function WatchtowerMarker({ tile }: { tile: TileView }) {
  const copy = useCopy();
  const W = copy.EXTRA_MAP.watchtower;
  const facility = tile.facility;
  if (!facility || facility.level <= 0) {
    return null;
  }
  const label = W.title(facility.level, watchtowerVisionRadius(facility.level));
  return (
    <span
      role="世界地图视野-望楼"
      aria-label={W.aria(facility.level)}
      title={label}
      // z-[2]：在已探索遮罩之上，不被压暗（与遗迹 / 处所标记同一层）
      className="absolute left-[4%] top-1/2 z-[2] flex -translate-y-1/2 flex-col items-center gap-[1px] leading-none"
    >
      <span className="font-semibold text-accent drop-shadow-[0_0_4px_var(--accent)] text-[clamp(9px,1.7cqw,15px)]">{W.glyph}</span>
      <span role="世界地图视野-望楼等级" className="flex items-center gap-[2px]">
        {Array.from({ length: facility.level }, (_, index) => (
          <span key={index} aria-hidden="true" className="h-[3px] w-[3px] rounded-full bg-accent" />
        ))}
      </span>
    </span>
  );
}
