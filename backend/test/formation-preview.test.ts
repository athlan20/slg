import assert from 'node:assert/strict';
import test from 'node:test';
import { formationArmy, formationCatalog, FORMATION_KINDS } from '../common/src/army-formation';
import { standardArmySize, ARENA_ARMY_BASE, ARENA_ARMY_PER_LEAD } from '../common/src/arena';
import { availableFormation, previewFormation } from '../../frontend/src/api/formation-preview';

const rules = { armyBase: ARENA_ARMY_BASE, armyPerLead: ARENA_ARMY_PER_LEAD, ...formationCatalog() };

test('client previews match authoritative armies across templates and command values', () => {
  for (const lead of [0, 1, 30, 50, 90, 200]) {
    for (const kind of FORMATION_KINDS) {
      assert.deepEqual(previewFormation(lead, kind, rules), formationArmy(standardArmySize(lead), kind));
    }
  }
});

test('world presets never invent troops and leave stock outside the selected mix at home', () => {
  const army = { swordsman: 90, archer: 20, pikeman: 40, cavalry: 100, porter: 500 };
  assert.deepEqual(availableFormation(army, 'balanced', rules), { swordsman: 20, archer: 20 });
  for (const kind of FORMATION_KINDS) {
    const preset = availableFormation(army, kind, rules);
    for (const [troop, count] of Object.entries(preset)) {
      assert.ok(Number.isInteger(count) && count >= 0 && count <= army[troop as keyof typeof army]);
    }
    assert.equal(preset.porter, undefined);
  }
});

test('a preset that cannot be assembled from stock is empty', () => {
  assert.ok(Object.values(availableFormation({ archer: 20 }, 'balanced', rules)).every(count => count === 0));
});
