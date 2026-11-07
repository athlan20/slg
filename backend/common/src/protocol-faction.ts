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
