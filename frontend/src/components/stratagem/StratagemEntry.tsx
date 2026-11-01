// 施计快捷入口（v86，AISLG-211）：地图上的城、返程行军、来袭预警里的「施计 / 金蝉脱壳 /
// 八门金锁」按钮——点了打开同一个施计弹窗（state/stratagemSession 的 openPanel），
// 并把目标与可用的计谋带进去。role 属性供定位查找。

import { useGame } from '../../state/GameContext';
import type { StratagemTargetRef } from '../../state/stratagemSession';

interface StratagemEntryProps {
  role: string;
  label: string;
  target: StratagemTargetRef;
  /** 可选：点了先带上这名武将 */
  heroId?: string | null;
  className?: string;
}

export function StratagemEntry({ role, label, target, heroId, className }: StratagemEntryProps) {
  const { session } = useGame();
  return (
    <button
      type="button"
      role={role}
      title={label}
      onClick={() => session.stratagem.openPanel({ heroId: heroId ?? null, target })}
      className={
        className ??
        'shrink-0 cursor-pointer rounded border border-accent px-1.5 text-[11px] text-accent transition-colors hover:bg-accent-soft'
      }
    >
      {label}
    </button>
  );
}
