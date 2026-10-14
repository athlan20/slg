// Identifier mirrors; server-side rules remain authoritative.
import type { TroopKind } from './protocol';
export type HeroSpecialty = 'infantry' | 'ranged' | 'cavalry' | 'siege' | 'assault' | 'defense';
export type FormationKind = 'balanced' | 'infantry' | 'ranged' | 'cavalry';
export const FORMATION_KINDS: readonly FormationKind[] = ['balanced', 'infantry', 'ranged', 'cavalry'];

export interface FormationCatalog {
  formationRules: Record<FormationKind, { shares: Partial<Record<TroopKind, number>>; budgetFactor: number }>;
  troopPower: Partial<Record<TroopKind, number>>;
}
export interface FormationPreviewRules extends FormationCatalog {
  armyBase: number;
  armyPerLead: number;
}
