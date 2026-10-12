// 在野名将（v54，AISLG-144）：29 名名将隐居在 Lv3 以上的野地里，每名固定一块地（开服时随机分配
// 并落在 world_tiles.wild_hero 上，之后不变）。打赢该野地的原住守军即获得「结交资格」，之后在武将
// 界面花金币结交、好感满 100 再招揽。名单与名城 / 黄巾的 11 名合计 40 名，全服唯一。
// 本文件只放名单与数值；分配（写库）在 wild-famous-db.ts，结交 / 招揽的存取在 hero-friendship-db.ts。

import type { FamousHeroDef } from './hero';

/** 在野名将名单（不含名城与黄巾已有的 11 名） */
export const WILD_FAMOUS_NAMES: ReadonlyArray<string> = [
  '关羽', '赵云', '诸葛亮', '刘备', '曹操', '孙权', '周瑜', '司马懿',
  '夏侯惇', '夏侯渊', '典韦', '许褚', '郭嘉', '荀彧', '程昱', '庞统',
  '魏延', '姜维', '陆逊', '太史慈', '张辽', '于禁', '文丑', '高顺',
  '严颜', '孙策', '鲁肃', '黄盖', '凌统',
];

export const WILD_FAMOUS_HEROES: ReadonlyArray<FamousHeroDef> = WILD_FAMOUS_NAMES.map((name) => ({
  name,
  source: { kind: 'wild' },
}));

/** 在野名将可落位的最低野地等级（Lv3 以上） */
export const WILD_HERO_MIN_LEVEL = 3;
/** 在野名将守军加强倍数（相对同级野地原住守军，占位，待模拟校准） */
export const WILD_GARRISON_MULTIPLIER = 2;
/** 结交一次的金币 = 500 × 野地等级（从主城扣） */
export const BEFRIEND_GOLD_PER_LEVEL = 500;
/** 结交一次的好感度增量 */
export const BEFRIEND_FAVOR_PER_TIME = 10;
/** 好感度满这个值才能招揽 */
export const RECRUIT_FAVOR_REQUIRED = 100;
/** 每个账号每个名将每个竞技日（游戏日）最多结交次数 */
export const BEFRIEND_DAILY_LIMIT = 5;
/** 同时结交（好感未满、未被他人招揽）的名将上限 */
export const BEFRIEND_ACTIVE_CAP = 2;

/** 结交一次的金币花费 */
export function befriendCost(tileLevel: number): number {
  return BEFRIEND_GOLD_PER_LEVEL * Math.max(1, Math.floor(tileLevel));
}
