/** 势力范围在格子上的两个小标记（v99，AISLG-239）：半透明色块与老巢单字。
 *  从 WorldMapGrid 拆出，纯展示：颜色由 factionLayer 给，文案由 copy-extra-map 的 faction 组给。
 */

import type { FactionKey } from '../../api/protocol-faction';
import { useCopy } from '../../i18n/bundle';
import { FACTION_COLORS } from './factionLayer';

/** 势力范围色块（铺在地形底色之上、图标之下；只表示地盘，不揭开迷雾） */
export function FactionTint({ factionKey }: { factionKey: FactionKey }) {
  return (
    <span
      role="世界地图视野-势力色块"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0"
      style={{ backgroundColor: FACTION_COLORS[factionKey] }}
    />
  );
}

/** 老巢单字标记（老巢坐标公开，迷雾里也画；提示带势力名与首领）。
 *  v101（AISLG-241）：这家本季已灭亡时改画废墟单字，提示写「已被攻破」。 */
export function FactionLairMark({ name, leader, destroyed = false }: { name: string; leader: string; destroyed?: boolean }) {
  const { EXTRA_MAP } = useCopy();
  const title = destroyed ? EXTRA_MAP.faction.lairHintRuins(name) : EXTRA_MAP.faction.lairHint(name, leader);
  return (
    <span
      role={destroyed ? '世界地图视野-势力老巢废墟' : '世界地图视野-势力老巢'}
      aria-hidden="true"
      title={title}
      className="pointer-events-none absolute inset-x-0 top-[16%] grid place-items-center font-semibold leading-none text-gold drop-shadow-[0_0_4px_var(--gold)] text-[clamp(9px,1.6cqw,14px)]"
    >
      {destroyed ? EXTRA_MAP.tileGlyphs.factionLairRuins : EXTRA_MAP.tileGlyphs.factionLair}
    </span>
  );
}
