/** 迷雾格（AISLG-224 / AISLG-226）：窗口里缺的未探索格，画成黑雾。
 *  都可以点选：选中后 TargetPanel 显示未探索提示和派斥候 / 盲打入口，有本盟标记时再显示标记内容。
 *  格上最多画标记角标，不露任何地块信息。
 */

import type { AllianceMarkView } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { AllianceMarkBadge } from '../worldMapMarks';

interface FogCellProps {
  x: number;
  y: number;
  /** 本盟标记（已过期的不传）；没有标记即普通黑雾 */
  mark?: AllianceMarkView;
  selected: boolean;
  onSelect: (x: number, y: number) => void;
}

export function FogCell({ x, y, mark, selected, onSelect }: FogCellProps) {
  const { EXTRA_MAP } = useCopy();
  const title = EXTRA_MAP.fog.unknownTitle;
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
      {mark ? <AllianceMarkBadge kind={mark.kind} /> : null}
    </button>
  );
}
