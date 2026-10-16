import type { TroopKind } from './protocol';

export const HERO_SPECIALTIES = ['infantry', 'ranged', 'cavalry', 'siege', 'assault', 'defense'] as const;
export type HeroSpecialty = (typeof HERO_SPECIALTIES)[number];

export interface SpecialtyRule {
  troops: readonly TroopKind[];
  atkPercent: number;
  defPercent: number;
  siegeOnly?: boolean;
}

const COMBAT_TROOPS: readonly TroopKind[] = ['militia', 'scout', 'pikeman', 'swordsman', 'archer', 'cavalry', 'iron_cavalry', 'ballista', 'siege_ram', 'yulin_guard', 'danyang_soldier', 'baimao_soldier', 'huwei_guard', 'zhuge_crossbow', 'xiandeng_warrior', 'hubao_cavalry', 'xiliang_cavalry'];

// Second-pass parameters: one specialty is worth ~59-60% in an equal-army arena match (calibrate:specialties).
// Cavalry keeps its first-pass values: the cavalry template has few riders, so arena duels cannot calibrate it.
// Siege is only active in sieges and is not covered by that calibration either.
export const SPECIALTY_RULES: Record<HeroSpecialty, SpecialtyRule> = {
  infantry: { troops: ['militia', 'pikeman', 'swordsman', 'yulin_guard', 'danyang_soldier', 'baimao_soldier', 'huwei_guard'], atkPercent: 2.5, defPercent: 2.5 },
  ranged: { troops: ['archer', 'ballista', 'zhuge_crossbow', 'xiandeng_warrior'], atkPercent: 2.5, defPercent: 0 },
  cavalry: { troops: ['cavalry', 'iron_cavalry', 'hubao_cavalry', 'xiliang_cavalry'], atkPercent: 10, defPercent: 4 },
  siege: { troops: ['ballista', 'siege_ram'], atkPercent: 8, defPercent: 3, siegeOnly: true },
  assault: { troops: COMBAT_TROOPS, atkPercent: 3, defPercent: 0 },
  defense: { troops: COMBAT_TROOPS, atkPercent: 0, defPercent: 2.5 },
};

export function rollHeroSpecialty(rng: () => number = Math.random): HeroSpecialty {
  return HERO_SPECIALTIES[Math.min(HERO_SPECIALTIES.length - 1, Math.max(0, Math.floor(rng() * HERO_SPECIALTIES.length)))];
}

export function specialtyBonus(
  specialty: HeroSpecialty | null | undefined,
  troop: TroopKind,
  scale = 1,
  siege = false,
): { atkPercent: number; defPercent: number } {
  const rule = specialty ? SPECIALTY_RULES[specialty] : undefined;
  if (!rule || !rule.troops.includes(troop) || (rule.siegeOnly && !siege)) {
    return { atkPercent: 0, defPercent: 0 };
  }
  const factor = Number.isFinite(scale) ? Math.max(0, Math.min(1, scale)) : 0;
  return { atkPercent: rule.atkPercent * factor, defPercent: rule.defPercent * factor };
}
