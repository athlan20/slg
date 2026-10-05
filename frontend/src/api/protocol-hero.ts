// 武将协议的类型镜像（v36，AISLG-114/115/116）。唯一事实来源是 backend/common/src/protocol-hero.ts；
// protocol.ts 原名再导出。数值规则（加成 / 上限 / 俸禄）由服务端权威结算，前端只做展示。

import type { InitiatorRole } from './protocol';

/** 一名武将的视图（GET_HEROES / 推送共用） */
export interface HeroView {
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
  /** 俸禄（金币 / 小时，已按当前全局时间缩放折算） */
  salaryPerHour: number;
  /** 欠饷中（不能出征；俸禄扣款成功后自动恢复） */
  arrears: boolean;
  /** 重伤恢复时刻（ISO 8601；null = 健康） */
  woundedUntil: string | null;
  /** 正在城守的城（cities.guard_hero_id 指向本武将的城）；null = 未任城守 */
  guardCityId: string | null;
  /** 正在随行的行军 id（marches.status='marching' 且 hero_id 指向本武将）；null = 在家 */
  marchingMarchId: string | null;
  /** 满编（不摊薄）时的带兵加成；实际生效随部队规模按统率摊薄（见 heroBattleBonus） */
  bonus: { atkPercent: number; defPercent: number; leadCap: number };
  /** 城守产量加成（百分数，四资源非金；未任城守也按当前智力给出可预期值） */
  guardProductionPercent: number;
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
    | 'granted';         // 获得名将（全服另有播报）
  heroId?: string;
  /** exp_gained 时的经验与升级信息 */
  exp?: { gained: number; level: number; leveledTo: number | null };
  initiator?: InitiatorRole;
}

/** 城守视图（CityView.guard，v36 AISLG-115）：本城任命的武将；产量加成已计入 production */
export interface CityGuardView {
  heroId: string;
  name: string;
  famous: boolean;
  lead: number;
  force: number;
  wit: number;
  level: number;
  /** 产量加成（百分数） */
  bonusPercent: number;
}

/** 战报一方的随队 / 城守武将（v36 AISLG-114/115；未配将为 null / 缺省） */
export interface BattleHeroView {
  name: string;
  lead: number;
  force: number;
  wit: number;
  /** 全军攻击加成（百分数；已含统率摊薄与 20% 封顶，随部队规模生效） */
  atkPercent: number;
  /** 全军受到伤害减免（百分数；同上） */
  defPercent: number;
}

/** march_completed 事件 detail.heroExp：带队 / 城守武将本场获得的经验与升级（v36 AISLG-116） */
export interface HeroExpDetail {
  heroId: string;
  heroName: string;
  expGained: number;
  /** 本场升到的等级（没升为 null） */
  leveledTo: number | null;
  /** 带队战败重伤的恢复时刻（健康为 null） */
  woundedUntil: string | null;
}
