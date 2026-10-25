// 武将协议的类型与视图（v36，AISLG-114/115/116；从 protocol.ts 拆出以控制单文件行数）。
// 武将规则与数值见 common/src/hero.ts，数据库存取见 common/src/hero-db.ts。

import type { InitiatorRole } from './protocol';
import type { HeroAttrs } from './hero';
import type { TrainingTier } from './hero-growth';
import type { HeroSpecialty } from './hero-specialty';

/** 历练中的武将（v54）：档位 / 结束时刻（ISO 8601）/ 到点获得的经验；未历练为 null */
export interface HeroTrainingView {
  tier: TrainingTier;
  endsAt: string;
  exp: number;
}

/** 一名武将的视图（GET_HEROES / 推送共用） */
export interface HeroView {
  /** Random and immutable on ordinary recruitment; famous and legacy heroes have null. */
  specialty: HeroSpecialty | null;
  specialtyBonus: { atkPercent: number; defPercent: number; siegeOnly: boolean } | null;
  id: string;
  name: string;
  /** 名将（全服唯一、从 PvE 获得；普通将 false） */
  famous: boolean;
  lead: number;
  force: number;
  wit: number;
  level: number;
  exp: number;
  /** 升到下一级还需要的经验（满级为 0） */
  expNext: number;
  /** 未分配的自由点数（升级获得，手动分到统率 / 武力 / 智力；v54） */
  freePoints: number;
  /** 俸禄（金币 / 小时，已按当前全局时间缩放折算） */
  salaryPerHour: number;
  /** 欠饷中（不能出征；俸禄扣款成功后自动恢复） */
  arrears: boolean;
  /** 重伤恢复时刻（ISO 8601；null = 健康） */
  woundedUntil: string | null;
  /** 历练中（v54）：档位、结束时刻与到点经验；未历练为 null（历练中不能带兵 / 城守 / 加点 / 洗点 / 解雇） */
  training: HeroTrainingView | null;
  /** 正在城守的城（cities.guard_hero_id 指向本武将的城）；null = 未任城守 */
  guardCityId: string | null;
  /** 正在随行的行军 id（marches.status='marching' 且 hero_id 指向本武将）；null = 在家 */
  marchingMarchId: string | null;
  /** 满编（不摊薄）时的带兵加成；实际生效随部队规模按统率摊薄（见 heroBattleBonus） */
  bonus: { atkPercent: number; defPercent: number; leadCap: number };
  /** 城守产量加成（百分数，四资源非金；未任城守也按当前智力给出可预期值） */
  guardProductionPercent: number;
  /** 今日剩余次数（游戏日重置，v54）：赏赐 / 洗点 */
  dailyLeft: { gift: number; reset: number };
}

/** 一名在野名将的结交进度（v54，只列本账号结交过或拥有结交资格的名将） */
export interface FriendshipView {
  heroName: string;
  /** 好感度 0..100，满 100 可招揽 */
  favor: number;
  /** 本游戏日还能结交的次数 */
  todayLeft: number;
  /** 下一次结交的金币花费（= 500 × 野地等级） */
  cost: number;
  /** 已被他人招揽（好感作废，不计入同时结交上限） */
  lost: boolean;
}

/** 酒馆候选武将视图 */
export interface HeroCandidateView {
  id: string;
  name: string;
  lead: number;
  force: number;
  wit: number;
  /** 招募费（金币，从该酒馆所在城扣除） */
  cost: number;
  /** 本批候选刷新时刻（ISO 8601；下一批 = 此时刻 + 4 小时基准 ÷ 时间缩放） */
  refreshedAt: string;
}

/** 名将全服归属视图（GET_HEROES 一并返回，公开信息） */
export interface FamousClaimView {
  name: string;
  /** 来源的人读描述，如「首占名城『洛阳』」 */
  sourceLabel: string;
  /** 当前主人用户名；null = 尚未被获得（可争取） */
  ownerUsername: string | null;
  grantedAt: string | null;
  /** 在野名将的落位野地（坐标与等级）；名城 / 黄巾为 null。被获得后仍保留落位信息 */
  wildAt: { x: number; y: number; level: number } | null;
}

/** GET_HEROES（op 49）请求：可选 cityId（缺省主城），指定看哪座城的酒馆候选 */
export interface GetHeroesRequestData {
  cityId?: string;
}

