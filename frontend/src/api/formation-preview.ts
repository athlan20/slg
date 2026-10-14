import type { TroopKind } from './protocol';
import type { FormationCatalog, FormationKind, FormationPreviewRules } from './protocol-combat';

type Troops = Partial<Record<TroopKind, number>>;

/** Previews use the server catalog so balancing does not require a client release. */
export function previewFormation(lead: number, kind: FormationKind, rules: FormationPreviewRules): Troops {
  const size = rules.armyBase + Math.max(0, Math.floor(lead)) * rules.armyPerLead;
  if (kind === 'balanced') return { swordsman: size - Math.floor(size / 2), archer: Math.floor(size / 2) };
  const rule = rules.formationRules[kind];
  const budget = size * 5 * rule.budgetFactor;
  return Object.fromEntries(Object.entries(rule.shares).map(([troop, share]) => [
    troop, Math.floor(budget * (share ?? 0) / (rules.troopPower[troop as TroopKind] ?? 1)),
  ]));
}

/** Fit the selected proportions to actual stock, leaving surplus troops at home. */
export function availableFormation(army: Troops, kind: FormationKind, rules: FormationCatalog): Troops {
  const proportions = Object.entries(rules.formationRules[kind].shares).map(([troop, share]) => ({
    troop: troop as TroopKind, ratio: (share ?? 0) / (rules.troopPower[troop as TroopKind] ?? 1),
  })).filter(item => item.ratio > 0);
  const scale = Math.min(...proportions.map(item => Math.max(0, army[item.troop] ?? 0) / item.ratio));
  return Object.fromEntries(proportions.map(item => [item.troop, Math.floor(scale * item.ratio)]));
}
