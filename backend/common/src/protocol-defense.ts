// 城防器械协议的类型（v73，AISLG-193；规则与数值见 common/src/city-defense.ts）。
// 类型导入在运行时被擦除，不构成加载环。

import type { InitiatorRole, Resources } from './protocol';
import type { DefenseKind } from './city-defense';
import type { ScoutDetail } from './tech';

/** 打造队列条目视图（与 RecruitView 同结构；dueAt 仅 crafting 有值） */
export interface DefenseCraftView {
  id: string;
  cityId: string;
  kind: DefenseKind;
  count: number;
  status: 'crafting' | 'queued' | 'completed' | 'cancelled';
  initiator: InitiatorRole;
  /** 发起时的成本快照（取消时全额返还） */
  cost: Resources;
  /** 单件基准时长快照（秒，未缩放） */
  unitSeconds: number;
  startedAt: string;
  dueAt: string | null;
  completedAt: string | null;
}

/** GET_STATE 的 city.defenses：库存 + 上限 + 打造队列 */
export interface DefenseStockView {
  /** 库存上限（城墙等级 × 60；四种器械共用，未建城墙为 0） */
  cap: number;
  /** 四种器械的已入库件数（恒含四个键，缺行为 0） */
  stock: Record<DefenseKind, number>;
  /** 库存合计 */
  total: number;
  /** 打造队列：第 1 项在造（status=crafting），其余排队（status=queued） */
  queue: DefenseCraftView[];
}

/** CRAFT_DEFENSE（op 117）请求：打造器械；count 为件数，cost = 单件成本 × count */
export interface CraftDefenseRequestData {
  kind: DefenseKind;
  count: number;
  /** 可选：在哪座城打造（缺省主城）；城墙等级与库存按该城判定 */
  cityId?: string;
}

export interface CraftDefenseResponseData {
  craft: DefenseCraftView;
  /** 发起后的库存快照（包含在造 / 排队数量前的入库值） */
  stock: Record<DefenseKind, number>;
  cap: number;
}

/** CANCEL_DEFENSE_CRAFT（op 118）请求 */
export interface CancelDefenseCraftRequestData {
  craftId: string;
}

export interface CancelDefenseCraftResponseData {
  craft: DefenseCraftView;
}

/** PUSH_DEFENSE_STATE（op 2026）推送：打造开始 / 排队 / 完成入库 / 取消 */
export interface DefenseStatePushData {
  reason: 'craft_started' | 'craft_queued' | 'craft_completed' | 'craft_cancelled';
  craft: DefenseCraftView;
  /** 该城当前库存（完成入库 / 取消后最有用） */
  stock: Record<DefenseKind, number>;
  cap: number;
}

/** 战报中的器械用量（一种器械一项；未触发的不出现） */
export interface DefenseUseView {
  kind: DefenseKind;
  /** 用掉几件 */
  used: number;
  /** 造成伤害（单件固定伤害 × 件数；计入守方总输出） */
  damage: number;
  /** 打掉多少兵（按余伤血池口径的实际阵亡） */
  killed: number;
}

/** 侦察情报里的器械（按侦察科技三档降级）：rough 只有有 / 无；kinds 给种类；exact 给件数 */
export interface DefenseScoutView {
  detail: ScoutDetail;
  /** 是否有器械（任何种类、任何件数 > 0） */
  has: boolean;
  /** detail='kinds' 时有值：有库存的器械种类 */
  kinds?: DefenseKind[];
  /** detail='exact' 时有值：各器械件数（恒含四个键） */
  counts?: Record<DefenseKind, number>;
}
