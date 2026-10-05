// 武将系统的共用规则（v36，AISLG-114/115/116）：酒馆招将、带兵加成、俸禄与重伤、
// 名将（全服唯一、从 PvE 获得）、城守、经验与成长。旧游戏只取玩法结构，
// 不照搬数值。
// API（招募 / 解雇 / 城守 / 出征配将校验）、Worker（俸禄 / 战斗结算 / 名将授予）与
// 前端镜像共用本文件，不各自再实现一套数值；全部数值为占位，上线后按数据调整。

import type { TroopKind } from './protocol';

/** 普通将三项属性随机范围 */
export const HERO_ATTR_MIN = 10;
export const HERO_ATTR_MAX = 40;
/** 名将三项属性随机范围（比普通将高，但加成仍受 20% 封顶） */
export const FAMOUS_ATTR_MIN = 45;
export const FAMOUS_ATTR_MAX = 65;
/** 酒馆候选刷新周期（基准小时，随全局时间缩放） */
export const TAVERN_REFRESH_HOURS = 4;
/** 每次刷新的候选数量 */
export const TAVERN_CANDIDATE_COUNT = 3;
/** 招募费 = 基础 + 三项属性合计 × 系数（金币） */
export const RECRUIT_BASE_GOLD = 500;
export const RECRUIT_GOLD_PER_ATTR = 20;
/** 账号普通将上限 = ⌈酒馆最高等级 ÷ 2⌉ + 1（酒馆取账号所有城中的最高等级） */
export function normalHeroCap(maxTavernLevel: number): number {
  return Math.ceil(Math.max(0, Math.floor(maxTavernLevel)) / 2) + 1;
}
/** 账号名将上限（不占普通将上限） */
export const FAMOUS_HERO_CAP = 3;
/** 统率：能吃到加成的兵数 = 统率 × 20；部队超出时加成按比例摊薄 */
export const LEAD_TROOPS_PER_POINT = 20;
/** 武力：全军攻击 + 武力 × 0.3%（封顶 20%） */
export const ATK_PERCENT_PER_FORCE = 0.3;
/** 智力：全军受到伤害 − 智力 × 0.3%（封顶 20%） */
export const DEF_PERCENT_PER_WIT = 0.3;
/** 攻击 / 减伤加成各自封顶（百分数），保证现有 PvE 难度不被打穿 */
export const HERO_BONUS_CAP_PERCENT = 20;
/** 俸禄（金币 / 小时，基准速率随全局时间缩放）：普通将 20 × 等级、名将 100 × 等级 */
export const SALARY_PER_LEVEL_NORMAL = 20;
export const SALARY_PER_LEVEL_FAMOUS = 100;
/** 带队战败后的重伤时长（基准小时，随全局时间缩放）；期间不能出征，不会死亡 */
export const WOUND_HOURS = 2;
/** 等级上限 */
export const HERO_LEVEL_MAX = 20;
/** 升到 L+1 级需要的经验 = 100 × L²（占位） */
export function expForNextLevel(level: number): number {
  return 100 * Math.max(1, Math.floor(level)) ** 2;
}
/** 每升一级三项属性各 + 的值：普通将 +1、名将 +2 */
export function attrGainPerLevel(famous: boolean): number {
  return famous ? 2 : 1;
}
/** 城守：平时该城四资源产量 + 智力 × 0.1%（封顶 5%；金币不受影响） */
export const GUARD_PROD_PERCENT_PER_WIT = 0.1;
export const GUARD_PROD_CAP_PERCENT = 5;

/** 普通将随机名（姓 + 名拼接，rng 注入便于测试） */
const SURNAMES = '赵钱孙李周吴郑王冯陈卫蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜'.split('');
const GIVEN = '云长翼德子龙孟起汉升文远文丑公瑾子敬伯符仲谋玄德仲颖奉先伯圭'.split('');

export function rollHeroName(rng: () => number): string {
  const surname = SURNAMES[Math.floor(rng() * SURNAMES.length)];
  const given = GIVEN[Math.floor(rng() * GIVEN.length)];
  return `${surname}${given}`;
}

export interface HeroAttrs {
  lead: number;
  force: number;
  wit: number;
}

