// 遗迹与名将处所的地图标记（AISLG-227）：格内居中偏上的大图标（品质颜色分明）+ 格底的种类名 / 处所名
// （窄屏隐藏，同城名）。标记 z-[2]，位于已探索遮罩之上，不被压暗。只渲染后端已裁剪的字段，本组件不做探索判断。
import type { TileView } from '../../api/protocol-world';
import { useCopy } from '../../i18n/bundle';
import { tName } from '../../i18n/names';

const RELIC_TIER_CLASS: Record<string, string> = {
  common: 'text-ink',
  rare: 'text-accent drop-shadow-[0_0_5px_var(--accent)]',
  legendary: 'text-gold drop-shadow-[0_0_6px_var(--gold)]',
};

const ICON_CLASS = 'absolute left-1/2 top-[12%] z-[2] -translate-x-1/2 leading-none text-[clamp(18px,3.4cqw,30px)]';
const NAME_CLASS = 'absolute bottom-[4%] left-0.5 right-[22%] z-[2] truncate @max-lg:hidden text-left text-[clamp(8px,1.25cqw,12px)] leading-tight font-semibold';

export function WorldSiteMarker({ tile }: { tile: TileView }) {
  const copy = useCopy();
  const F = copy.EXTRA_MAP.fog;
  if (tile.relic) {
    const name = F.relicKind[tile.relic.kind] ?? tile.relic.kind;
    const label = `${F.relicTier[tile.relic.tier]} · ${name}`;
    return (
      <>
        <span role="世界地图视野-遗迹" aria-label={label} title={label} className={`${ICON_CLASS} ${RELIC_TIER_CLASS[tile.relic.tier] ?? ''}`}>
          ◆
        </span>
        <span role="世界地图视野-遗迹名" className={`${NAME_CLASS} text-ink`}>
          {name}
        </span>
      </>
    );
  }
  if (tile.heroSite) {
    const site = tile.heroSite;
    const siteName = F.siteName[site.name] ?? site.name;
    const label = F.heroSiteLabel(siteName, tName(site.hero), site.claimed);
    return (
      <>
        <span
          role="世界地图视野-名将处所"
          aria-label={label}
          title={label}
          className={`${ICON_CLASS} ${site.claimed ? 'text-muted grayscale' : 'text-gold drop-shadow-[0_0_5px_var(--gold)]'}`}
        >
          ⚑
        </span>
        <span role="世界地图视野-名将处所名" className={`${NAME_CLASS} ${site.claimed ? 'text-muted' : 'text-gold'}`}>
          {site.claimed ? `${siteName} · ${F.claimed}` : siteName}
        </span>
      </>
    );
  }
  return null;
}
