// 遗迹奖励表（AISLG-227）：前端详情面板展示用。与 backend/common/src/relic.ts 的 RELIC_DEFS 一一对应，
// 两处改动必须同时进行（后端是权威，领取时按后端表发奖）。
import type { RelicKind } from './protocol-world';

export type RelicRewardKey = 'gold' | 'wood' | 'food' | 'stone' | 'iron';

type Reward = Record<RelicRewardKey, number>;

export const RELIC_REWARD: Record<RelicKind, Reward> = {
  granary: { gold: 500, wood: 500, food: 3000, stone: 500, iron: 500 },
  lumberyard: { gold: 500, wood: 3000, food: 500, stone: 500, iron: 500 },
  quarry: { gold: 500, wood: 500, food: 500, stone: 3000, iron: 500 },
  ironworks: { gold: 500, wood: 500, food: 500, stone: 500, iron: 3000 },
  caravan: { gold: 3000, wood: 500, food: 500, stone: 500, iron: 500 },
  battlefield: { gold: 3500, wood: 1000, food: 1000, stone: 1000, iron: 3500 },
  treasury: { gold: 2000, wood: 2000, food: 2000, stone: 2000, iron: 2000 },
  mausoleum: { gold: 5000, wood: 5000, food: 5000, stone: 5000, iron: 5000 },
};

/** 附加道具的数量（传说遗迹：高级迁城令 1 张） */
export const RELIC_ADV_MOVE_CITY: Partial<Record<RelicKind, number>> = { mausoleum: 1 };

/** 奖励行的组成（按资源顺序，数量为 0 的不列） */
export function relicRewardParts(kind: RelicKind): Array<{ key: RelicRewardKey | 'advMoveCity'; amount: number }> {
  const reward = RELIC_REWARD[kind];
  const parts: Array<{ key: RelicRewardKey | 'advMoveCity'; amount: number }> = (['gold', 'wood', 'food', 'stone', 'iron'] as const)
    .map((key) => ({ key, amount: reward[key] }))
    .filter((part) => part.amount > 0);
  const items = RELIC_ADV_MOVE_CITY[kind] ?? 0;
  if (items > 0) {
    parts.push({ key: 'advMoveCity', amount: items });
  }
  return parts;
}
