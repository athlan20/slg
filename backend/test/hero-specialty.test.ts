import assert from 'node:assert/strict';
import test from 'node:test';
import { HERO_SPECIALTIES, rollHeroSpecialty, specialtyBonus } from '../common/src/hero-specialty';
import { simulateBattle } from '../common/src/battle-engine';
import { seededRng } from '../common/src/arena';
import { battleBonusOf, insertHero, type AccountHeroRow } from '../common/src/hero-db';
import type pg from 'pg';

test('ordinary recruitment persists the one sampled specialty; famous recruitment does not sample', async () => {
  const calls: unknown[][] = [];
  const writer = { query: async (_sql: string, values: unknown[]) => { calls.push(values); return { rows: [{}] }; } } as unknown as pg.PoolClient;
  const attrs = { name: 'General', lead: 30, force: 40, wit: 25 };
  await insertHero(writer, 'account', { ...attrs, famous: false }, () => 0);
  assert.equal(calls[0][6], 'infantry');
  await insertHero(writer, 'account', { ...attrs, famous: true }, () => { throw new Error('Famous heroes must not roll specialties'); });
  assert.equal(calls[1][6], null);
  assert.deepEqual(calls[1].slice(3, 6), [30, 40, 25]);
});

test('famous heroes ignore a specialty even when supplied by stale or inconsistent data', () => {
  const row = { famous: true, lead: 50, force: 50, wit: 50, specialty: 'assault' } as AccountHeroRow;
  assert.equal(battleBonusOf(row, 100)?.specialty, null);
  const ordinary = { ...row, famous: false };
  assert.equal(battleBonusOf(ordinary, 2000)?.specialty, 'assault');
  assert.equal(battleBonusOf(ordinary, 2000)?.specialtyScale, 0.5);
});

test('ordinary recruitment samples every specialty without introducing a reroll API', () => {
  assert.deepEqual(HERO_SPECIALTIES.map((_, i) => rollHeroSpecialty(() => (i + 0.5) / HERO_SPECIALTIES.length)), HERO_SPECIALTIES);
});

test('specialties reward the matching troops and respect command dilution', () => {
  assert.ok(specialtyBonus('infantry', 'pikeman').atkPercent > 0);
  assert.equal(specialtyBonus('infantry', 'archer').atkPercent, 0);
  const full = specialtyBonus('cavalry', 'cavalry');
  const half = specialtyBonus('cavalry', 'cavalry', 0.5);
  assert.equal(half.atkPercent, full.atkPercent / 2);
  assert.equal(half.defPercent, full.defPercent / 2);
  assert.deepEqual(specialtyBonus(null, 'cavalry'), { atkPercent: 0, defPercent: 0 });
});

test('siege specialty is active only in a siege', () => {
  assert.equal(specialtyBonus('siege', 'ballista', 1, false).atkPercent, 0);
  assert.ok(specialtyBonus('siege', 'ballista', 1, true).atkPercent > 0);
});

test('the common engine applies matching specialties to attacks and city defense', () => {
  const army = { swordsman: 100, archer: 100 };
  const base = simulateBattle(army, army, { siege: true, rng: seededRng(101) });
  const attack = simulateBattle(army, army, {
    siege: true, attackerHero: { atkPercent: 0, defPercent: 0, specialty: 'assault' }, rng: seededRng(101),
  });
  const defense = simulateBattle(army, army, {
    siege: true, defenderHero: { atkPercent: 0, defPercent: 0, specialty: 'defense' }, rng: seededRng(101),
  });
  const contact = base.roundLog.findIndex(round => round.attackerDamage > 0);
  assert.ok(contact >= 0);
  assert.ok(attack.roundLog[contact].attackerDamage > base.roundLog[contact].attackerDamage);
  assert.ok(defense.roundLog[contact].attackerDamage < base.roundLog[contact].attackerDamage);
});

test('missing specialties preserve existing and famous-hero combat exactly', () => {
  const army = { cavalry: 90, archer: 40 };
  const bonus = { atkPercent: 15, defPercent: 15 };
  const old = simulateBattle(army, army, { attackerHero: bonus, rng: seededRng(42) });
  const current = simulateBattle(army, army, { attackerHero: { ...bonus, specialty: null }, rng: seededRng(42) });
  assert.deepEqual(current, old);
});
