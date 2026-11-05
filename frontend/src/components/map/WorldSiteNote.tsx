// 选中遗迹或名将处所格时，右侧详情里的一块（AISLG-227）：遗迹给品质、种类、奖励与领取规则；处所给处所名、名将与出山状态。
// 字段只来自后端 GET_TILE 的 relic / heroSite（已探索或视野内才有），本组件不做探索判断。
import type { HeroSiteView, RelicTileView } from '../../api/protocol-world';
import { relicRewardParts } from '../../api/relic-config';
import { useCopy } from '../../i18n/bundle';
import { tName } from '../../i18n/names';

export function WorldSiteNote({ relic, heroSite }: { relic: RelicTileView | null; heroSite: HeroSiteView | null }) {
  const copy = useCopy();
  const F = copy.EXTRA_MAP.fog;
  const R = copy.RESOURCE_LABEL;
  if (relic) {
    const rewardText = relicRewardParts(relic.kind)
      .map((part) => (part.key === 'advMoveCity' ? `${F.advMoveCity} ×${part.amount}` : `${R[part.key]} ${part.amount}`))
      .join(' · ');
    return (
      <section role="世界地图详情区-遗迹" className="flex flex-col gap-0.5 rounded border border-accent/50 px-2 py-1 text-[11.5px]">
        <p className="font-semibold text-ink">
          {F.relicTier[relic.tier]} · {F.relicKind[relic.kind]}
        </p>
        <p className="text-muted">
          {F.detailReward}：{rewardText}
        </p>
        <p className="text-muted">{F.claimHint}</p>
      </section>
    );
  }
  if (heroSite) {
    const siteName = F.siteName[heroSite.name] ?? heroSite.name;
    return (
      <section role="世界地图详情区-名将处所" className="flex flex-col gap-0.5 rounded border border-gold/50 px-2 py-1 text-[11.5px]">
        <p className="font-semibold text-gold">
          {siteName} · {heroSite.claimed ? F.claimed : F.heroSiteTag}
        </p>
        <p className="text-muted">{F.heroLabel(tName(heroSite.hero))}</p>
        <p className="text-muted">{heroSite.claimed ? F.heroClaimed : F.heroNotClaimed}</p>
      </section>
    );
  }
  return null;
}
