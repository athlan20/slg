// 五方势力（AISLG-239，v99）的协议类型：势力标识、地块上的势力归属与 GET_FACTIONS 的响应。
// 数值与归属判定在 faction.ts（API 与 Worker 共用）；本文件只放协议形状，不 import 规则模块
//（protocol.ts 会再导出本文件，保持「协议层不依赖规则层」的现有分工）。

/** 五方势力标识（顺序 = 需求表从上到下，也是范围重叠时归属的 tie-break 顺序） */
export const FACTION_KEYS = ['liangzhou', 'wuhuan', 'nanman', 'shanyue', 'heishan'] as const;

export type FactionKey = (typeof FACTION_KEYS)[number];

export function isFactionKey(value: unknown): value is FactionKey {
  return typeof value === 'string' && (FACTION_KEYS as readonly string[]).includes(value);
}

/**
 * 地块上的势力归属（v99，AISLG-239；TileView.faction）：
 * - 被某方吞并的 NPC 城：isLair = false；
 * - 老巢地块：isLair = true（老巢坐标对全服公开，不受战争迷雾影响）。
 * 玩家占据后地块转为城池，不再是势力城。faction_enabled 关闭时恒为 null。
 */
export interface FactionTileView {
  key: FactionKey;
  /** 中文名（如「凉州军」） */
  name: string;
  /** 英文名（如 Liangzhou Rebels） */
  nameEn: string;
  /** true = 这格是势力老巢 */
  isLair: boolean;
  /** v101（AISLG-241）：这家本季已灭亡（老巢变废墟）；范围格不再上报，只有老巢格带 true */
  destroyed?: boolean;
}

/** 势力面板里的一家（GET_FACTIONS 的 factions[]） */
export interface FactionView {
  key: FactionKey;
  /** 中文名 */
  name: string;
  /** 英文名 */
  nameEn: string;
  /** 首领（中文名） */
  leader: string;
  /** 首领（英文名） */
  leaderEn: string;
  /** 老巢坐标（对全服公开，不受战争迷雾影响） */
  lair: { x: number; y: number };
  /** 当前势力范围半径（格，切比雪夫距离）：以老巢为中心的方块；本季第 1~7 天 100、8~14 天 150、15~21 天 200、22 天起 250 */
  radius: number;
  /** 当前持有的势力城数（被玩家占下的城立即不算） */
  cityCount: number;
  /** v101（AISLG-241）：本季已被玩家攻破（灭亡）——不再显示范围、不再吞城 / 围攻、老巢是废墟 */
  destroyed: boolean;
  /** 老巢的营数（共 20 营） */
  campsTotal: number;
  /** 剩余营数（含当前营；0 = 已灭亡） */
  campsRemaining: number;
  /** 当前营剩余守军百分比（0..100；满营 100，已灭亡 0） */
  campRemainingPercent: number;
  /** 当前营守军参考战力（v106，AISLG-247：按营序号递增——第 1 营最弱、第 20 营最强；已灭亡仍给最后的值） */
  campPower: number;
  /** v107（AISLG-249）：这家当前的压制档与三项效果（完全由剩余营数算出，不存库） */
  suppression: FactionSuppressionView;
}

/**
 * 势力的压制档（v107，AISLG-249）：老巢被打掉的营越多，这家越虚——围城军更弱、吞 NPC 城更慢、
 * 3 档时每周吞玩家分城的上限从 2 座降到 1 座。每打掉 5 营升一档、最多 3 档（打掉 20 营就是灭亡，
 * 灭亡的势力不再有压制，四项都给 0 档的值）。完全由剩余营数算出：营恢复（24 小时没人进攻）后自动降档。
 */
export interface FactionSuppressionView {
  /** 压制档 0~3（0 = 没有被压制；已灭亡的势力恒为 0） */
  level: number;
  /** 围城军战力百分比（100 / 75 / 50 / 25）：围攻发起时按当时的档位定，已出发的围城军不变 */
  siegePercent: number;
  /** 吞一座 NPC 城的基准间隔小时数（6 / 9 / 12 / 15，**未**随 time_scale 缩放，便于展示） */
  swallowIntervalHours: number;
  /** 每周最多吞下的玩家分城数（0~2 档 2 座，3 档 1 座；本周已经吞满的不回溯） */
  weeklyBranchCap: number;
}