export interface HeroStateView {
  /** 查询城（酒馆候选视角） */
  cityId: string;
  /** 查询城的酒馆等级（0 = 未建） */
  tavernLevel: number;
  /** 账号所有城中酒馆的最高等级（决定普通将上限） */
  maxTavernLevel: number;
  /** 普将将上限 = ⌈最高酒馆等级 ÷ 2⌉ + 1；名将另算（famousCap） */
  normalCap: number;
  /** 普通将当前数量 */
  normalCount: number;
  /** 名将上限（固定 3，不占普通将上限） */
  famousCap: number;
  /** 名将当前数量 */
  famousCount: number;
  /** 本账号全部武将 */
  heroes: HeroView[];
  /** 该城酒馆当前候选（酒馆未建为空数组） */
  candidates: HeroCandidateView[];
  /** 全部名将的归属（含未获得） */
  famousClaims: FamousClaimView[];
  /** 结交进度（v54）：本账号结交过的在野名将 */
  friendships: FriendshipView[];
  /** 结交资格（v54）：打赢过其所在野地守军、且尚未被他人获得的在野名将名 */
  unlocks: string[];
  /** 同时结交上限（v54，固定 2） */
  friendshipCap: number;
}

export type GetHeroesResponseData = HeroStateView;

/** RECRUIT_HERO（op 50）请求：从某座城的酒馆候选中招募一名武将 */
export interface RecruitHeroRequestData {
  candidateId: string;
}

export interface RecruitHeroResponseData {
  hero: HeroView;
  /** 招募后该城剩余候选（同批其他候选保留） */
  candidates: HeroCandidateView[];
}

/** DISMISS_HERO（op 51）请求：解雇武将（直接消失；名将解雇后回到可获得状态） */
export interface DismissHeroRequestData {
  heroId: string;
}

export interface DismissHeroResponseData {
  heroId: string;
}

/** ASSIGN_HERO（op 52）请求：任命 / 撤换城守（heroId=null 撤任） */
export interface AssignHeroRequestData {
  /** 可选：目标城（缺省当前会话城）；每城至多一名城守，一名武将至多守一城 */
  cityId?: string;
  /** 武将 id；null 或缺省 = 撤任 */
  heroId?: string | null;
}

export interface AssignHeroResponseData {
  cityId: string;
  /** 任命后的城守（撤任为 null） */
  guard: HeroView | null;
}

/** PUSH_HERO_STATE（op 2016）推送载荷：账号全部在线连接收到（含 Agent） */
export interface HeroStatePushData {
  reason:
    | 'recruited'        // 招募成功
    | 'dismissed'        // 解雇
    | 'guard_changed'    // 城守任命 / 撤任
    | 'arrears'          // 欠饷开始
    | 'salary_paid'      // 欠饷恢复（扣款成功）
    | 'wounded'          // 带队战败重伤
    | 'exp_gained'       // 战斗获得经验 / 升级
    | 'granted'          // 获得名将（全服另有播报）
    | 'training_started' // 开始历练（v54）
    | 'training_done'    // 历练结束，经验已到账（v54）
    | 'training_cancelled' // 历练被取消，武将回城、不给经验（v71，AISLG-190）
    | 'points_changed'   // 加点 / 洗点（v54）
    | 'gifted'           // 赏赐（v54）
    | 'friendship_changed'; // 结交进度变化（v54）
  heroId?: string;
  /** exp_gained 时的经验与升级信息 */
  exp?: { gained: number; level: number; leveledTo: number | null };
  initiator?: InitiatorRole;
}

// ---- 武将培养（v54，AISLG-144）：加点 / 洗点 / 历练 / 赏赐 / 结交 / 招揽 ----

/** ALLOCATE_HERO_POINTS（op 77）请求：把自由点数分到三项属性（各为非负整数，合计 ≥ 1） */
export interface AllocateHeroPointsRequestData {
  heroId: string;
  lead?: number;
  force?: number;
  wit?: number;
}

/** RESET_HERO_POINTS（op 78）请求：洗点，已分配的点数全部退回自由点数 */
export interface ResetHeroPointsRequestData {
  heroId: string;
}

/** TRAIN_HERO（op 79）请求：派武将历练（档位 1 / 2 / 3 = 1 / 4 / 12 小时基准） */
export interface TrainHeroRequestData {
  heroId: string;
  tier: TrainingTier;
}

/** GIFT_HERO（op 80）请求：赏赐武将（花金币加经验） */
export interface GiftHeroRequestData {
  heroId: string;
}

/** BEFRIEND_HERO（op 81）请求：结交一名在野名将（需先打赢其所在野地守军） */
export interface BefriendHeroRequestData {
  heroName: string;
}

export interface BefriendHeroResponseData {
  friendship: FriendshipView;
}

/** ALLOCATE_HERO_POINTS / RESET_HERO_POINTS / TRAIN_HERO / GIFT_HERO 的响应：变更后的武将视图 */
export interface HeroOnlyResponseData {
  hero: HeroView;
}

/** RECRUIT_FAMOUS_HERO（op 82）请求：好感满 100 后招揽在野名将 */
export interface RecruitFamousHeroRequestData {
  heroName: string;
}

export interface RecruitFamousHeroResponseData {
  hero: HeroView;
}
