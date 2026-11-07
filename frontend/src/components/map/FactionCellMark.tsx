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

/** 老巢单字标记（老巢坐标公开，迷雾里也画；提示带势力名与首领） */
export function FactionLairMark({ name, leader }: { name: string; leader: string }) {
  const { EXTRA_MAP } = useCopy();
  return (
    <span
      role="世界地图视野-势力老巢"
      aria-hidden="true"
      title={EXTRA_MAP.faction.lairHint(name, leader)}
      className="pointer-events-none absolute inset-x-0 top-[16%] grid place-items-center font-semibold leading-none text-gold drop-shadow-[0_0_4px_var(--gold)] text-[clamp(9px,1.6cqw,14px)]"
    >
      {EXTRA_MAP.tileGlyphs.factionLair}
    </span>
  );
}
