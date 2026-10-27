// 城防器械规则（v73，AISLG-193）：城墙里囤的四种一次性守城器械——陷阱 / 拒马 / 滚木 / 擂石。
// 平时花资源「打造」进库存（打造队列与征兵同模型），守城战开打时按需自动使用、用掉就没了。
// 数值为需求拍板（模拟记录见 docs/battle-calibration.md「城防器械」一节）；
// 引擎（battle-engine 的 siege 分支）、API（打造 / 取消 / 视图）、Worker（到期入库）
// 与侦察 / 战报共用本文件，不各自另实现一套。

import { RESOURCE_KEYS, type Resources, type TroopKind } from './protocol';
import { CAVALRY_KINDS } from './troop-counter';
import { scaledSeconds } from './time-scale';

/** 四种器械（稳定标识；战报 / 侦察 / 协议共用） */
export const DEFENSE_KINDS = ['trap', 'chevaux', 'rolling_log', 'boulder'] as const;
export type DefenseKind = (typeof DEFENSE_KINDS)[number];

export function isDefenseKind(value: unknown): value is DefenseKind {
  return typeof value === 'string' && (DEFENSE_KINDS as readonly string[]).includes(value);
}

/** 器械库存与用量（键缺省 = 0） */
export type DefenseStock = Partial<Record<DefenseKind, number>>;

export interface DefenseInfo {
  kind: DefenseKind;
  label: string;
  /** 触发时机：开战即触发 / 近战贴墙时触发 / 冲车贴墙时触发 */
  timing: 'battle_start' | 'wall_contact' | 'ram_contact';
  /** 对哪些兵种生效 */
  target: 'infantry' | 'cavalry' | 'wall_melee' | 'ram';
  /** 单件固定伤害（不吃防御 / 城墙减伤，按总生命比例分摊进余伤池） */
  damage: number;
  /** 单件成本 */
  cost: Resources;
  /** 单件打造基准时长（秒，未缩放） */
  seconds: number;
  /** 一句话效果说明（界面 / 文档共用） */
  effect: string;
}

/** 步兵类：陷阱的目标（不含民夫 / 斥候 / 远程 / 器械 / 冲车） */
export const INFANTRY_KINDS: TroopKind[] = ['militia', 'pikeman', 'swordsman', 'yulin_guard', 'danyang_soldier', 'baimao_soldier', 'huwei_guard'];

/** 近战：步兵类 + 骑兵类 + 冲车（滚木的目标；贴墙时才算） */
export const WALL_MELEE_KINDS: TroopKind[] = [...INFANTRY_KINDS, ...CAVALRY_KINDS, 'siege_ram'];

export const DEFENSE_INFO: Record<DefenseKind, DefenseInfo> = {
  trap: {
    kind: 'trap',
    label: '陷阱',
    timing: 'battle_start',
    target: 'infantry',
    damage: 500,
    cost: { gold: 20, wood: 60, food: 0, stone: 0, iron: 40 },
    seconds: 5,
    effect: '开战时对攻方步兵类兵种造成 500 点伤害（固定值，按各兵种总生命比例分摊）',
  },
  chevaux: {
    kind: 'chevaux',
    label: '拒马',
    timing: 'battle_start',
    target: 'cavalry',
    damage: 800,
    cost: { gold: 40, wood: 200, food: 0, stone: 0, iron: 80 },
    seconds: 10,
    effect: '开战时对攻方骑兵类兵种造成 800 点伤害（固定值，按各兵种总生命比例分摊）',
  },
  rolling_log: {
    kind: 'rolling_log',
    label: '滚木',
    timing: 'wall_contact',
    target: 'wall_melee',
    damage: 400,
    cost: { gold: 30, wood: 200, food: 0, stone: 0, iron: 0 },
    seconds: 8,
    effect: '攻方近战部队第一次贴到城墙下时，对贴墙的近战兵种造成 400 点伤害',
  },
  boulder: {
    kind: 'boulder',
    label: '擂石',
    timing: 'ram_contact',
    target: 'ram',
    damage: 1500,
    cost: { gold: 40, wood: 0, food: 0, stone: 380, iron: 0 },
    seconds: 12,
    effect: '攻方冲车第一次贴到城墙下时，对冲车造成 1500 点伤害（正好击毁 1 辆冲车）',
  },
};