/** GET_FACTIONS（op 154）响应载荷；faction_enabled 关闭时 enabled = false、factions 为空数组 */
export interface GetFactionsResponseData {
  /** 势力总开关（settings 表 faction_enabled，默认关闭） */
  enabled: boolean;
  /** 本季第几天（1 起算，按本季实际开始时间，不随 time_scale 变化）；未启用时为 0 */
  day: number;
  /** 本季当前的势力范围半径（同一季五家相同）；未启用时为 0 */
  radius: number;
  /** 服务端时刻（ISO 8601）：客户端据此推算半径下一次变化的时刻 */
  serverTime: string;
  /** 五方势力；未启用（或本季尚未生成老巢）时为空数组 */
  factions: FactionView[];
}

// ---- 攻破老巢（AISLG-241，v101）----

/**
 * PUSH_FACTION_LAIR（op 2031）推送原因（v101，AISLG-241）：
 * - attacked：有人打了老巢（守军残血 / 打掉一营都在这里，看 campsRemaining 判定）；
 * - recovered：连续 24 小时没人进攻，恢复 1 营；
 * - destroyed：最后一营被清空，这家本季灭亡。
 * 全服在线连接都收到（老巢是全服目标）；等价的全服播报见 faction_lair_destroyed。
 */
export type FactionLairPushReason = 'attacked' | 'recovered' | 'destroyed';

/** PUSH_FACTION_LAIR（op 2031）推送载荷（v101，AISLG-241） */
export interface FactionLairPushData {
  reason: FactionLairPushReason;
  faction: FactionBanner;
  campsTotal: number;
  campsRemaining: number;
  /** 当前营剩余百分比（0..100） */
  campRemainingPercent: number;
  /** 这家本季是否已灭亡（reason = destroyed 时必为 true） */
  destroyed: boolean;
}

// ---- 势力出兵（AISLG-240，v100）----

/**
 * 势力旗号（v100）：API 与 Worker 在袭击预警 / 围攻预警 / 事件 / 战报文案里带上它是哪一家。
 * 不在任何势力范围内的袭击没有这个字段（与上线前一致）。
 */
export interface FactionBanner {
  key: FactionKey;
  /** 中文名（如「南蛮」） */
  name: string;
  /** 英文名（如 Nanman） */
  nameEn: string;
}

/**
 * PUSH_FACTION_SIEGE（op 2030）推送原因（v100，AISLG-240）：
 * - warning：围攻预警（提前 60 分钟 × 烽火台加成，被围城的主人与其城里的协防方都收到）；
 * - repelled：这家势力打输了（守住了，该势力 24 小时内不再打这座城）；
 * - hit：这家势力打赢了一次，城防被扣、城进入 4 小时被动免战；
 * - swallowed：城防归零、城被吞下（变成该势力的 NPC 城，原主人腾出分城名额）。
 */
export type FactionSiegePushReason = 'warning' | 'repelled' | 'hit' | 'swallowed';

/** PUSH_FACTION_SIEGE（op 2030）推送载荷（v100，AISLG-240）；等价事件见 faction_siege_warning / faction_siege / faction_city_lost */
export interface FactionSiegePushData {
  reason: FactionSiegePushReason;
  /** 围攻编号（faction_sieges.id；warning 时客户端可用于去重） */
  siegeId: string;
  faction: FactionBanner;
  cityId: string;
  /** 城池名（城被吞后仍给出原名；查不到时为 null） */
  cityName: string | null;
  x: number;
  y: number;
  /** 围城军参考战力 */
  power: number;
  /** 预警：预计到达时刻（ISO 8601） */
  arriveAt?: string;
  /** 预警：围城军兵力范围（+/-20% 取整，与 NPC 袭击预警同口径） */
  armyMin?: number;
  armyMax?: number;
  /** 预警：敌情详细度（由被围城的烽火台等级决定，与来袭预警同一套） */
  intel?: 'range' | 'kinds' | 'exact';
  beaconLevel?: number;
  armyKinds?: Partial<Record<import('./protocol-army').TroopKind, { min: number; max: number }>>;
  army?: Partial<Record<import('./protocol-army').TroopKind, number>>;
  /** 被围城当前城防值（预警与 hit / swallowed 都给） */
  durability?: number;
  /** hit：这次扣除的城防值与扣完后的值 */
  damage?: number;
  durabilityAfter?: number;
  /** hit：城进入被动免战的截止时刻（ISO 8601） */
  protectedUntil?: string;
}
