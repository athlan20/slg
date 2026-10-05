// 英文文案孪生（AISLG-137）：copy-extra-panel.ts 的组件内联文案，逐成员 satisfies 对应中文对象的类型。

import { EXTRA_PANEL } from './copy-extra-panel';

export const EXTRA_PANEL_EN = {
  joiners: {
    colon: ': ',
    enum: ', ',
    paren: (text: string) => `(${text})`,
  },
  agentPanel: {
    title: 'Agent status & plan',
  },
  battleReport: {
    resultTargetGone: 'Target gone',
    resultMissed: 'Missed',
  },
  heroCard: {
    cityFallback: 'City',
  },
  offlineSummary: {
    troopsLostLabel: 'Troops lost',
  },
  cityGrid: {
    groupLabel: { resource: 'Resources', civil: 'Civic', military: 'Military' } as Record<string, string>,
  },
  pageTabs: {
    queue: 'Queue',
    stats: 'Stats',
    detail: 'Detail',
    log: 'Log',
    daily: 'Daily',
    troops: 'Troops',
  },
  overviewPage: {
    queued: 'Queued',
  },
  militarySummary: {
    wavesTotal: (n: number) => `${n} waves total`,
  },
  scoutReport: {
    justNow: 'Just now',
  },
} satisfies typeof EXTRA_PANEL;
