// 英文文案孪生（AISLG-137）：copy-quest.ts 的英文版；satisfies 校验结构与函数签名一致。

import { QUEST_COPY } from './copy-quest';

export const QUEST_COPY_EN = {
  panel: {
    title: 'Quests',
    loading: 'Loading…',
    claim: 'Claim',
    claimed: 'Claimed',
    undone: 'Incomplete',
    locked: 'Locked',
    notReached: 'Not reached',
    claimable: (n: number) => `${n} claimable`,
    allClear: 'All clear',
  },
  tabs: {
    daily: 'Daily',
    main: 'Main',
    achv: 'Achievements',
    act: 'Events',
  },
  signin: {
    title: 'Daily check-in',
    streak: (days: number, total: number) => `Streak ${days}d · total ${total}`,
    button: 'Check in',
    signed: 'Checked in',
    busy: 'Working…',
    day: (d: number) => `D${d}`,
    dayTitle: (d: number, reward: string) => `Day ${d}: ${reward}`,
  },
  main: {
    progress: (cur: number, total: number) => `Progress ${cur} / ${total} (sequential)`,
  },
  achv: {
    sideLabel: 'Side',
    achvLabel: 'Achievements',
    current: (v: number) => `Now ${v}`,
    tierTitle: (threshold: number, reward: string) => `Reach ${threshold} · ${reward}`,
  },
  act: {
    dailyTag: 'Daily',
    endsTag: (date: string) => `Ends ${date}`,
    rewardLine: (reward: string) => `Reward ${reward}`,
  },
  reward: {
    line: (desc: string, reward: string) => `${desc} · Reward ${reward}`,
  },
  errors: {
    daily: 'Task incomplete or already claimed today',
    signin: 'Already checked in today',
    quest: 'Requirement not met or already claimed',
    claim: 'Claim failed',
    net: 'Network error, claim failed',
  },
} satisfies typeof QUEST_COPY;
