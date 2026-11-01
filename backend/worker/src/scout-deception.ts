// 欺敌的情报侧接入（v86，AISLG-211）：侦察到达时先按目标城生效中的草木皆兵 / 空城计
// 换算真实驻军，**再**交给 buildScoutIntel 走现有的侦察科技降级（先换算、后降级）。
// 识破概率 = 侦察方侦察科技等级 × 5%（0 级永远识破不了）；识破时情报给真实驻军并标
// intel.deception，被识破不通知施计方。战斗结算永远用真实驻军，只改侦察情报。

import type pg from 'pg';
import type { TroopKind } from '../../common/src/protocol-army';
import type { ScoutIntel } from '../../common/src/protocol-battle';
import { applyDeceptionToGarrison, deceptionSpotted, type RandomSource } from '../../common/src/stratagem';
import { loadActiveDeception } from '../../common/src/stratagem-db';
import type { TechLevels } from '../../common/src/tech';

export interface DeceptionOutcome {
  /** 交给 buildScoutIntel 的驻军（识破 / 无欺敌时为真实值） */
  garrison: Partial<Record<TroopKind, number>>;
  /** 识破时的情报标记（写进 ScoutIntel.deception）；没识破或本城没有欺敌为 null */
  seen: { stratagem: 'phantom_army' | 'empty_fort'; name: string; seen: true } | null;
}

/** 目标城有欺敌时按倍数换算驻军，并按侦察科技掷一次识破 */
export async function applyScoutDeception(
  client: pg.PoolClient,
  cityId: string,
  garrison: Partial<Record<TroopKind, number>>,
  techs: TechLevels,
  now: Date,
  rng: RandomSource = Math.random,
): Promise<DeceptionOutcome> {
  const deception = await loadActiveDeception(client, cityId, now);
  if (!deception) {
    return { garrison, seen: null };
  }
  const spotted = deceptionSpotted(techs.scouting ?? 0, rng);
  return {
    garrison: applyDeceptionToGarrison(garrison, deception.multiplierPercent, spotted),
    seen: spotted ? { stratagem: deception.kind, name: deception.name, seen: true } : null,
  };
}

/** 识破时把标记挂到情报上（没识破时情报里没有任何标记） */
export function withDeceptionMark(intel: ScoutIntel, seen: DeceptionOutcome['seen']): ScoutIntel {
  return seen ? { ...intel, deception: seen } : intel;
}
