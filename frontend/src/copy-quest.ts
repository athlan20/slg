// 任务与签到的界面文案（v53/v54，AISLG-200；与 copy.ts 分文件以控制单文件行数）。
// 组件用 useCopy().QUEST_COPY；状态层（questSession）用 getCopy().QUEST_COPY。

export const QUEST_COPY = {
  panel: {
    title: '任务',
    loading: '加载中…',
    claim: '领取',
    claimed: '已领',
    undone: '未完成',
    locked: '未解锁',
    notReached: '未达',
    claimable: (n: number) => `可领取 ${n}`,
    allClear: '今日已清',
  },
  tabs: {
    daily: '日常',
    main: '主线',
    achv: '成就',
    act: '活动',
  },
  signin: {
    title: '每日签到',
    streak: (days: number, total: number) => `连续 ${days} 天 · 累计 ${total} 次`,
    button: '签到',
    signed: '已签到',
    busy: '处理中…',
    day: (d: number) => `第${d}天`,
    dayTitle: (d: number, reward: string) => `第 ${d} 天：${reward}`,
  },
  main: {
    progress: (cur: number, total: number) => `进度 ${cur} / ${total} 环（顺序解锁）`,
  },
  achv: {
    sideLabel: '支线',
    achvLabel: '成就',
    current: (v: number) => `当前 ${v}`,
    tierTitle: (threshold: number, reward: string) => `达标 ${threshold} · 奖励 ${reward}`,
  },
  act: {
    dailyTag: '每日',
    endsTag: (date: string) => `截止 ${date}`,
    rewardLine: (reward: string) => `奖励 ${reward}`,
  },
  reward: {
    line: (desc: string, reward: string) => `${desc} · 奖励 ${reward}`,
  },
  errors: {
    daily: '任务未完成或今日已领取',
    signin: '今日已签到',
    quest: '条件未达成或已领取',
    claim: '领取失败',
    net: '网络异常，领取失败',
  },
};
