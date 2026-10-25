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
    starTower: { label: '将星塔', icon: '塔' },
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
  discardBranch: '放弃分城',
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

/** 顶栏赛季胶囊（v65，AISLG-134）：「S2 · 剩 18 天」；≤3 天改醒目色并显示时分秒。宽屏 / 窄屏两套写法 */
export const SEASON_COPY = {
  pillLong: (id: number, days: number) => `S${id} · 剩 ${days} 天`,
  pillShort: (id: number, days: number) => `S${id}·${days}天`,
  urgentLong: (id: number, days: number, clock: string) => (days > 0 ? `S${id} · 剩 ${days} 天 ${clock}` : `S${id} · 剩 ${clock}`),
  urgentShort: (id: number, days: number, clock: string) => (days > 0 ? `S${id}·${days}天${clock}` : `S${id}·${clock}`),
  ending: (id: number) => `S${id} · 换季中`,
  pillTitle: (id: number, endsAt: string) => `第 ${id} 赛季结束于 ${endsAt}（现实时间）`,
  /** 换季遮罩（PUSH_SEASON resetting / MAINTENANCE） */
  maskTitle: '换季中，请稍候…',
  maskHint: '服务端正在重置世界（地图、城池、军队、武将），几分钟后自动恢复；账号、令牌与第三方绑定保留。',
  maskRetry: '服务端维护中，稍后自动确认',
  /** 新赛季开始的提示（重连完成后） */
  startedToast: '新赛季开始',
  /** 换季预告弹窗（T-1d / T-1h / T-10m） */
  warning: {
    title: '换季预告',
    stage: { 'T-1d': '还剩 1 天', 'T-1h': '还剩 1 小时', 'T-10m': '还剩 10 分钟' } as Record<string, string>,
    body: (id: number, endsAt: string) =>
      `第 ${id} 赛季将于 ${endsAt} 结束，届时服务端会短暂停服并重置世界（地图、城池、军队、武将等）。账号、令牌与第三方绑定保留，各榜前列会留在名人堂。`,
    hint: '换季前请把行军、建造与征兵安排好',
    confirm: '知道了',
  },
  /** 我的荣誉（排行榜名人堂页签顶部） */
  honorsLabel: '我的荣誉',
  honorsNone: '暂无荣誉',
};

/** 名人堂（v65，AISLG-134）：排行榜弹窗内的第二个视图 */
export const HALL_COPY = {
  switchLive: '实时榜',
  switchHall: '名人堂',
  seasonLabel: '赛季',
  seasonEnded: (endedAt: string) => `结束于 ${endedAt}`,
  /** 没有任何已结束赛季时的空态（不出现表格） */
  emptyNoSeason: '第 1 季结束后，这里会留下各榜前列',
  emptyRows: '这一榜暂无记录',
  loading: '加载中…',
  loadFailed: '名人堂加载失败，稍后再试',
  more: '更多',
  kinds: { power: '力量', territory: '领土', plunder: '掠夺', model: '模型', arena: '竞技场', starTower: '将星塔', alliance: '联盟' } as Record<string, string>,
  rankColumn: '名次',
  playerColumn: '玩家',
  modelColumn: '模型',
  modelPlayers: (n: number) => `${n} 人`,
  modelValueColumn: '均战力',
  agentModelBadge: '自报',
  modelRule: '模型榜：按自报模型归类，名次为该模型实力前 10 名的平均战力；统计本赛季内的数据，结算存档不影响实时榜。',
};
