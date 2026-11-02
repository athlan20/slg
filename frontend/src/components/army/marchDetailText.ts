// 行军行的摘要文本与详情用的取值（AISLG-215，GitHub #33）：
// - 兵种摘要（缩写 + 数量）：行内第二行与详情弹窗共用；
// - 物资摘要（按金木粮石铁顺序，最多 3 项，k / M 缩写）：运输类行军的行内第二行用；
// - 详情弹窗的兵种明细行、总数、出发城名。
// 只做「值 → 文本」的拼装，语言相关的词取自当前语言文案包（getCopy）。

import { RESOURCE_KEYS, TROOP_KINDS, type MarchView, type Resources, type TroopKind } from '../../api/protocol';
import { getCopy } from '../../i18n/bundle';
import { tName } from '../../i18n/names';

/** 行内物资摘要最多显示几项（其余折成 …） */
export const CARGO_SUMMARY_MAX = 3;

/** 运输类行军：任务 = 运输，或被撤回 / 目标失效后带着物资返程的行军（cargo 非 null 即属此类） */
export function isCargoMarch(march: MarchView): boolean {
  return march.cargo !== null;
}

/** 兵种摘要（缩写 + 数量，空格分隔）：如「辎3 民5」；没有随行部队给「—」 */
export function compositionText(troops: Record<string, number> | null | undefined): string {
  const { TROOP_LABEL } = getCopy();
  if (!troops) {
    return '—';
  }
  const parts = TROOP_KINDS.filter((kind) => (troops[kind] ?? 0) > 0).map((kind) => `${TROOP_LABEL[kind].short}${troops[kind]}`);
  return parts.join(' ') || '—';
}

/** 数量缩写（k / M，1 位小数，整数不带小数点）：800 → 800，2000 → 2k，5200 → 5.2k，120 万 → 1.2M */
export function shortAmount(value: number): string {
  const n = Math.floor(value);
  const abs = Math.abs(n);
  if (abs < 1000) {
    return String(n);
  }
  const [divisor, unit] = abs >= 1_000_000 ? [1_000_000, 'M'] : [1_000, 'k'];
  return `${Math.round((n / divisor) * 10) / 10}${unit}`;
}

/** 行内物资摘要：只列数量非 0 的资源，按金 → 木 → 粮 → 石 → 铁顺序，最多 CARGO_SUMMARY_MAX 项，其余以 … 收尾 */
export function cargoSummaryText(cargo: Resources | null | undefined): string {
  const { RESOURCE_LABEL, ARMY_COPY } = getCopy();
  if (!cargo) {
    return '';
  }
  const parts = RESOURCE_KEYS.filter((key) => (cargo[key] ?? 0) > 0).map((key) =>
    ARMY_COPY.marchDetail.cargoItem(RESOURCE_LABEL[key], shortAmount(cargo[key])),
  );
  if (parts.length <= CARGO_SUMMARY_MAX) {
    return parts.join(' ');
  }
  return `${parts.slice(0, CARGO_SUMMARY_MAX).join(' ')}…`;
}

/** 详细数量（详情弹窗用）：完整数字加千分位，不缩写 */
export function fullAmount(value: number): string {
  return Math.floor(value).toLocaleString('en-US');
}

/** 兵种明细行（详情弹窗）：只列有兵的兵种，按 TROOP_KINDS 顺序 */
export function troopRows(march: MarchView): Array<{ kind: TroopKind; name: string; count: number }> {
  const { TROOP_LABEL } = getCopy();
  return TROOP_KINDS.filter((kind) => (march.troops[kind] ?? 0) > 0).map((kind) => ({
    kind,
    name: TROOP_LABEL[kind].name,
    count: march.troops[kind] ?? 0,
  }));
}

/** 随行部队总数 = 兵种明细之和 */
export function troopTotal(march: MarchView): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + Math.max(0, march.troops[kind] ?? 0), 0);
}

/** 出发城名：在账号城池列表里按 fromCityId 查；查不到（城已放弃等）显示「原城池」 */
export function fromCityName(cities: Array<{ id: string; name: string }>, fromCityId: string): string {
  const found = cities.find((item) => item.id === fromCityId);
  return found ? tName(found.name) : getCopy().ARMY_COPY.marchDetail.fromUnknown;
}
