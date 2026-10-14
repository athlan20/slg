// 公告的界面文案（AISLG-162，v60）：入口、列表、往期、正文、强提醒弹窗与全服播报的一句话。
// 英文孪生见 copy-announcement-en.ts（逐成员 satisfies 本文件的类型）。

export const ANNOUNCEMENT_COPY = {
  launcher: {
    label: '公告',
    open: '打开公告',
    unread: (count: number) => `${count} 条未读`,
  },
  modal: {
    title: '公告',
    empty: '暂时没有公告',
    loadFailed: '公告加载失败，请稍后再试',
    detailFailed: '正文加载失败，请稍后再试',
  },
  tabs: {
    active: '生效中',
    history: '往期',
  },
  category: {
    system: '系统',
    event: '活动',
  },
  badge: {
    pinned: '置顶',
    strong: '强提醒',
    unread: '未读',
    expired: '已结束',
  },
  detail: {
    back: '返回列表',
    loading: '正文加载中…',
    publishedAt: (time: string) => `发布于 ${time}`,
    endsAt: (time: string) => `结束于 ${time}`,
    noEnd: '长期有效',
  },
  history: {
    loadMore: '更早',
  },
  strong: {
    title: '重要公告',
    hint: '点「知道了」即标记为已读，之后不再弹出',
    confirm: '知道了',
  },
  broadcast: {
    text: (title: string) => `公告：${title}`,
    open: '查看公告',
  },
};
