// 势力的压制档（AISLG-249，v107）：老巢被打掉的营越多，这家越虚——围城军更弱、吞 NPC 城更慢、
// 3 档时每周吞玩家分城的上限从 2 座降到 1 座。压制档完全由剩余营数算出来（每打掉 5 营升一档、最多 3 档），
// 不存库、不加表字段：每次读 faction_lairs.camps_remaining 现算，营恢复（24 小时没人进攻）后自动降档。
// 纯函数，不碰数据库与协议运行时；Worker（围攻发起 / 吞城 / 老巢战斗 / 营恢复）与 API（GET_FACTIONS）共用。
//
// 数值来源（需求 AISLG-249「一、规则」的表格，已定死）：
//   已打掉 0~4 营 = 0 档：围城军 100%、吞 NPC 城 6 小时、每周最多吞 2 座玩家分城；
//   已打掉 5~9 营 = 1 档：75%、9 小时、2 座；
//   已打掉 10~14 营 = 2 档：50%、12 小时、2 座；
//   已打掉 15~19 营 = 3 档：25%、15 小时、1 座。
// 灭亡（20 营全空）的势力不再有压制：调用方本来就不再给它围攻 / 吞城，面板上也按「无压制」展示。
// 不变：袭击频率与强度、势力范围半径、围攻节奏（同一座城 6 小时一次、打输 24 小时冷却）、
// 已出发的围城军（战力在发起那一刻就定好了，见 worker/src/faction-siege-tick.ts）。

import { factionSiegeWeeklyCap } from './faction-siege';
import type { FactionSuppressionView } from './protocol-faction';
import { getTimeScale } from './time-scale';

/** 压制档上限：3 档（第 4 档就是打掉 20 营 = 灭亡，不适用） */
export const FACTION_SUPPRESSION_MAX_LEVEL = 3;

/** 每打掉多少营升一档 */
export const FACTION_SUPPRESSION_CAMPS_PER_LEVEL = 5;

/** 各档的围城军战力百分比：100 / 75 / 50 / 25（向下取整、不低于 1，见 factionSiegeSuppressedPower） */
export const FACTION_SUPPRESSION_SIEGE_PERCENTS: readonly number[] = [100, 75, 50, 25];

/** 各档吞一座 NPC 城的基准间隔（小时，未缩放）：6 / 9 / 12 / 15（仍随 time_scale 缩放） */
export const FACTION_SUPPRESSION_SWALLOW_INTERVAL_HOURS: readonly number[] = [6, 9, 12, 15];

const HOUR_MS = 60 * 60 * 1000;

/** 把任意档位夹到 0..3（脏值 / 越界不影响取值） */
function levelOf(level: number): number {
  const value = Number.isFinite(level) ? Math.floor(level) : 0;
  return Math.max(0, Math.min(FACTION_SUPPRESSION_MAX_LEVEL, value));
}

/**
 * 压制档 = clamp(floor((campsTotal − campsRemaining) ÷ 5), 0, 3)。
 * 剩余营数的来源只有 faction_lairs.camps_remaining（不另存压制状态）。
 * 营数是脏值（NaN / 非有限数）时按「没有被压制」算：宁可少算压制，不因为一条脏数据悄悄削弱势力。
 */
export function suppressionLevel(campsTotal: number, campsRemaining: number): number {
  if (!Number.isFinite(campsTotal) || !Number.isFinite(campsRemaining)) {
    return 0;
  }
  const total = Math.max(0, Math.floor(campsTotal));
  const left = Math.max(0, Math.min(total, Math.floor(campsRemaining)));
  return levelOf(Math.floor((total - left) / FACTION_SUPPRESSION_CAMPS_PER_LEVEL));
}

/** 该档的围城军战力百分比（100 / 75 / 50 / 25） */
export function suppressionSiegePercent(level: number): number {
  return FACTION_SUPPRESSION_SIEGE_PERCENTS[levelOf(level)];
}

/** 该档吞一座 NPC 城的基准间隔小时数（6 / 9 / 12 / 15；展示用，未缩放） */
export function suppressionSwallowIntervalHours(level: number): number {
  return FACTION_SUPPRESSION_SWALLOW_INTERVAL_HOURS[levelOf(level)];
}

/**
 * 该档吞一座 NPC 城的实际间隔（毫秒，随 time_scale 缩放，不低于 1 秒）。
 * 每家各按自己的档位取值；「已经计时中的下一次」用「上次吞城时刻 + 新间隔」自然往后算，不立刻补吞。
 */
export function suppressionSwallowIntervalMs(level: number, scale: number = getTimeScale()): number {
  const base = suppressionSwallowIntervalHours(level) * HOUR_MS;
  return Math.max(1000, Math.round(base / Math.max(1, scale)));
}

/** 该档每周最多吞下的玩家分城数（0~2 档 2 座、3 档 1 座；本周已经吞满的不回溯） */
export function suppressionWeeklyBranchCap(level: number): number {
  return factionSiegeWeeklyCap(level);
}

/**
 * 面板 / 协议里的压制视图（GET_FACTIONS 的 factions[].suppression）：
 * 档位 + 三项效果的当前值（围城军百分比、吞城基准小时数、每周吞分城上限）。
 */
export function suppressionView(campsTotal: number, campsRemaining: number): FactionSuppressionView {
  const level = suppressionLevel(campsTotal, campsRemaining);
  return {
    level,
    siegePercent: suppressionSiegePercent(level),
    swallowIntervalHours: suppressionSwallowIntervalHours(level),
    weeklyBranchCap: suppressionWeeklyBranchCap(level),
  };
}
