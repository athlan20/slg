// 英文文案孪生（AISLG-137）：copy-ui.ts 的导航外壳与公共件文案，逐成员 satisfies 对应中文对象的类型。
// 导航外壳与公共件文案（页面标题 / 导航 / 分页 / 弹窗 / 账号菜单 / 底栏等）。

import { FOOT_COPY, HALL_COPY, MODAL_COPY, NAV_COPY, PAGED_COPY, SEASON_COPY, TOP_COPY } from './copy-ui';

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
    starTower: { label: 'Star Tower', icon: 'T' },
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
  discardBranch: 'Abandon Branch City',
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

/** Season pill (v65, AISLG-134): "S2 · 18 days left"; ≤3 days switches to the alert style and shows the clock */
export const SEASON_COPY_EN = {
  pillLong: (id: number, days: number) => `S${id} · ${days} days left`,
  pillShort: (id: number, days: number) => `S${id}·${days}d`,
  urgentLong: (id: number, days: number, clock: string) => (days > 0 ? `S${id} · ${days}d ${clock} left` : `S${id} · ${clock} left`),
  urgentShort: (id: number, days: number, clock: string) => (days > 0 ? `S${id}·${days}d ${clock}` : `S${id}·${clock}`),
  ending: (id: number) => `S${id} · Season ending`,
  pillTitle: (id: number, endsAt: string) => `Season ${id} ends at ${endsAt} (real time)`,
  maskTitle: 'Season reset in progress, please wait…',
  maskHint: 'The server is resetting the world (map, cities, armies, heroes). It will be back in a few minutes; accounts, tokens and linked logins are kept.',
  maskRetry: 'Server under maintenance, checking again shortly',
  startedToast: 'A new season has started',
  warning: {
    title: 'Season ending soon',
    stage: { 'T-1d': '1 day left', 'T-1h': '1 hour left', 'T-10m': '10 minutes left' } as Record<string, string>,
    body: (id: number, endsAt: string) =>
      `Season ${id} ends at ${endsAt}. The server will pause briefly and reset the world (map, cities, armies, heroes). Accounts, tokens and linked logins are kept, and the top of each board goes into the Hall of Fame.`,
    hint: 'Plan your marches, builds and recruits before the reset',
    confirm: 'Got it',
  },
  honorsLabel: 'My honors',
  honorsNone: 'No honors yet',
} satisfies typeof SEASON_COPY;

export const HALL_COPY_EN = {
  switchLive: 'Live',
  switchHall: 'Hall of Fame',
  seasonLabel: 'Season',
  seasonEnded: (endedAt: string) => `Ended ${endedAt}`,
  emptyNoSeason: 'Once season 1 ends, the top of each board will be kept here',
  emptyRows: 'No entries on this board',
  loading: 'Loading…',
  loadFailed: 'Hall of Fame failed to load, try again later',
  more: 'More',
  kinds: { power: 'Power', territory: 'Territory', plunder: 'Plunder', model: 'Model', arena: 'Arena', starTower: 'Star Tower' } as Record<string, string>,
  rankColumn: 'Rank',
  playerColumn: 'Player',
  modelColumn: 'Model',
  modelPlayers: (n: number) => `${n} players`,
  modelValueColumn: 'Avg power',
  agentModelBadge: 'Self-reported',
  modelRule: 'Model board: grouped by self-reported model; rank = average power of that model\'s top 10 players. Counts only this season; the archive does not affect the live board.',
} satisfies typeof HALL_COPY;
