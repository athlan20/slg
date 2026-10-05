// 英文文案孪生（AISLG-137）：copy-tech.ts 的英文版；satisfies 校验结构与函数签名一致。
// 科技研究文案（v27，AISLG-77；与 copy.ts 分文件以控制单文件行数）

import { TECH_COPY } from './copy-tech';
import type { TechKind } from './api/protocol-tech';

export const TECH_COPY_EN = {
  panel: {
    title: 'Tech',
    academyMeta: (level: number) => (level > 0 ? `Academy Lv${level}` : 'Academy not built yet'),
    noAcademy: 'Tech can only be researched after the Academy is built (level-N tech requires an Academy at level N or higher). Tech is shared account-wide and applies to all cities',
    sharedHint: 'Tech is shared account-wide and applies to all cities; only one research at a time',
    levelTag: (level: number, max: number) => `Lv${level}/${max}`,
    currentEffect: (percent: number) => (percent > 0 ? `Currently +${percent}%` : 'Not in effect'),
    nextLine: (level: number, cost: string, seconds: string) => `Next Lv${level}: ${cost} · takes ${seconds}`,
    maxed: 'Maxed',
    needAcademy: (required: number) => `Needs Academy Lv${required}`,
    research: 'Research',
    researching: 'Researching…',
    researchingRow: (label: string, level: number, remaining: string) => `Researching ${label} Lv${level}, ${remaining} left`,
    cancel: 'Cancel research (full refund)',
    cancelBusy: 'Cancelling…',
    inProgressDisabled: 'A research is already in progress',
    insufficient: 'Not enough resources',
    scoutDetail: (level: number) =>
      level >= 6 ? 'Current: exact counts' : level >= 3 ? 'Current: troop-type detail (counts are approximate)' : 'Current: rough total troop count only',
  },
  /** 侦察科技决定情报详细度（侦察报告 / 地块详情） */
  scout: {
    rough: (min: number, max: number) => `Scouting precision too low: only the rough total of about ${min}–${max} troops is visible (troop-type detail from Scouting Lv3, exact counts from Lv6)`,
    kinds: (min: number, max: number) => `Troop-type details are approximate; total troops about ${min}–${max} (exact from Scouting Lv6)`,
    approx: '≈',
    garrisonRange: (min: number, max: number) => `Total troops about ${min}–${max}`,
    garrisonRangeShort: (min: number, max: number) => `about ${min}–${max}`,
    noVerdict: 'Precision too low to assess the strength comparison (research Scouting first)',
    summaryRough: (min: number, max: number) => `Defenders: total troops about ${min}–${max}`,
  },
  names: {
    farming: 'Farming',
    carrying: 'Carrying',
    marching: 'Marching',
    storage: 'Storage',
    scouting: 'Scouting',
    defense: 'Fortification',
  } satisfies Record<TechKind, string>,
  /** 科技效果说明（协议 effect 是服务端中文，这里按科技给英文；中文值镜像 backend tech.ts） */
  effectText: {
    farming: '+5% food, wood, stone and iron output per level',
    carrying: '+5% troop load per level (shared by plunder and transport)',
    marching: '+5% march speed per level',
    storage: '+5% food, wood, stone and iron storage cap per level',
    scouting: 'Richer scout reports: troop-type detail from Lv3, exact counts from Lv6',
    defense: '+1% extra wall damage reduction per level in main-city sieges (stacks on the wall bonus)',
  } satisfies Record<TechKind, string>,
  session: {
    started: (label: string, level: number) => `Started researching ${label} Lv${level}`,
    cancelled: (label: string, level: number) => `Cancelled research ${label} Lv${level}, cost fully refunded`,
    rejected: (message: string) => `Research rejected (${message})`,
    failedFallback: 'Failed to start the research',
  },
  errors: {
    levelMax: 'This tech is already maxed',
    inProgress: 'A research is already in progress — only one at a time (wait for it to finish or cancel it)',
    academyTooLow: (required: number, have: number) => `The city starting the research has too low an Academy: needs Lv${required}, currently Lv${have}`,
    insufficient: 'Not enough resources to pay the research cost',
    notCancellable: 'No research to cancel (it may have just completed)',
    fallback: 'Tech operation failed',
  },
  event: {
    started: (label: string, level: number) => `Started researching ${label} Lv${level}`,
    completed: (label: string, level: number) => `Research complete: ${label} Lv${level}, applies to all cities`,
    cancelled: (label: string, level: number, refund: string) => `Cancelled research ${label} Lv${level}${refund ? `, refunded ${refund}` : ''}`,
  },
} satisfies typeof TECH_COPY;
