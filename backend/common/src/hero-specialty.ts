import type { TroopKind } from './protocol';

export const HERO_SPECIALTIES = ['infantry', 'ranged', 'cavalry', 'siege', 'assault', 'defense'] as const;
export type HeroSpecialty = (typeof HERO_SPECIALTIES)[number];

export interface SpecialtyRule {
  troops: readonly TroopKind[];
  atkPercent: number;
  defPercent: number;
  siegeOnly?: boolean;
}

const COMBAT_TROOPS: readonly TroopKind[] = ['militia', 'scout', 'pikeman', 'swordsman', 'archer', 'cavalry', 'iron_cavalry', 'ballista', 'siege_ram'];

// First-version parameters; reproduce their effect with calibrate:specialties.
export const SPECIALTY_RULES: Record<HeroSpecialty, SpecialtyRule> = {
  infantry: { troops: ['militia', 'pikeman', 'swordsman'], atkPercent: 8, defPercent: 8 },
  ranged: { troops: ['archer', 'ballista'], atkPercent: 12, defPercent: 0 },
  cavalry: { troops: ['cavalry', 'iron_cavalry'], atkPercent: 10, defPercent: 4 },
  siege: { troops: ['ballista', 'siege_ram'], atkPercent: 18, defPercent: 8, siegeOnly: true },
  assault: { troops: COMBAT_TROOPS, atkPercent: 6, defPercent: 0 },
  defense: { troops: COMBAT_TROOPS, atkPercent: 0, defPercent: 6 },
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
