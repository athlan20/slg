import { TROOP_POWER } from './battle';
import type { TroopKind } from './protocol';

export const FORMATION_KINDS = ['balanced', 'infantry', 'ranged', 'cavalry'] as const;
export type FormationKind = (typeof FORMATION_KINDS)[number];

export interface FormationCatalog {
  formationRules: typeof FORMATION_RULES;
  troopPower: Partial<Record<TroopKind, number>>;
}

export function formationCatalog(): FormationCatalog {
  return { formationRules: FORMATION_RULES, troopPower: TROOP_POWER };
}

export const FORMATION_RULES: Record<FormationKind, { shares: Partial<Record<TroopKind, number>>; budgetFactor: number }> = {
  balanced: { shares: { swordsman: 0.5, archer: 0.5 }, budgetFactor: 1 },
  infantry: { shares: { pikeman: 0.65, swordsman: 0.35 }, budgetFactor: 1.25 },
  ranged: { shares: { swordsman: 0.3, archer: 0.7 }, budgetFactor: 0.96 },
  // Light cavalry outruns slow escorts and fights alone, so cavalry is paired with archers that fire from range.
  cavalry: { shares: { cavalry: 0.3, archer: 0.7 }, budgetFactor: 1.7 },
};

/** Missing templates preserve a legacy client's previously saved choices. */
export function readFormations(raw: unknown): FormationKind[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length !== 3 || !raw.every(kind => FORMATION_KINDS.includes(kind))) return null;
  return [...raw];
}

/** Reference-power factors are calibrated for this engine; they are not actual recruitment budgets. */
export function formationArmy(size: number, kind: FormationKind = 'balanced'): Partial<Record<TroopKind, number>> {
  const count = Number.isFinite(size) ? Math.max(0, Math.floor(size)) : 0;
  if (kind === 'balanced') {
    return { swordsman: count - Math.floor(count / 2), archer: Math.floor(count / 2) };
  }
  const rule = FORMATION_RULES[kind];
  const budget = count * 5 * rule.budgetFactor;
  const army: Partial<Record<TroopKind, number>> = {};
  for (const [troop, share] of Object.entries(rule.shares) as Array<[TroopKind, number]>) {
    army[troop] = Math.floor(budget * share / TROOP_POWER[troop]);
  }
  return army;
}
