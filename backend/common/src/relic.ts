// 遗迹与名将处所的静态配置（AISLG-227，v93）：遗迹的品质 / 种类 / 数量 / 奖励、名将处所名单、
// 首探奖励与每日上限，以及按世界种子挑点的纯函数（不碰数据库，API 与 Worker 共用）。
// 数据库侧的读写见 fog-relic-db.ts；行军领取见 worker/src/fog-relic-claim.ts。
import type { RelicKind, RelicTier } from './protocol-world';
import type { Resources } from './protocol';
import type { ItemId } from './items';

export type { RelicKind, RelicTier };

export interface RelicDef {
  kind: RelicKind;
  tier: RelicTier;
  /** 本季数量 */
  count: number;
  /** 领取奖励（发到主城，可超过仓库上限） */
  reward: Resources;
  /** 附加道具（传说遗迹的迁城令） */
  items: Partial<Record<ItemId, number>>;
}

/** 八种遗迹（需求第二节「分布」）：同一品质的总价值相同，种类只决定偏向哪种资源 */
export const RELIC_DEFS: readonly RelicDef[] = [
  { kind: 'granary', tier: 'common', count: 32, reward: { gold: 500, wood: 500, food: 3000, stone: 500, iron: 500 }, items: {} },
  { kind: 'lumberyard', tier: 'common', count: 32, reward: { gold: 500, wood: 3000, food: 500, stone: 500, iron: 500 }, items: {} },
  { kind: 'quarry', tier: 'common', count: 32, reward: { gold: 500, wood: 500, food: 500, stone: 3000, iron: 500 }, items: {} },
  { kind: 'ironworks', tier: 'common', count: 32, reward: { gold: 500, wood: 500, food: 500, stone: 500, iron: 3000 }, items: {} },
  { kind: 'caravan', tier: 'common', count: 32, reward: { gold: 3000, wood: 500, food: 500, stone: 500, iron: 500 }, items: {} },
  { kind: 'battlefield', tier: 'rare', count: 18, reward: { gold: 3500, wood: 1000, food: 1000, stone: 1000, iron: 3500 }, items: {} },
  { kind: 'treasury', tier: 'rare', count: 17, reward: { gold: 2000, wood: 2000, food: 2000, stone: 2000, iron: 2000 }, items: {} },
  { kind: 'mausoleum', tier: 'legendary', count: 5, reward: { gold: 5000, wood: 5000, food: 5000, stone: 5000, iron: 5000 }, items: { city_order: 1 } },
];

/** 遗迹总数（200 处） */
export const RELIC_TOTAL = RELIC_DEFS.reduce((sum, def) => sum + def.count, 0);
/** 任意两处遗迹的最小间距（Chebyshev，格） */
export const RELIC_MIN_SPACING = 30;
/** 每账号每北京日最多领取的遗迹数 */
export const RELIC_DAILY_LIMIT = 2;

/** 遗迹定义查找（未知种类返回 undefined） */
export function relicDef(kind: string): RelicDef | undefined {
  return RELIC_DEFS.find((def) => def.kind === kind);
}

/** 名将处所（需求第三节）：名将 → 处所名（中文）；英文名见前端文案 */
export const HERO_SITES: ReadonlyArray<{ hero: string; name: string }> = [
  { hero: '诸葛亮', name: '茅庐' },
  { hero: '关羽', name: '关公庙' },
  { hero: '赵云', name: '子龙庙' },
  { hero: '刘备', name: '桃园' },
  { hero: '曹操', name: '铜雀台' },
  { hero: '孙权', name: '甘露寺' },
  { hero: '周瑜', name: '点将台' },
  { hero: '司马懿', name: '司马故里' },
];

/** 名将处所首探奖励（发到主城）；结交资格另外发放（名将未被招揽时） */
export const HERO_SITE_FIRST_REWARD: Resources = { gold: 5000, wood: 2500, food: 2500, stone: 2500, iron: 2500 };
/** 名城首探奖励（发到主城）；另附高级迁城令 1 张 */
export const FAMOUS_FIRST_REWARD: Resources = { gold: 10000, wood: 5000, food: 5000, stone: 5000, iron: 5000 };
export const FAMOUS_FIRST_ITEMS: Partial<Record<ItemId, number>> = { city_order_adv: 1 };

/** 首探登记的键：名城 `famous:<名城名>`，名将处所 `site:<名将名>` */
export function famousFirstKey(name: string): string {
  return `famous:${name}`;
}
export function heroSiteFirstKey(hero: string): string {
  return `site:${hero}`;
}

/** 遗迹随机挑点的种子盐（与世界种子错开，避免与地图生成的序列重合） */
const RELIC_SEED_SALT = 0x52454c43;

/** mulberry32：确定性的 32 位伪随机数（[0,1)），同一种子同一序列 */
export function seededRandom(seed: number): () => number {
  let a = (seed ^ RELIC_SEED_SALT) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 按种类展开成 RELIC_TOTAL 个条目后用种子洗牌：第 i 处遗迹的种类 = 洗牌后的第 i 项 */
export function shuffledRelicKinds(random: () => number): Array<{ kind: RelicKind; tier: RelicTier }> {
  const list: Array<{ kind: RelicKind; tier: RelicTier }> = [];
  for (const def of RELIC_DEFS) {
    for (let i = 0; i < def.count; i += 1) {
      list.push({ kind: def.kind, tier: def.tier });
    }
  }
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export interface PlacedRelic {
  x: number;
  y: number;
  kind: RelicKind;
  tier: RelicTier;
}

/** 两点的 Chebyshev 距离 */
export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * 按世界种子挑选遗迹点位（纯函数，只依赖种子与资格判定）。
 * 候选坐标由种子顺序抽取，分批交给 eligible 判定（返回与批次等长的布尔数组：是否为合规地块）；
 * 合规且与已选点的间距不小于 RELIC_MIN_SPACING 才收下，种类按洗牌表依次分配。
 * maxRounds 之内凑不齐时返回已选的部分（调用方记录日志）；正常世界下 200 处都能凑齐。
 */
export async function placeRelics(
  seed: number,
  eligible: (batch: Array<{ x: number; y: number }>) => Promise<boolean[]>,
  worldSize: number,
  options: { batchSize?: number; maxRounds?: number } = {},
): Promise<PlacedRelic[]> {
  const random = seededRandom(seed);
  const kinds = shuffledRelicKinds(random);
  const batchSize = options.batchSize ?? 2000;
  const maxRounds = options.maxRounds ?? 500;
  const placed: PlacedRelic[] = [];
  for (let round = 0; round < maxRounds && placed.length < RELIC_TOTAL; round += 1) {
    const batch: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < batchSize; i += 1) {
      batch.push({ x: Math.floor(random() * worldSize), y: Math.floor(random() * worldSize) });
    }
    const flags = await eligible(batch);
    for (let i = 0; i < batch.length && placed.length < RELIC_TOTAL; i += 1) {
      if (!flags[i]) {
        continue;
      }
      const { x, y } = batch[i];
      if (placed.some((p) => chebyshev(p.x, p.y, x, y) < RELIC_MIN_SPACING)) {
        continue;
      }
      const slot = kinds[placed.length];
      placed.push({ x, y, kind: slot.kind, tier: slot.tier });
    }
  }
  return placed;
}