function rollAttr(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** 随机一名普通将（三项各 10–40） */
export function rollNormalHero(rng: () => number): { name: string } & HeroAttrs {
  return {
    name: rollHeroName(rng),
    lead: rollAttr(rng, HERO_ATTR_MIN, HERO_ATTR_MAX),
    force: rollAttr(rng, HERO_ATTR_MIN, HERO_ATTR_MAX),
    wit: rollAttr(rng, HERO_ATTR_MIN, HERO_ATTR_MAX),
  };
}

/** 随机一名名将（三项各 45–65；名字由授予方指定，全服唯一） */
export function rollFamousAttrs(rng: () => number): HeroAttrs {
  return {
    lead: rollAttr(rng, FAMOUS_ATTR_MIN, FAMOUS_ATTR_MAX),
    force: rollAttr(rng, FAMOUS_ATTR_MIN, FAMOUS_ATTR_MAX),
    wit: rollAttr(rng, FAMOUS_ATTR_MIN, FAMOUS_ATTR_MAX),
  };
}

/** 招募费（金币）= 500 + 三项属性合计 × 20 */
export function recruitCost(attrs: HeroAttrs): number {
  return RECRUIT_BASE_GOLD + (attrs.lead + attrs.force + attrs.wit) * RECRUIT_GOLD_PER_ATTR;
}

/** 俸禄（金币 / 小时基准值，结算时随时间缩放） */
export function salaryPerHour(level: number, famous: boolean): number {
  return (famous ? SALARY_PER_LEVEL_FAMOUS : SALARY_PER_LEVEL_NORMAL) * Math.max(1, Math.floor(level));
}

/** 武将在一场战斗中的实际生效加成（引擎与战报共用同口径） */
export interface HeroBattleBonus {
  /** 全军攻击加成（百分数，已含统率摊薄与 20% 封顶） */
  atkPercent: number;
  /** 全军受到伤害减免（百分数，已含统率摊薄与 20% 封顶） */
  defPercent: number;
  /** 能吃到加成的兵数上限 = 统率 × 20 */
  leadCap: number;
  /** 统率摊薄系数（0..1；部队超出上限时 < 1） */
  scale: number;
}

/**
 * 武将带兵加成（v36，AISLG-114）：攻击 + 武力 × 0.3%、减伤 + 智力 × 0.3%，各自封顶 20%；
 * 能吃到加成的兵数 = 统率 × 20，部队（troopCount）超出时加成按 leadCap ÷ troopCount 摊薄。
 * troopCount 缺省按恰好吃满（不摊薄）计算（界面展示用）。
 */
export function heroBattleBonus(attrs: HeroAttrs, troopCount?: number): HeroBattleBonus {
  const leadCap = attrs.lead * LEAD_TROOPS_PER_POINT;
  const scale = troopCount === undefined || troopCount <= 0 ? 1 : Math.min(1, leadCap / troopCount);
  const atkRaw = Math.min(HERO_BONUS_CAP_PERCENT, attrs.force * ATK_PERCENT_PER_FORCE);
  const defRaw = Math.min(HERO_BONUS_CAP_PERCENT, attrs.wit * DEF_PERCENT_PER_WIT);
  return {
    atkPercent: Math.round(atkRaw * scale * 10) / 10,
    defPercent: Math.round(defRaw * scale * 10) / 10,
    leadCap,
    scale: Math.round(scale * 1000) / 1000,
  };
}

/** 城守的四资源产量加成（百分数，非金币；智力 × 0.1% 封顶 5%） */
export function guardProductionPercent(wit: number): number {
  return Math.min(GUARD_PROD_CAP_PERCENT, wit * GUARD_PROD_PERCENT_PER_WIT);
}

export interface HeroExpResult {
  level: number;
  exp: number;
  /** 本次升到的最高等级（没升为 null） */
  leveledTo: number | null;
  /** 本次升了几级（属性成长 = 升级数 × attrGainPerLevel） */
  levelsGained: number;
}

/**
 * 经验与成长（v36，AISLG-116）：带队参战获得经验 = 本场歼灭敌军的参考战力
 * （战败减半由调用方先乘好再传入），升到 L+1 级需要 100 × L²；每升一级三项属性
 * 各 +1（名将 +2），封顶 20 级（满级后经验照加、不再升级）。
 */
export function applyHeroExp(
  level: number,
  exp: number,
  gained: number,
  famous: boolean,
): HeroExpResult {
  let lv = Math.max(1, Math.floor(level));
  let total = Math.max(0, Math.floor(exp)) + Math.max(0, Math.floor(gained));
  const from = lv;
  while (lv < HERO_LEVEL_MAX && total >= expForNextLevel(lv)) {
    total -= expForNextLevel(lv);
    lv += 1;
  }
  return { level: lv, exp: total, leveledTo: lv > from ? lv : null, levelsGained: lv - from };
}

// ---- 名将定义（v36，AISLG-115）：只从 PvE 获得，全服唯一 ----

/** 名将来源标识 */
export type FamousHeroSource =
  | { kind: 'famous_city'; cityName: string }
  | { kind: 'yt_boss' }
  | { kind: 'yt_rank'; rank: 1 | 2 };

export interface FamousHeroDef {
  /** 名将名（全服唯一键） */
  name: string;
  source: FamousHeroSource;
}

/** 名城 → 绑定名将（顺序对应 famous-city.ts 的 FAMOUS_CITY_NAMES） */
export const FAMOUS_CITY_HEROES: ReadonlyArray<FamousHeroDef> = [
  { name: '颜良', source: { kind: 'famous_city', cityName: '官渡' } },
  { name: '徐晃', source: { kind: 'famous_city', cityName: '许昌' } },
  { name: '吕布', source: { kind: 'famous_city', cityName: '洛阳' } },
  { name: '马超', source: { kind: 'famous_city', cityName: '长安' } },
  { name: '张飞', source: { kind: 'famous_city', cityName: '成都' } },
  { name: '甘宁', source: { kind: 'famous_city', cityName: '建业' } },
  { name: '黄忠', source: { kind: 'famous_city', cityName: '襄阳' } },
  { name: '张郃', source: { kind: 'famous_city', cityName: '邺城' } },
];

/** 黄巾之乱名将：老巢首杀 = 张角；贡献榜第 1、2 名 = 张宝、张梁 */
export const YT_HERO_BOSS: FamousHeroDef = { name: '张角', source: { kind: 'yt_boss' } };
export const YT_HERO_RANKS: ReadonlyArray<FamousHeroDef> = [
  { name: '张宝', source: { kind: 'yt_rank', rank: 1 } },
  { name: '张梁', source: { kind: 'yt_rank', rank: 2 } },
];

/** 名将来源 → 全部定义（视图 / 授予共用） */
export const ALL_FAMOUS_HEROES: ReadonlyArray<FamousHeroDef> = [...FAMOUS_CITY_HEROES, YT_HERO_BOSS, ...YT_HERO_RANKS];

/** 按名城名反查绑定名将 */
export function famousHeroForCity(cityName: string): FamousHeroDef | null {
  return FAMOUS_CITY_HEROES.find((def) => def.source.kind === 'famous_city' && def.source.cityName === cityName) ?? null;
}

/** 来源的人读描述（播报 / 事件 / 界面共用） */
export function famousSourceLabel(source: FamousHeroSource): string {
  if (source.kind === 'famous_city') {
    return `首占名城「${source.cityName}」`;
  }
  if (source.kind === 'yt_boss') {
    return '黄巾老巢首杀';
  }
  return `黄巾之乱贡献榜第 ${source.rank} 名`;
}

/** 来源的稳定标识（存 famous_heroes.source） */
export function famousSourceKey(source: FamousHeroSource): string {
  if (source.kind === 'famous_city') {
    return `famous_city:${source.cityName}`;
  }
  if (source.kind === 'yt_boss') {
    return 'yt_boss';
  }
  return `yt_rank:${source.rank}`;
}

/** 统率上限内的满编展示（出征表单预览用） */
export function armyTotal(troops: Partial<Record<TroopKind, number>>): number {
  return Object.values(troops).reduce((sum, count) => sum + Math.max(0, Math.floor(count ?? 0)), 0);
}
