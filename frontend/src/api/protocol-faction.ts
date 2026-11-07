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
