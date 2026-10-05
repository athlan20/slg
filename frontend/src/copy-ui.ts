// 导航外壳与公共件文案（页面标题 / 导航 / 分页 / 弹窗 / 账号菜单 / 底栏等）。

export const PAGED_COPY = {
  total: (n: number) => `共 ${n} 条`,
  prev: '上一页',
  next: '下一页',
  older: '更早',
  loading: '加载中…',
};

export const MODAL_COPY = {
  close: '关闭',
};

export const NAV_COPY = {
  pages: {
    overview: { label: '总览', icon: '览' },
    map: { label: '地图', icon: '图' },
    city: { label: '城池', icon: '城' },
    army: { label: '军队', icon: '兵' },
    growth: { label: '养成', icon: '养' },
    intel: { label: '情报', icon: '报' },
    agent: { label: 'Agent', icon: 'A' },
  },
  cityMenuTitle: '切换城池',
  cityLoading: '加载中…',
  cityMain: '主城',
  cityBranch: '分城',
  cityFamous: '名城',
  citySwitching: '切换中…',
  cityMeta: (level: number, count: number) => `Lv${level} · 共 ${count} 城`,
  cityMetaSolo: (level: number) => `Lv${level}`,
  account: '账号',
  accountShort: '我',
  rename: '城池改名',
  settings: '账号设置',
  switchAccount: '切换账号',
  reset: '重置账号',
  exchangeMobile: '集市',
  leaderboardMobile: '排行榜',
  theme: '皮肤',
  /** 语言切换行（AISLG-137，账号菜单里紧挨皮肤行） */
  language: '语言',
  languageZh: '中文',
  languageEn: 'English',
};

export const TOP_COPY = {
  exchange: '集市',
  leaderboard: '榜',
  fullTip: (percent: number) => `仓库已满 ${percent}%`,
  net: (rate: number) => `${rate >= 0 ? '+' : ''}${rate}/h`,
  popLabel: '人口',
  popShort: '人',
  popCap: (cap: number) => `上限 ${cap}`,
  alertNpc: (target: string) => `NPC 来袭 · ${target}`,
  /** 玩家来袭（v38 AISLG-122，预警与 NPC 共用队列，按 attacker 区分） */
  alertPlayer: (target: string) => `玩家来袭 · ${target}`,
  alertNpcCity: '主城',
  alertTruce: (left: string) => `免战 ${left}`,
  loading: '加载中…',
};

export const FOOT_COPY = {
  running: '进行中',
  idle: '暂无进行中的事项',
  lane: { build: '建造', recruit: '征兵', tech: '研究', march: '行军' },
  feedTag: '全服',
  feedEmpty: '暂无全服播报',
  feedOpen: '点开查看全服播报历史',
  feedTitle: '全服播报',
  feedClose: '关闭',
};
