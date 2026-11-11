// 五方势力（v99，AISLG-239）的协议类型镜像：唯一事实来源是 backend/common/src/protocol-faction.ts。
// 地块上的势力归属见 TileView.faction；面板数据来自 GET_FACTIONS（op 154）。

/** 五方势力标识（顺序 = 需求表从上到下，也是范围重叠时归属的 tie-break 顺序） */
export const FACTION_KEYS = ['liangzhou', 'wuhuan', 'nanman', 'shanyue', 'heishan'] as const;

export type FactionKey = (typeof FACTION_KEYS)[number];

/** 地块上的势力归属（老巢 isLair = true；被吞并的 NPC 城 isLair = false） */
export interface FactionTileView {
  key: FactionKey;
  name: string;
  nameEn: string;
  isLair: boolean;
  /** v101（AISLG-241）：这家本季已灭亡（老巢是废墟） */
  destroyed?: boolean;
}

/** 势力面板里的一家 */
export interface FactionView {
  key: FactionKey;
  name: string;
  nameEn: string;
  leader: string;
  leaderEn: string;
  lair: { x: number; y: number };
  /** 当前势力范围半径（格，切比雪夫距离） */
  radius: number;
  /** 当前持有的势力城数 */
  cityCount: number;
  /** v101（AISLG-241）：这家本季已被攻破（不再画范围、老巢是废墟） */
  destroyed: boolean;
  /** 老巢的营数（共 20 营） */
  campsTotal: number;
  /** 剩余营数（含当前营；0 = 已灭亡） */
  campsRemaining: number;
  /** 当前营剩余守军百分比 0~100 */
  campRemainingPercent: number;
  /** 当前营守军参考战力（v106，AISLG-247：按营序号递增，第 1 营最弱、第 20 营最强） */
  campPower: number;
  /** v107（AISLG-249）：这家当前的压制档与三项效果（完全由剩余营数算出） */
  suppression: FactionSuppressionView;
}

/**
 * 势力的压制档（v107，AISLG-249）：老巢被打掉的营越多，这家越虚——围城军更弱、吞 NPC 城更慢、
 * 3 档时每周吞玩家分城的上限从 2 座降到 1 座。每打掉 5 营升一档、最多 3 档；营恢复后自动降档。
 */
export interface FactionSuppressionView {
  /** 压制档 0~3（0 = 没有被压制；已灭亡的势力恒为 0） */
  level: number;
  /** 围城军战力百分比（100 / 75 / 50 / 25） */
  siegePercent: number;
  /** 吞一座 NPC 城的基准间隔小时数（6 / 9 / 12 / 15，未随 time_scale 缩放） */
  swallowIntervalHours: number;
  /** 每周最多吞下的玩家分城数（0~2 档 2 座，3 档 1 座） */
  weeklyBranchCap: number;
}

/** GET_FACTIONS 响应（开关关闭时 enabled = false、factions 为空数组） */
export interface GetFactionsResponseData {
  enabled: boolean;
  /** 本季第几天（1 起算）；未启用时为 0 */
  day: number;
  /** 当前势力范围半径；未启用时为 0 */
  radius: number;
  serverTime: string;
  factions: FactionView[];
}

// ---- 势力出兵（AISLG-240，v100）----

/** PUSH_FACTION_SIEGE（op 2030）推送原因：warning 预警 / repelled 打输 / hit 扣城防 / swallowed 城被吞 */
export type FactionSiegePushReason = 'warning' | 'repelled' | 'hit' | 'swallowed';

/** PUSH_FACTION_SIEGE（op 2030）推送载荷（镜像 backend/common/src/protocol-faction.ts） */
export interface FactionSiegePushData {
  reason: FactionSiegePushReason;
  siegeId: string;
  faction: { key: string; name: string; nameEn: string };
  cityId: string;
  cityName: string | null;
  x: number;
  y: number;
  /** 围城军参考战力 */
  power: number;
  arriveAt?: string;
  armyMin?: number;
  armyMax?: number;
  intel?: 'range' | 'kinds' | 'exact';
  beaconLevel?: number;
  armyKinds?: Partial<Record<string, { min: number; max: number }>>;
  army?: Partial<Record<string, number>>;
  durability?: number;
  damage?: number;
  durabilityAfter?: number;
  protectedUntil?: string;
}

// ---- 攻破老巢（AISLG-241，v101）----

/** PUSH_FACTION_LAIR（op 2031）推送原因：attacked 有人进攻 / recovered 恢复 1 营 / destroyed 本季灭亡 */
export type FactionLairPushReason = 'attacked' | 'recovered' | 'destroyed';

/** PUSH_FACTION_LAIR（op 2031）推送载荷（镜像 backend/common/src/protocol-faction.ts） */
export interface FactionLairPushData {
  reason: FactionLairPushReason;
  faction: { key: string; name: string; nameEn: string };
  campsTotal: number;
  campsRemaining: number;
  campRemainingPercent: number;
  destroyed: boolean;
}
