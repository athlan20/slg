// 英文文案孪生（AISLG-137）：copy-yt.ts，逐成员 satisfies 对应中文对象的类型。
// 黄巾之乱文案（v29，AISLG-76；与 copy.ts 分文件以控制单文件行数）

import { YT_COPY } from './copy-yt';

export const YT_COPY_EN = {
  panel: {
    title: 'Yellow Turban Rebellion',
    noEvent: 'The Yellow Turban Rebellion has not started yet: the whole server clears a round together every so often',
    nextAt: (clock: string) => `Next uprising expected ~${clock} (needs players online and active)`,
    lastResult: (reason: 'boss_cleared' | 'timeout' | null, cleared: number, total: number, scattered: number) =>
      reason === 'boss_cleared'
        ? `Last round: Zhang Jiao's Stronghold was broken, camps cleared ${cleared}/${total}`
        : `Last round: ended at the time limit — camps cleared ${cleared}/${total}, ${scattered} camps scattered into bandit gangs`,
    progress: (cleared: number, total: number) => `Cleared ${cleared} / ${total} total`,
    bossNeed: (need: number) => `Zhang Jiao's Stronghold appears after ${need} camps are cleared`,
    bossAppeared: "Zhang Jiao's Stronghold has appeared — the whole server can attack it",
    bossCleared: "Zhang Jiao's Stronghold has been broken",
    endsIn: (remaining: string) => `Ends in ${remaining}`,
    me: (killed: number, rank: number) => `My contribution: ${killed} enemies slain (rank ${rank})`,
    meNone: 'My contribution: no enemies slain yet — march out against camps to build it up',
    topTitle: 'Contribution Ranking',
    topRow: (rank: number, name: string, killed: number) => `${rank}. ${name} · ${killed} enemies slain`,
    campsTitle: 'Camps & Stronghold',
    campRow: (label: string, x: number, y: number) => `${label} (${x},${y})`,
    growIn: (remaining: string) => `Grows a tier in ${remaining}`,
    strength: (min: number, max: number) => `Defenders ~${min}–${max}`,
    locate: 'Locate',
    rewardsTitle: 'Rank rewards (sent to your Main City when it ends)',
    rewardsTab: 'Rank rewards',
    rewardRow: (label: string, gold: number, res: number) => `${label}: Gold ${gold} · ${res} each of the four resources`,
    bossStage: (stage: 'outer' | 'keeper', recovers: string | null) =>
      stage === 'keeper'
        ? `Keeper stage${recovers ? `, take the keeper before ${recovers} or the outer ring refills` : ''}`
        : 'Outer ring stage: clear the outer ring first',
  },
  /** 地块详情 / 悬浮提示里的营地信息 */
  tile: {
    title: (label: string) => label,
    strength: (min: number, max: number) => `Defenders ~${min}–${max} (scout for the exact composition)`,
    growIn: (remaining: string) => `Grows a tier in ${remaining}`,
    attackHint:
      'March out against it like a wilderness tile (Plunder task); on victory the camp disappears and drops ' +
      'resources and gold — enemies slain count toward your Yellow Turban Rebellion contribution. Camps cannot be occupied',
    bossHint:
      'Two stages, outer ring and keeper: once the outer ring is cleared you can attack the keeper within the time ' +
      'limit, or the outer ring refills when time runs out; breaking the Stronghold ends the event with a first-kill announcement',
    legend: "Yellow Turban Camp (巾) / Zhang Jiao's Stronghold (巢)",
  },
  broadcast: {
    started: (total: number) =>
      `The Yellow Turbans rise up! ${total} Yellow Turban Camps have appeared on the map — the whole server clears them together`,
    grown: (count: number, label: string) => `${count} Yellow Turban Camps have grown into ${label}`,
    boss: (x: number, y: number) => `Over 80% of the camps cleared — Zhang Jiao's Stronghold has appeared at (${x},${y})`,
    firstKill: (actor: string) => `${actor} broke Zhang Jiao's Stronghold and claimed the first kill!`,
    finished: (reason: string, cleared: number, total: number, scattered: number) =>
      reason === 'boss_cleared'
        ? `Yellow Turban Rebellion quelled: the Stronghold was broken (camps cleared ${cleared}/${total}); ${scattered} surviving camps scattered into bandit gangs`
        : `Yellow Turban Rebellion ended at the time limit: camps cleared ${cleared}/${total}; ${scattered} camps scattered into bandit gangs`,
  },
  event: {
    campWon: (label: string, pos: string, killed: number, loot: string) =>
      `Cleared ${label} ${pos}: ${killed} enemies slain, plundered ${loot || '(not enough load)'}`,
    campLost: (label: string, pos: string, killed: number) =>
      `Attack on ${label} ${pos} failed — still ${killed} enemies slain (counts toward contribution)`,
    bossOuter: (pos: string, killed: number) =>
      `Cleared the outer ring of Zhang Jiao's Stronghold ${pos}: ${killed} enemies slain — attack the keeper within the time limit`,
    bossWon: (pos: string, killed: number, loot: string) =>
      `Zhang Jiao's Stronghold ${pos} broken! ${killed} enemies slain, plundered ${loot || '(not enough load)'}`,
    reward: (tier: string, rank: number, killed: number, reward: string) =>
      `Yellow Turban Rebellion settlement: ${killed} enemies slain, rank ${rank} (${tier}); the reward ${reward} has been sent to your Main City`,
  },
  report: { kind: 'Yellow Turban Camp' },
  tierLabel: { small: 'Small Camp', medium: 'Medium Camp', large: 'Large Camp', boss: "Zhang Jiao's Stronghold" } as Record<string, string>,
} satisfies typeof YT_COPY;
