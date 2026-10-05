// 英文文案孪生（AISLG-137）：copy-ui.ts 的导航外壳与公共件文案，逐成员 satisfies 对应中文对象的类型。
// 导航外壳与公共件文案（页面标题 / 导航 / 分页 / 弹窗 / 账号菜单 / 底栏等）。

import { FOOT_COPY, MODAL_COPY, NAV_COPY, PAGED_COPY, TOP_COPY } from './copy-ui';

export const PAGED_COPY_EN = {
  total: (n: number) => `${n} in total`,
  prev: 'Previous',
  next: 'Next',
  older: 'Earlier',
  loading: 'Loading…',
} satisfies typeof PAGED_COPY;

export const MODAL_COPY_EN = {
  close: 'Close',
} satisfies typeof MODAL_COPY;

export const NAV_COPY_EN = {
  pages: {
    overview: { label: 'Overview', icon: 'O' },
    map: { label: 'Map', icon: 'M' },
    city: { label: 'City', icon: 'C' },
    army: { label: 'Army', icon: 'A' },
    growth: { label: 'Growth', icon: 'G' },
    intel: { label: 'Intel', icon: 'I' },
    agent: { label: 'Agent', icon: 'AI' },
  },
  cityMenuTitle: 'Switch City',
  cityLoading: 'Loading…',
  cityMain: 'Main City',
  cityBranch: 'Branch City',
  cityFamous: 'Famous City',
  citySwitching: 'Switching…',
  cityMeta: (level: number, count: number) => `Lv${level} · ${count} cities in total`,
  cityMetaSolo: (level: number) => `Lv${level}`,
  account: 'Account',
  accountShort: 'Me',
  rename: 'Rename City',
  settings: 'Account Settings',
  switchAccount: 'Switch Account',
  reset: 'Reset Account',
  exchangeMobile: 'Market',
  leaderboardMobile: 'Leaderboard',
  theme: 'Theme',
  /** 语言切换行（AISLG-137，账号菜单里紧挨皮肤行） */
  language: 'Language',
  // 语言选项「中文」在任何语言下都显示「中文」，不翻译。
  languageZh: '中文',
  languageEn: 'English',
} satisfies typeof NAV_COPY;

export const TOP_COPY_EN = {
  exchange: 'Market',
  leaderboard: 'Board',
  fullTip: (percent: number) => `Storage ${percent}% full`,
  net: (rate: number) => `${rate >= 0 ? '+' : ''}${rate}/h`,
  popLabel: 'Population',
  // 中文 '人' 是紧凑人口的单位后缀；英文紧凑格只放数字（完整含义由人口悬浮模板表达），单位留空。
  popShort: '',
  popCap: (cap: number) => `Cap ${cap}`,
  alertNpc: (target: string) => `NPC attack · ${target}`,
  /** 玩家来袭（v38 AISLG-122，预警与 NPC 共用队列，按 attacker 区分） */
  alertPlayer: (target: string) => `Player attack · ${target}`,
  alertNpcCity: 'Main City',
  alertTruce: (left: string) => `Truce ${left}`,
  loading: 'Loading…',
} satisfies typeof TOP_COPY;

export const FOOT_COPY_EN = {
  running: 'In progress',
  idle: 'Nothing in progress',
  lane: { build: 'Build', recruit: 'Recruit', tech: 'Research', march: 'March' },
  feedTag: 'Server',
  feedEmpty: 'No server announcements yet',
  feedOpen: 'Open to view past server announcements',
  feedTitle: 'Server Announcements',
  feedClose: 'Close',
} satisfies typeof FOOT_COPY;
