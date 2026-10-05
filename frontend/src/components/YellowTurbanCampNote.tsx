import { formatClock, formatDurationText } from '../api/format';
import type { YtTileCampView } from '../api/protocol';
import { YT_COPY } from '../copy-yt';

/** 黄巾营地 / 张角老巢说明（v29 AISLG-76）：一行摘要 = 档位 / 守军大致范围 / 升档倒计时 / 老巢阶段；
 *  攻打提示放在悬停全文里。精确编成要派斥候侦察。 */
export function YellowTurbanCampNote({ camp, now }: { camp: YtTileCampView; now: number }) {
  const isBoss = camp.tier === 'boss';
  const parts = [
    YT_COPY.tile.title(camp.label),
    YT_COPY.panel.strength(camp.garrisonTotal.min, camp.garrisonTotal.max),
    camp.nextGrowAt ? YT_COPY.tile.growIn(formatDurationText(Math.max(0, Math.ceil((Date.parse(camp.nextGrowAt) - now) / 1000)))) : null,
    camp.boss ? YT_COPY.panel.bossStage(camp.boss.stage, camp.boss.recoversAt ? formatClock(camp.boss.recoversAt) : null) : null,
  ].filter(Boolean);
  return (
    <p
      role="世界地图详情区-黄巾营地说明"
      title={`${parts.join(' · ')}\n${isBoss ? YT_COPY.tile.bossHint : YT_COPY.tile.attackHint}`}
      className={`truncate rounded border border-warn/60 px-2 py-0.5 text-[11.5px] ${isBoss ? 'text-gold' : 'text-warn'}`}
    >
      {parts.join(' · ')}
    </p>
  );
}
