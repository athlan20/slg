/** 战场兵种明细（AISLG-250）：启动面板的「入场编成」与「我的队伍」每支队伍的兵种明细。
 *  数据只读会话切片的 me.squads[].troops（ArmyCounts），不另存状态，兵力减少 / 拆队 / 全灭后跟着服务端下发变；
 *  兵种名沿用 TROOP_LABEL（中英文跟随语言包），人口取 TROOP_INFO。数量为 0 的兵种不显示，
 *  没有存活兵力时整块不渲染，避免出现空行或 undefined。 */

import { TROOP_KINDS, TROOP_INFO, type BattlefieldSquadView, type TroopKind } from '../api/protocol';
import { useCopy } from '../i18n/bundle';
import { tName } from '../i18n/names';

type Troops = Partial<Record<TroopKind, number>>;

/** 单个兵种数量：取整、去负、非数字按 0（服务端本已下发整数，这里只防御脏数据） */
function countOf(troops: Troops, kind: TroopKind): number {
  const value = troops[kind] ?? 0;
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** 兵种总兵数（各兵种数量之和） */
export function sumTroops(troops: Troops): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + countOf(troops, kind), 0);
}

/** 兵种总人口（各兵种数量 × TROOP_INFO.population） */
export function populationOf(troops: Troops): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + countOf(troops, kind) * TROOP_INFO[kind].population, 0);
}

/** 按 TROOP_KINDS 的固定顺序拼「刀盾兵 600 · 弓箭兵 400」；没有存活兵种时返回空串 */
function troopParts(troops: Troops, labelOf: (kind: TroopKind, count: number) => string): string {
  return TROOP_KINDS.filter((kind) => countOf(troops, kind) > 0)
    .map((kind) => labelOf(kind, countOf(troops, kind)))
    .join(' · ');
}

/** 启动面板的「入场编成」：把 me.squads 的兵种逐队相加（拆队后仍是带入总数）后列出兵种与总兵数 / 总人口。
 *  入场前（me.entered 为 false）由调用方不渲染；这里再兜一层：没有兵也不渲染。 */
export function BattlefieldEntryFormation({ squads }: { squads: readonly BattlefieldSquadView[] }) {
  const { BATTLEFIELD_COPY: B, TROOP_LABEL } = useCopy();
  const totals: Partial<Record<TroopKind, number>> = {};
  for (const squad of squads) {
    for (const kind of TROOP_KINDS) {
      const count = countOf(squad.troops, kind);
      if (count > 0) {
        totals[kind] = (totals[kind] ?? 0) + count;
      }
    }
  }
  const parts = troopParts(totals, (kind, count) => B.squads.troopPart(tName(TROOP_LABEL[kind].name), count));
  if (parts.length === 0) {
    return null;
  }
  return (
    <p role="战场-入场编成" className="shrink-0 text-[12px] text-dim">
      {B.entry.formation(parts, sumTroops(totals), populationOf(totals))}
    </p>
  );
}

/** 「我的队伍」里单支队伍的兵种明细（小字，挂在队伍条目的状态行下面） */
export function BattlefieldSquadTroops({ troops }: { troops: Troops }) {
  const { BATTLEFIELD_COPY: B, TROOP_LABEL } = useCopy();
  const parts = troopParts(troops, (kind, count) => B.squads.troopPart(tName(TROOP_LABEL[kind].name), count));
  if (parts.length === 0) {
    return null;
  }
  return (
    <span role="战场-队伍兵种明细" className="block min-w-0 truncate text-[11px] text-faint">
      {parts}
    </span>
  );
}