/** 打造队列：同时打造中 1 条 + 排队 2 条（与征兵同模型） */
export const MAX_ACTIVE_DEFENSE_CRAFTS = 1;
export const DEFENSE_QUEUE_CAPACITY = 2;

/** 库存上限 = 城墙等级 × 60（四种器械共用；城墙 10 级 600、20 级 1200、名城 25 级 1500） */
export const DEFENSE_STOCK_PER_WALL_LEVEL = 60;

export function defenseCap(wallLevel: number): number {
  return Math.max(0, Math.floor(wallLevel)) * DEFENSE_STOCK_PER_WALL_LEVEL;
}

/** 四种器械的库存合计 */
export function defenseTotal(stock: DefenseStock): number {
  let total = 0;
  for (const kind of DEFENSE_KINDS) {
    total += Math.max(0, Math.floor(stock[kind] ?? 0));
  }
  return total;
}

/** 打造 count 件的成本 = 单件成本 × 数量 */
export function defenseCost(kind: DefenseKind, count: number): Resources {
  const n = Math.max(1, Math.floor(count));
  const base = DEFENSE_INFO[kind].cost;
  const cost: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  for (const key of RESOURCE_KEYS) {
    cost[key] = base[key] * n;
  }
  return cost;
}

/** 单件打造基准时长（秒，未缩放；与征兵 unitSeconds 同口径） */
export function defenseUnitSeconds(kind: DefenseKind): number {
  return DEFENSE_INFO[kind].seconds;
}

/** 批次打造总时长（秒）= max(1, floor(单件基准 × 数量 ÷ time_scale))——下限作用于批次总时长 */
export function defenseBatchSeconds(kind: DefenseKind, count: number): number {
  return scaledSeconds(DEFENSE_INFO[kind].seconds * Math.max(1, Math.floor(count)));
}

/** 每件器械的固定伤害 */
export function defenseDamage(kind: DefenseKind): number {
  return DEFENSE_INFO[kind].damage;
}

export type DefenseDeniedCode =
  /** 城墙未建（器械只能囤在城墙里） */
  | 'WALL_NOT_BUILT'
  /** 库存 + 在造 + 本次数量超过上限（城墙等级 × 60） */
  | 'DEFENSE_STOCK_FULL'
  /** 已有 1 条在造 + 2 条排队 */
  | 'DEFENSE_QUEUE_FULL'
  | 'INSUFFICIENT_RESOURCES';

export type StartDefenseVerdict =
  | { ok: true; kind: DefenseKind; count: number; cost: Resources; unitSeconds: number; seconds: number; mode: 'start' | 'queued' }
  | { ok: false; code: DefenseDeniedCode; cap?: number; stock?: number; pending?: number };

/**
 * 发起打造前的统一校验（顺序：城墙 → 库存上限 → 队列 → 资源）。
 * stock = 已入库件数合计；pending = 在造 + 排队件数合计；cap = 城墙等级 × 60。
 */
export function startDefenseCraft(
  kind: DefenseKind,
  count: number,
  wallLevel: number,
  stock: number,
  pending: number,
  resources: Resources,
  active: number,
  queued: number,
): StartDefenseVerdict {
  const cap = defenseCap(wallLevel);
  if (cap <= 0) {
    return { ok: false, code: 'WALL_NOT_BUILT', cap };
  }
  const n = Math.floor(count);
  if (stock + pending + n > cap) {
    return { ok: false, code: 'DEFENSE_STOCK_FULL', cap, stock, pending };
  }
  if (active >= 1 && queued >= 2) {
    return { ok: false, code: 'DEFENSE_QUEUE_FULL' };
  }
  const cost = defenseCost(kind, n);
  if (RESOURCE_KEYS.some((key) => resources[key] < cost[key])) {
    return { ok: false, code: 'INSUFFICIENT_RESOURCES' };
  }
  return {
    ok: true,
    kind,
    count: n,
    cost,
    unitSeconds: defenseUnitSeconds(kind),
    seconds: defenseBatchSeconds(kind, n),
    mode: active >= 1 ? 'queued' : 'start',
  };
}
