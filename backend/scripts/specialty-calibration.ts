import { FORMATION_KINDS } from '../common/src/army-formation';
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
for (const specialty of HERO_SPECIALTIES) {
  let wins = 0;
  for (let i = 0; i < runs; i++) {
    if (fightRound({ ...base, specialty }, base, seededRng(20_000 + i)).challengerWon) wins++;
  }
  process.stdout.write(`${specialty}: ${Math.round(wins / runs * 1000) / 10}% vs identical balanced army\n`);
}
