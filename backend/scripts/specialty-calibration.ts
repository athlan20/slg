import { FORMATION_KINDS, type FormationKind } from '../common/src/army-formation';
import { fightRound, seededRng, type ArenaFighter } from '../common/src/arena';
import { HERO_SPECIALTIES } from '../common/src/hero-specialty';

const runs = 400;
const base: ArenaFighter = { name: 'Calibration', lead: 50, force: 50, wit: 50, level: 10 };
const results: Record<string, Record<string, number>> = {};
for (const attack of FORMATION_KINDS) {
  results[attack] = {};
  for (const defend of FORMATION_KINDS) {
    let wins = 0;
    for (let i = 0; i < runs; i++) {
      if (fightRound({ ...base, formation: attack }, { ...base, formation: defend }, seededRng(10_000 + i)).challengerWon) wins++;
    }
    results[attack][defend] = Math.round(wins / runs * 1000) / 10;
  }
}
process.stdout.write(JSON.stringify({ runs, formationWinRates: results }, null, 2) + '\n');
// Each specialty is measured with its matching template against the same army without a specialty,
// averaged over both seats. Siege only applies in sieges and is not covered by arena duels.
const matching: Record<string, FormationKind> = { infantry: 'infantry', ranged: 'ranged', cavalry: 'cavalry', assault: 'balanced', defense: 'balanced' };
for (const specialty of HERO_SPECIALTIES) {
  const formation = matching[specialty];
  if (!formation) continue;
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    if (fightRound({ ...base, formation, specialty }, { ...base, formation }, seededRng(20_000 + i)).challengerWon) wins++;
    if (!fightRound({ ...base, formation }, { ...base, formation, specialty }, seededRng(20_000 + i)).challengerWon) wins++;
  }
  process.stdout.write(`${specialty}: ${Math.round(wins / (runs * 2) * 1000) / 10}% vs the same ${formation} army without a specialty\n`);
}
