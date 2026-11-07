/** 迷雾格（AISLG-224 / AISLG-226）：窗口里缺的未探索格，画成黑雾。
 *  都可以点选：选中后 TargetPanel 显示未探索提示和派斥候 / 盲打入口，有本盟标记时再显示标记内容。
 *  格上最多画标记角标，不露任何地块信息。
 *  势力范围（v99，AISLG-239）：迷雾格上可以铺一层很淡的势力色（老巢坐标与半径是公开数据，色块只表示地盘、
 *  不揭开迷雾）；老巢所在格的标记同样是公开信息，迷雾里也画。
 */

import type { AllianceMarkView } from '../../api/protocol';
import type { FactionKey } from '../../api/protocol-faction';
import { useCopy } from '../../i18n/bundle';
import { AllianceMarkBadge } from '../worldMapMarks';
import { FACTION_COLORS } from './factionLayer';

interface FogCellProps {
  x: number;
  y: number;
  /** 本盟标记（已过期的不传）；没有标记即普通黑雾 */
  mark?: AllianceMarkView;
  selected: boolean;
  onSelect: (x: number, y: number) => void;
  /** 势力范围图层（关掉时不传）：这格属于哪家，只铺色不揭迷雾 */
  factionKey?: FactionKey;
  /** 这格是哪家的老巢（公开信息，迷雾里也给一个小标记） */
  lair?: { name: string; leader: string };
}

export function FogCell({ x, y, mark, selected, onSelect, factionKey, lair }: FogCellProps) {
  const { EXTRA_MAP } = useCopy();
  const title = lair ? EXTRA_MAP.faction.lairHint(lair.name, lair.leader) : EXTRA_MAP.fog.unknownTitle;
  return (
    <button
      type="button"
      role="世界地图-迷雾层"
      data-x={x}
      data-y={y}
      tabIndex={-1}
      title={title}
      aria-label={title}
      aria-pressed={selected}
      onClick={() => onSelect(x, y)}
      className={`relative cursor-pointer rounded bg-[#05070b] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1 ${
        selected ? 'z-[1] shadow-[0_0_0_2px_var(--accent),0_0_14px_var(--accent-dim)]' : ''
      }`}
    >
      {factionKey ? (
        <span
          role="世界地图-迷雾层-势力色块"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded opacity-50"
          style={{ backgroundColor: FACTION_COLORS[factionKey] }}
        />
      ) : null}
      {mark ? <AllianceMarkBadge kind={mark.kind} /> : null}
      {lair ? (
        <span
          role="世界地图-迷雾层-势力老巢"
          aria-hidden="true"
          className="absolute inset-0 grid place-items-center text-[clamp(9px,1.8cqw,15px)] leading-none text-gold drop-shadow-[0_0_4px_var(--gold)]"
        >
          {EXTRA_MAP.tileGlyphs.factionLair}
        </span>
      ) : null}
    </button>
  );
}
