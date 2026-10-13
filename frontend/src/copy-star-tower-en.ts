// 英文文案孪生（AISLG-137 / AISLG-146）：copy-star-tower.ts 的英文版；satisfies 校验结构与函数签名一致。

import type { STAR_TOWER_COPY } from './copy-star-tower';

export const STAR_TOWER_COPY_EN = {
  tabs: { progress: 'Progress', lineup: 'Lineup', reports: 'Reports' },
  progress: {
    title: 'Star Tower',
    bestNone: 'No floor cleared yet',
    best: (n: number) => `Cleared ${n} floor${n === 1 ? '' : 's'}`,
    cleared: 'All floors cleared',
    nextFloor: (n: number) => `Next: floor ${n}`,
    bossTag: 'Boss',
    enemies: (n: number) => `${n} enem${n === 1 ? 'y' : 'ies'}`,
    reward: (gold: number, exp: number) => `First-clear reward ${gold} gold · ${exp} exp per lineup hero`,
    rules: (floors: number, bossEvery: number) =>
      `${floors} floors, a boss every ${bossEvery} · best of three · losing costs nothing, retry at once`,
    challenge: (n: number) => `Challenge floor ${n}`,
    challenging: 'Challenging…',
    clearedNote: 'Every floor is cleared — nothing left to challenge.',
    noLineup: 'No heroes in the lineup yet: set one below before challenging.',
    noCity: 'No city yet — first-clear gold has nowhere to go, so you cannot challenge.',
    loading: 'Loading…',
    stats: (lead: number, force: number, wit: number) => `LEA ${lead} FOR ${force} INT ${wit}`,
    level: (n: number) => `Lv${n}`,
  },
  lineup: {
    title: 'Lineup',
    slot: (n: number) => `Slot ${n}`,
    emptySlot: 'Empty',
    noHeroes: 'No heroes yet — recruit at the tavern first.',
    save: 'Save lineup',
    saving: 'Saving…',
    stats: (lead: number, force: number, wit: number) => `LEA ${lead} FOR ${force} INT ${wit}`,
    joinHint: 'Pick 1–3 heroes. Saving enters the arena ranking (the lineup is shared with the arena).',
  },
  reports: {
    title: 'Reports',
    empty: 'You have not challenged the Star Tower yet.',
    won: 'Cleared',
    lost: 'Failed',
    floor: (n: number) => `Floor ${n}`,
    boss: 'Boss',
    score: (w: number, l: number) => `${w}:${l}`,
    more: 'Older',
  },
  session: {
    challenged: (floor: number, won: boolean) => `Star Tower: challenged floor ${floor}, ${won ? 'cleared' : 'failed'}`,
    reward: (floor: number, gold: number, exp: number) => `Star Tower floor ${floor} first clear: ${gold} gold, ${exp} exp per lineup hero`,
    levelUp: (name: string, level: number) => `${name} reached level ${level}`,
    lineupSaved: 'Star Tower: lineup saved (shared with the arena)',
    failedFallback: 'Star Tower request failed, please try again later',
  },
  errors: {
    STAR_TOWER_CLEARED: 'Every floor is already cleared',
    STAR_TOWER_NO_CITY: 'No city yet — build one before challenging',
    STAR_TOWER_NO_LINEUP: 'No heroes in the lineup — set one before challenging',
    INVALID_PARAMS: 'Invalid request parameters',
  },
} satisfies typeof STAR_TOWER_COPY;
