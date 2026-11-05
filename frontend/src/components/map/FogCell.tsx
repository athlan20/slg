/** 迷雾格（AISLG-224 / AISLG-226）：窗口里缺的未探索格，画成黑雾。
 *  没有本盟标记时只是一块黑底；有标记时可以点选（选中后 TargetPanel 显示未探索提示与标记内容），
 *  格上只画标记角标，不露任何地块信息。
 */

import type { AllianceMarkView } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { AllianceMarkBadge } from '../worldMapMarks';

interface FogCellProps {
  x: number;
  y: number;
  /** 本盟标记（已过期的不传）；没有标记即普通黑雾 */
  mark?: AllianceMarkView;
  onSelect: (x: number, y: number) => void;
}

export function FogCell({ x, y, mark, onSelect }: FogCellProps) {
  const { EXTRA_MAP } = useCopy();
  const title = EXTRA_MAP.fog.unknownTitle;
  if (!mark) {
    return <span role="世界地图-迷雾层" title={title} aria-label={title} className="rounded bg-[#05070b]" />;
  }
  return (
    <button
      type="button"
      role="世界地图-迷雾层"
      data-x={x}
      data-y={y}
      title={title}
      aria-label={title}
      onClick={() => onSelect(x, y)}
      className="relative cursor-pointer rounded bg-[#05070b] focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-1"
    >
      <AllianceMarkBadge kind={mark.kind} />
    </button>
  );
}
