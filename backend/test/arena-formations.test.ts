import assert from 'node:assert/strict';
import test from 'node:test';
import { FORMATION_KINDS, formationArmy, readFormations } from '../common/src/army-formation';
import { standardArmy, standardArmySize, fightRound, seededRng } from '../common/src/arena';
import { saveLineup } from '../common/src/arena-db';
import type pg from 'pg';

test('legacy saves retain formations; explicit templates are stored atomically with heroes', async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const writer = { query: async (sql: string, values: unknown[]) => { calls.push({ sql, values }); } } as unknown as pg.PoolClient;
  await saveLineup(writer, 'entry', ['hero', null, null]);
  assert.equal(calls[0].values[4], null);
  assert.match(calls[0].sql, /COALESCE\(\$5::jsonb, formations\)/);
  await saveLineup(writer, 'entry', ['hero', null, null], ['cavalry', 'infantry', 'ranged']);
  assert.equal(calls[1].values[4], '["cavalry","infantry","ranged"]');
});

test('legacy clients omit formations; malformed templates are rejected', () => {
  assert.equal(readFormations(undefined), undefined);
  assert.equal(readFormations(null), null);
  assert.equal(readFormations(['balanced', 'ranged']), null);
  assert.equal(readFormations(['balanced', 'invalid', 'ranged']), null);
  assert.deepEqual(readFormations(['infantry', 'ranged', 'cavalry']), ['infantry', 'ranged', 'cavalry']);
});

test('balanced formation preserves the original standard army', () => {
  assert.deepEqual(formationArmy(standardArmySize(40), 'balanced'), standardArmy(40));
});

test('all formations produce finite positive integer troops', () => {
  for (const kind of FORMATION_KINDS) {
    const army = formationArmy(2100, kind);
    assert.ok(Object.keys(army).length >= 2);
    assert.ok(Object.values(army).every(n => Number.isInteger(n) && n > 0));
  }
});

test('each formation has a counter at equal hero attributes', () => {
  const hero = { name: 'Calibration', lead: 50, force: 50, wit: 50, level: 10 };
  for (const formation of FORMATION_KINDS) {
    const rates = FORMATION_KINDS.filter(other => other !== formation).map(other => {
      let wins = 0;
      for (let i = 0; i < 160; i++) {
        if (fightRound({ ...hero, formation }, { ...hero, formation: other }, seededRng(70000 + i)).challengerWon) wins++;
      }
      return wins / 160;
    });
    assert.ok(rates.some(rate => rate < 0.45), `${formation} needs a meaningful counter`);
    assert.ok(rates.some(rate => rate > 0.55), `${formation} needs a useful matchup`);
  }
});

test('arena combat uses the saved formation and keeps seed replay deterministic', () => {
  const base = { name: 'General', lead: 50, force: 50, wit: 50, level: 10 };
  const challenger = { ...base, formation: 'cavalry' as const, specialty: 'cavalry' as const };
  const defender = { ...base, formation: 'ranged' as const };
  const first = fightRound(challenger, defender, seededRng(88));
  assert.deepEqual(first, fightRound(challenger, defender, seededRng(88)));
  assert.ok((first.result.attacker.troops.cavalry ?? 0) > 0);
  assert.ok((first.result.defender.troops.archer ?? 0) > 0);
});
