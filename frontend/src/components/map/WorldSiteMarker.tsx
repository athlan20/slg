// 遗迹与名将处所的地图图标（AISLG-227，v93）：地块格内的一枚标记，按品质 / 状态区分颜色。
// 只渲染后端已裁剪过的字段（实时视野或已探索才有值），本组件不做任何探索判断。
import type { TileView } from '../../api/protocol-world';
import { useCopy } from '../../i18n/bundle';
import { tName } from '../../i18n/names';

const TIER_CLASS: Record<string, string> = {
  common: 'text-ink',
  rare: 'text-accent',
  legendary: 'text-gold drop-shadow-[0_0_4px_var(--gold)]',
};

export function WorldSiteMarker({ tile }: { tile: TileView }) {
  const copy = useCopy();
  const F = copy.EXTRA_MAP.fog;
  if (tile.relic) {
    const label = `${F.relicTier[tile.relic.tier]} · ${F.relicKind[tile.relic.kind]}`;
    return (
      <span
        role="世界地图视野-遗迹"
        aria-label={label}
        title={label}
        className={`absolute bottom-[4%] right-[6%] font-semibold leading-none text-[clamp(9px,1.6cqw,14px)] ${TIER_CLASS[tile.relic.tier] ?? ''}`}
      >
        ◆
      </span>
    );
  }
  if (tile.heroSite) {
    const site = tile.heroSite;
    const label = F.heroSiteLabel(F.siteName[site.name] ?? site.name, tName(site.hero), site.claimed);
    return (
      <span
        role="世界地图视野-名将处所"
        aria-label={label}
        title={label}
        className={`absolute bottom-[4%] right-[6%] font-semibold leading-none text-[clamp(9px,1.6cqw,14px)] ${site.claimed ? 'text-muted grayscale' : 'text-gold'}`}
      >
        ⚑
      </span>
    );
  }
  return null;
}
