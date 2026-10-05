// 英文文案孪生（AISLG-137）：copy-defense.ts，逐成员 satisfies 对应中文对象的类型。
// 二期新建筑（校场 / 烽火台 / 驿站 / 箭塔，v30 AISLG-80~83）文案；与 copy.ts 分文件以控制单文件行数

import type { TroopKind } from './api/protocol';
import { TROOP_LABEL_EN } from './copy-en';
import { DEFENSE_COPY } from './copy-defense';

export const DEFENSE_COPY_EN = {
  deploy: {
    meta: (count: number, limit: number) => `Troops away ${count} / limit ${limit}`,
    full: (limit: number) =>
      `Parade Ground level too low: at most ${limit} troops may be out at once (marching, returning and garrisoning wilderness all count; troops in the city do not)`,
    hint: 'Troops out of this city at once ≤ Parade Ground level (1 if not built); each Branch City counts separately — upgrade the Parade Ground to raise the cap',
  },
  building: {
    parade: (count: number, limit: number) =>
      `Troops away ${count} / limit ${limit} (limit = Parade Ground level, 1 if not built)`,
    beacon: (level: number) =>
      `Incoming-attack warning lead time +${level * 10}%; intel: ${
        level >= 6
          ? 'exact troop types and counts'
          : level >= 3
            ? 'rough ranges per troop type'
            : 'only a rough total headcount (troop types from Lv 3, exact from Lv 6)'
      }`,
    station: (level: number) => `Transfer / Transport speed between your own cities +${level * 10}%`,
    tower: (damage: number, range: number) =>
      damage > 0
        ? `Deals ${damage} fixed damage per round in city defense, range ${range} (city defense battles only)`
        : 'Deals fixed damage per round in city defense (active once built; damage = 150 × level)',
  },
  desc: {
    parade_ground:
      'Caps the troops this city can have out at once: marching, returning and garrisoning wilderness troops combined cannot exceed the Parade Ground level (1 if not built); troops in the city do not count.',
    beacon:
      'Earlier incoming-attack warnings and clearer intel: warning lead time +10% per level (doubled at Lv 10); at Lv 0–2 you only see a rough headcount, Lv 3–5 rough ranges per troop type, Lv 6+ exact. Applies to this city and the wilderness it has occupied.',
    post_station:
      'Speeds up Transfers and resource Transports between your own cities: march speed +10% per level (doubled at Lv 10); marches against wilderness / NPC cities are unaffected.',
    arrow_tower:
      'A ranged unit on the wall slot in city defense battles (NPC raids on the Main City) that cannot be destroyed: each round it deals fixed damage to the nearest enemy within range, and damage and range grow with level; field battles on wilderness are unaffected.',
  },
  warning: {
    kindsLabel: 'Troop estimate: ',
    exactLabel: 'Exact composition: ',
    beaconNote: (level: number) => `Beacon Tower Lv${level}`,
    kindRange: (kind: TroopKind, min: number, max: number) => `${TROOP_LABEL_EN[kind].name} ${min}–${max}`,
    exactRow: (kind: TroopKind, count: number) => `${TROOP_LABEL_EN[kind].name}×${count}`,
  },
  report: {
    towerDamage: (damage: number) => `Arrow Tower dealt ${damage} damage`,
    wallBreak: (from: number, to: number) =>
      `Battering Ram broke through the wall: wall damage reduction ${from}% → ${to}%`,
  },
  /** 兵种说明（征兵面板选中兵种时显示；v33 二期四兵种与克制关系，数值与后端 troops.ts / troop-counter.ts 对齐） */
  troopNote: {
    porter: 'The general troop with the highest load (500); very weak in combat — suited to transporting and hauling loot back.',
    militia: 'Basic melee troop: cheap and numerous — suited to the front line and attacking low-level wilderness.',
    scout: 'March speed ×2; used to scout targets.',
    pikeman: 'Melee front line. Counters: +20% damage against cavalry (Light Cavalry / Heavy Cavalry).',
    swordsman: 'High-HP, high-defense melee mainstay. Resistance: takes −20% damage from Archer / Ballista attacks.',
    archer: 'Ranged damage dealer with range 70; fragile. Deals −20% damage to Swordsmen.',
    cavalry: 'Fastest in battle — crosses Archer range in one round, the dedicated anti-ranged unit; countered by Spearmen (takes −20% damage).',
    iron_cavalry: 'Late-game heavy mainstay: 2400 HP, 620 attack, 420 defense; expensive with heavy Food upkeep (30/h); countered by Spearmen.',
    supply_wagon: 'Pure logistics with load 5000 (10× a Porter): almost no combat power and must be escorted by combat troops; transports / hauls loot back. March speed 0.7.',
    ballista: 'Ranged engine with range 95 that can fire from outside Archer range, countering Archer formations; fragile and slow (march 0.6) and needs melee cover; cannot hit Arrow Towers. Deals −20% damage to Swordsmen.',
    siege_ram: "Slowest march (0.6) and 0 load; only works in siege battles: for every 1% of the attacker's surviving troops, the defender's wall damage reduction drops by a further 8% (up to 80%); in wilderness and other battles it is just a tough, low-attack unit.",
  } as Record<string, string>,
} satisfies typeof DEFENSE_COPY;
