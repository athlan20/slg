// 将星塔规则（v55，AISLG-146）：单机爬塔。固定 100 层，每层是一组系统预设的敌方武将（按层号生成，
// 固定种子，同一层永远一样，不入库）。玩家排好的阵容（与竞技场共用）逐层挑战，只能打「已通过的最高层 + 1」。
// 对战沿用竞技场的三局两胜（playArenaMatch），不消耗真实兵力、不改武将状态。第一次通过某层发奖励，
// 之后重打不再发。本文件只放纯规则与数值（占位，上线前按校准与经济核对），存取在 star-tower-db.ts，
// API 与 Worker 共用，两侧不得各自另算。

import { ALL_FAMOUS_HEROES, rollHeroName } from './hero';
import { seededRng, type ArenaFighter } from './arena';

// ---- 数值（全部占位，上线前按模拟校准与经济核对） ----

/** 塔的总层数 */
export const STAR_TOWER_FLOORS = 100;
/** 每隔多少层是 Boss 层 */
export const STAR_TOWER_BOSS_EVERY = 10;
/** 敌方属性的基础值（第 1 层）；占位 */
export const STAR_TOWER_BASE_ATTR = 22;
/** 每层敌方属性增加量；占位（第 100 层约 82，已超出普通将上限，名将 / 幻影之外的强度留待校准） */
export const STAR_TOWER_ATTR_PER_FLOOR = 0.6;
/** Boss 层敌方属性额外加成；占位 */
export const STAR_TOWER_BOSS_ATTR_BONUS = 12;
/** 首通奖励金币：基础 + 每层 × 层号，Boss 层再加 BOSS_GOLD；占位 */
export const STAR_TOWER_GOLD_BASE = 2_000;
export const STAR_TOWER_GOLD_PER_FLOOR = 500;
export const STAR_TOWER_BOSS_GOLD = 20_000;
/** 首通奖励武将经验（给阵容里每名武将）：基础 + 每层 × 层号，Boss 层翻倍；占位 */
export const STAR_TOWER_EXP_BASE = 40;
export const STAR_TOWER_EXP_PER_FLOOR = 4;
/** 每人保留的战报条数（超出的旧战报在写入新战报时删除） */
export const STAR_TOWER_REPORT_KEEP = 50;

/** 三个号位的属性偏移（统率型 / 武力型 / 智力型），与竞技场系统守擂者同一套写法 */
const ENEMY_OFFSETS: ReadonlyArray<[number, number, number]> = [
  [6, -3, -3],
  [-3, 6, -3],
  [-3, -3, 6],
];

/** 是否 Boss 层（每 BOSS_EVERY 层，即第 10、20、…… 层） */
export function isStarTowerBossFloor(floor: number): boolean {
  return floor > 0 && floor % STAR_TOWER_BOSS_EVERY === 0;
}

/** 每层敌方武将数：固定 3 名，与竞技场三个号位一一对应，不会出现缺人轮空（原 1–3 名递增方案因轮空被判必胜，v55 改为固定 3 名） */
export const STAR_TOWER_ENEMY_COUNT = 3;

/** 某层敌方的基础属性（三项的中位数，各号位在此上下偏移） */
export function starTowerBaseAttr(floor: number): number {
  const bossBonus = isStarTowerBossFloor(floor) ? STAR_TOWER_BOSS_ATTR_BONUS : 0;
  return Math.round(STAR_TOWER_BASE_ATTR + floor * STAR_TOWER_ATTR_PER_FLOOR + bossBonus);
}

/**
 * 某层的敌方阵容（按层号确定，固定种子）。普通层用随机武将名；Boss 层用名将的「幻影」——
 * 只借名将的名字做展示，不对应真实武将，不影响名将全服唯一的规则。
 */
export function starTowerFloorEnemies(floor: number): ArenaFighter[] {
  const rng = seededRng(0x5a7 * 1000 + floor);
  const base = starTowerBaseAttr(floor);
  const level = Math.max(1, Math.round(base / 3));
  const boss = isStarTowerBossFloor(floor);
  const count = STAR_TOWER_ENEMY_COUNT;
  const out: ArenaFighter[] = [];
  for (let i = 0; i < count; i += 1) {
    const [dl, df, dw] = ENEMY_OFFSETS[i];
    const name = boss
      ? `${ALL_FAMOUS_HEROES[(floor / STAR_TOWER_BOSS_EVERY + i) % ALL_FAMOUS_HEROES.length].name}·幻影`
      : rollHeroName(rng);
    out.push({
      name,
      lead: Math.max(1, base + dl),
      force: Math.max(1, base + df),
      wit: Math.max(1, base + dw),
      level,
    });
  }
  return out;
}

/** 某层首通奖励（金币与武将经验；经验按阵容里每名武将各得一份） */
export function starTowerReward(floor: number): { gold: number; exp: number } {
  const boss = isStarTowerBossFloor(floor);
  const gold = STAR_TOWER_GOLD_BASE + floor * STAR_TOWER_GOLD_PER_FLOOR + (boss ? STAR_TOWER_BOSS_GOLD : 0);
  const exp = (STAR_TOWER_EXP_BASE + floor * STAR_TOWER_EXP_PER_FLOOR) * (boss ? 2 : 1);
  return { gold, exp };
}

/** 下一层（已通过最高层 + 1）；全部通关返回 null */
export function nextStarTowerFloor(bestFloor: number): number | null {
  const next = Math.max(0, Math.floor(bestFloor)) + 1;
  return next <= STAR_TOWER_FLOORS ? next : null;
}
