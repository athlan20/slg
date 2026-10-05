// 英文文案孪生（AISLG-137）：copy-cities.ts，逐成员 satisfies 对应中文对象的类型。
// 多城与分城文案（v24，AISLG-58；从 copy.ts 拆出以控制单文件行数）

import { CITY_COPY } from './copy-cities';

export const CITY_COPY_EN = {
  /** 城池切换条 */
  switcher: {
    title: 'Cities',
    levelTag: (level: number) => `Lv.${level}`,
    mainTag: 'Main City',
    tabTitle: (name: string, level: number, x: number | null, y: number | null) =>
      `${name} · City Lv.${level}${x !== null && y !== null ? ` · (${x},${y})` : ''}`,
    branchQuota: (count: number, limit: number) => `Branch Cities ${count}/${limit}`,
    branchLocked: (minGovernment: number) =>
      `From Main City Government Hall Lv ${minGovernment}, NPC cities can be occupied as Branch Cities`,
    switching: 'Switching…',
  },
  /** 出征任务：占领 NPC 城（变分城） */
  worldMap: {
    attackHintNpc:
      'Plunder: on victory, surviving troops carry off the stockpile by load (gold included; stockpiles do not ' +
      'regenerate). Occupy: win and the city becomes your Branch City, taking over its buildings and remaining ' +
      'stockpile. Scouting first is recommended',
    taskOccupyNpcHint: (minGovernment: number) =>
      `To make it a Branch City: Main City Government Hall ≥ Lv ${minGovernment}, Branch City slots not full, and ` +
      `the target city's level ≤ the origin city's Government Hall level; unmet requests are rejected with the reason`,
    confirmOccupyNpc: 'Occupy as Branch City',
  },
  /** 自有城池间运输（v26 AISLG-79） */
  transport: {
    modeTroop: 'Transfer',
    modeTransport: 'Transport',
    hint:
      'Move resources to another city of this account: they are deducted from this city at departure and credited to ' +
      'the target city on arrival (not limited by the storage cap), and the troops then return home automatically; ' +
      'withdrawing en route brings the resources back with the troops. Porters have the highest load (500 per unit)',
    cargoTitle: 'Send Resources',
    cargoInputLabel: (name: string, have: number) => `${name} (have ${have})`,
    cargoMax: 'Max',
    usedLine: (used: number, capacity: number) => `Load used ${used} / total load ${capacity}`,
    overCapacity: 'Cargo exceeds the formation load: reduce the cargo or send more troops (Porters have the highest load)',
    insufficient: (name: string) => `Not enough ${name} in the origin city`,
    pickCargo: 'Enter the amounts of resources to transport',
    submit: 'Start Transport',
    marchLabel: (x: number, y: number) => `Transport → (${x},${y})`,
    marchCargo: (cargo: string) => ` (cargo ${cargo})`,
    startedLog: (x: number, y: number, cargo: string, dueClock: string) =>
      `Transport convoy departing → (${x},${y}), cargo ${cargo}, due ${dueClock}`,
    eventDelivered: (pos: string, cityName: string, cargo: string, troops: string) =>
      `Transport complete: ${cargo} delivered to ${cityName} (${pos}); transport troops ${troops} are marching back`,
    eventReceived: (fromName: string, cargo: string) => `Received a transport from ${fromName}: ${cargo}`,
    eventAbortedCargo: (cargo: string) => `, cargo ${cargo} brought back with the troops`,
  },
  /** 名城（v24 AISLG-56）：地图图标 / 悬浮提示 / 详情 */
  famous: {
    legend: 'Famous City (fought in two stages; occupying grants an exclusive bonus)',
    stageOuter: 'Outer ring stage: clear the outer-ring garrison first',
    stageKeeper: 'Keeper stage: outer ring cleared — attack the keeper and occupy',
    bonus: (percent: number) => `Occupier-exclusive: this city's output +${percent}%`,
    recoversAt: (clock: string) => `Defeat the keeper before ${clock}, or the outer-ring garrisons refill`,
    title: (name: string) => `Famous City · ${name}`,
    cityBonusRow: (percent: number) => `Famous City bonus: output +${percent}%`,
    hintOuter:
      'A Famous City is fought in two stages: first march out and clear the outer ring (victories there yield no ' +
      'loot); once the outer ring is clear, march out again within the time limit to attack the keeper — you cannot ' +
      'occupy while the outer ring is not cleared',
    hintKeeper:
      'Outer ring cleared: march out within the time limit to attack the keeper — plunder the stockpile or occupy ' +
      'the city as a Branch City (occupying grants an exclusive output bonus); when time runs out, the outer-ring ' +
      'garrisons refill',
  },
  errors: {
    governmentTooLow:
      'Occupying an NPC city requires the Main City Government Hall at the specified level (see the Branch City quota hint)',
    branchLimit:
      'Branch City limit reached (cap = Main City Government Hall level ÷ 3, rounded down; upgrade the Main City Government Hall to raise it)',
    outerNotCleared:
      'The outer-ring garrison of this Famous City is not cleared yet — march out and clear the outer ring first ' +
      '(Plunder); once cleared, you can attack the keeper and occupy within the time limit',
    transportInsufficient:
      'The origin city does not have enough resources for this cargo (refreshed against the latest stockpile)',
    targetLevelTooHigh:
      "The target NPC city's level is above the origin city's Government Hall level — you can only occupy cities " +
      "whose level does not exceed the origin city's Government Hall",
  },
} satisfies typeof CITY_COPY;
