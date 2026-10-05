// 英文文案孪生（AISLG-137）：copy-moving.ts，逐成员 satisfies 对应中文对象的类型。
// 移动目标（流寇 / 运粮商队）文案（v28 AISLG-78；与 copy.ts 分文件以控制单文件行数）。
// v35（AISLG-112）截击改为「到了先埋伏」：提前到达不再扑空，部队原地埋伏等目标经过。

import { MOVING_COPY } from './copy-moving';

export const MOVING_COPY_EN = {
  panel: {
    title: 'Bandits & Caravans',
    empty:
      'No moving targets right now (they spawn periodically while players are online, move along fixed routes and despawn when they expire)',
    hint:
      'Routes and timetables are public: pick a tile on the route when marching out — troops that arrive early set ' +
      'an ambush in place and engage when the target enters that tile or an adjacent one.',
    row: (label: string, level: number) => `${label} Lv${level}`,
    nowAt: (x: number, y: number) => `Now at (${x},${y})`,
    leaves: (remaining: string) => `Disappears in ${remaining}`,
    locate: 'Locate',
    strength: (min: number, max: number) => `Defenders ~${min}–${max}`,
    loot: (min: number, max: number) => `Carries ~${min}–${max} resources`,
    kindTag: { caravan: 'Caravan', bandit: 'Bandits' } as Record<string, string>,
    banditNote: 'Bandits passing player wilderness tiles plunder part of the gathering yield on the way',
    caravanNote: 'Weak defenders, more resources',
  },
  /** 地块详情里的截击表单 */
  intercept: {
    title: 'Intercept a Moving Target',
    pickTarget: 'Pick a target to intercept',
    passAt: (label: string, level: number, clock: string) => `${label} Lv${level} passes this tile ~${clock}`,
    passed: 'This target has already passed this tile',
    etaLine: (mine: string, theirs: string) => `Your troops arrive ~${mine}; the target passes ~${theirs}`,
    verdictOk: 'In time: the target is on this tile or an adjacent one when you arrive — combat starts immediately',
    verdictAmbush: (wait: string, clock: string) =>
      `Will ambush for about ${wait}; combat expected ~${clock} (starts when the target enters an adjacent tile)`,
    verdictLate: 'Too late: the target is long gone by the time you arrive — the march comes up empty and turns back',
    recommend: (x: number, y: number, clock: string) => `Recommended intercept tile (${x},${y}) · engage ~${clock}`,
    submit: 'March to Intercept',
    hint: (reach: number) =>
      `Troops that arrive early set an ambush first and engage when the target enters the selected tile or an ` +
      `adjacent one (distance ≤ ${reach}); only a too-late arrival (target long gone) comes up empty; on victory ` +
      `your troops carry off its resources by load`,
    noTargets: '',
  },
  march: {
    label: (x: number, y: number) => `Intercept → (${x},${y})`,
    ambushLabel: (x: number, y: number) => `Ambushing → (${x},${y}), waiting for the target`,
    started: (x: number, y: number, dueClock: string) =>
      `Troops out to intercept → (${x},${y}), combat expected ~${dueClock}`,
  },
  event: {
    intercepted: (label: string, pos: string, loot: string, survivors: string) =>
      `Intercepted ${label} ${pos}: plundered ${loot || '(no loot)'}${survivors ? `, survivors ${survivors} heading back` : ''}`,
    lost: (label: string, pos: string, survivors: string) =>
      `Intercepting ${label} ${pos} failed${survivors ? `, the remnants fell back (${survivors})` : ', the attacking force was wiped out'}`,
    missed: (pos: string) => `Intercept at ${pos} came up empty: the target was long gone on arrival, troops heading back`,
    gone: (pos: string) => `Intercept at ${pos}: the target is gone (defeated or expired), troops heading back`,
    banditPlundered: (pos: string, resource: string, amount: number) =>
      `Bandits passed the wilderness at ${pos} and plundered ${resource} ${amount}`,
  },
  report: {
    kind: 'Intercept',
    endNoContactMissed: 'Came up empty: the target was long gone on arrival, no engagement',
    endNoContactGone: 'The target is gone (defeated or expired), no engagement',
    sideMissed: '(long gone)',
  },
} satisfies typeof MOVING_COPY;
