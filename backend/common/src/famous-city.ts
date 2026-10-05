// 名城规则（v24，AISLG-56；数值为占位，上线后按数据调整）：
// 从现有 NPC 城里挑 8 座升格为名城（NPC 城快照上加 famous 标记，不重生成地图），
// 分两阶段攻打——先清外围驻军，外围清空后才能攻城守；打下城守变成占领者的分城，
// 并带只有占领者享受的独占加成（该城产量 +20%）。名城计入分城上限（AISLG-58）。
// 守军 = 同等级普通 NPC 城守军 × 3，外围与城守各占一半（各 × 1.5）。
// 外围被清空后，若 6 小时（随全局时间缩放）内没人攻下城守，外围恢复满编——
// 阶段由 outerClearedAt 惰性推导，无后台任务。API（出征初核、地块视图）与 Worker
// （到达结算、侦察）共用，两侧不得各自另算。

import { TROOP_KINDS, type TroopKind } from './protocol';
import { getTimeScale } from './time-scale';
import { NPC_CITY_PROFILE, type NpcCitySnapshot } from './world';

type Counts = Partial<Record<TroopKind, number>>;

/** 全图名城数量与名称（按锚点顺序分配） */
export const FAMOUS_CITY_NAMES = ['官渡', '许昌', '洛阳', '长安', '成都', '建业', '襄阳', '邺城'] as const;
/** 名城守军总倍数（相对同等级普通 NPC 城守军）：外围与城守各占一半 */
export const FAMOUS_GARRISON_MULTIPLIER = 3;
/** 外围被清空后无人攻下城守则恢复满编的时限（基准毫秒；实际 ÷ 全局时间缩放） */
export const FAMOUS_OUTER_RECOVERY_MS = 6 * 60 * 60 * 1000;
/** 占领名城的独占加成：该城产量 +20% */
export const FAMOUS_PRODUCTION_BONUS_PERCENT = 20;
/** 名城选址的等级：从最高等级（3）的 NPC 城里挑，打下后可作为分城 */
export const FAMOUS_CITY_LEVEL = 3;

/** NPC 城快照上的名城状态 */
export interface FamousCityState {
  name: string;
  /** 外围驻军（满编；被清空不改此值，恢复由 outerClearedAt 超时推导） */
  outerGarrison: Counts;
  /** 外围被清空的时刻（ISO 8601）；null = 外围完好 */
  outerClearedAt: string | null;
}

export type FamousStage = 'outer' | 'keeper';

/** 名城两阶段守军（各 = 同级普通 NPC 城守军 × 3 ÷ 2，逐兵种四舍五入） */
export function famousGarrisons(level: number): { outer: Counts; keeper: Counts } {
  const profile = NPC_CITY_PROFILE[level];
  const each = (FAMOUS_GARRISON_MULTIPLIER / 2);
  const scaled: Counts = {};
  for (const kind of TROOP_KINDS) {
    const count = profile?.garrison[kind] ?? 0;
    if (count > 0) {
      scaled[kind] = Math.round(count * each);
    }
  }
  return { outer: { ...scaled }, keeper: { ...scaled } };
}

/** 初始名城状态（升格时写入） */
export function newFamousState(name: string, level: number): FamousCityState {
  return { name, outerGarrison: famousGarrisons(level).outer, outerClearedAt: null };
}

/** 外围恢复时限（毫秒，已按时间缩放） */
export function famousRecoveryMs(scale: number = getTimeScale()): number {
  return FAMOUS_OUTER_RECOVERY_MS / Math.max(1, scale);
}

/** 当前阶段：外围清空且未超时 = 城守阶段（可攻城守）；否则外围阶段 */
export function famousStage(state: FamousCityState, now: Date, scale: number = getTimeScale()): FamousStage {
  if (!state.outerClearedAt) {
    return 'outer';
  }
  const clearedAt = Date.parse(state.outerClearedAt);
  return Number.isFinite(clearedAt) && now.getTime() < clearedAt + famousRecoveryMs(scale) ? 'keeper' : 'outer';
}

/** 外围恢复满编的时刻（仅城守阶段有值） */
export function famousRecoversAt(state: FamousCityState, now: Date, scale: number = getTimeScale()): Date | null {
  if (famousStage(state, now, scale) !== 'keeper' || !state.outerClearedAt) {
    return null;
  }
  return new Date(Date.parse(state.outerClearedAt) + famousRecoveryMs(scale));
}

/**
 * 名城当前阶段的交战口径：外围阶段 = 野战（守方无城墙）打外围驻军；城守阶段 = 攻城战
 * （城墙减伤）打城守驻军。侦察情报与到达结算共用，两处守军 / 城墙口径恒一致。
 */
export function famousEncounter(
  npc: NpcCitySnapshot,
  now: Date,
  scale: number = getTimeScale(),
): { stage: FamousStage; garrison: Counts; siege: boolean } {
  const famous = npc.famous;
  if (!famous) {
    return { stage: 'keeper', garrison: npc.garrison, siege: true };
  }
  const stage = famousStage(famous, now, scale);
  return stage === 'outer'
    ? { stage, garrison: famous.outerGarrison, siege: false }
    : { stage, garrison: npc.garrison, siege: true };
}

/** 全图名城锚点：把地图按 3×3 划分，取中心九宫之外的 8 个格心（避开玩家出生区），互相尽量远 */
export function famousAnchors(worldSize: number): Array<{ x: number; y: number }> {
  const steps = [1 / 6, 1 / 2, 5 / 6];
  const anchors: Array<{ x: number; y: number }> = [];
  for (const fy of steps) {
    for (const fx of steps) {
      if (fx === 1 / 2 && fy === 1 / 2) {
        continue;
      }
      anchors.push({ x: Math.floor(worldSize * fx), y: Math.floor(worldSize * fy) });
    }
  }
  return anchors;
}
