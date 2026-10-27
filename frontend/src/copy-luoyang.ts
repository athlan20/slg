// 洛阳争夺文案（v79，AISLG-200）。

export const LUOYANG_COPY = {
  title: '洛阳争夺',
  owner: (name: string, alliance: string | null) => `洛阳之主：${name}${alliance ? ` · ${alliance}` : ''}`,
  noOwner: '洛阳仍是 NPC 城池（两阶段攻打，不受窗口限制）',
  windowOpen: (end: string) => `争夺窗口开放中，${end} 结束`,
  windowClosed: (next: string) => `窗口关闭，下次开放 ${next}`,
  bonus: (percent: number) => `洛阳之主联盟全员四资源产量 +${percent}%`,
  assist: (cap: number) => `洛阳可接收 ${cap} 支协防`,
  durability: (value: number) => `城防值 ${value}/100`,
  decree: {
    title: '政令',
    active: (name: string, until: string) => `${name} · 至 ${until}`,
    none: '当前没有政令',
    next: (at: string) => `下次可发布 ${at}`,
    publish: '发布政令',
    pick: '选择政令',
    kinds: {
      recruit: '征兵时长 −15%',
      march: '行军速度 +10%',
      research: '科技研究时长 −15%',
    },
    published: '政令已发布',
    note: '仅洛阳之主盟主可发布，每 7 天一次，持续 7 天；洛阳易主时立即失效。',
  },
  errors: {
    fallback: '洛阳操作失败，请稍后再试',
    DECREE_NOT_HOLDER: '只有洛阳之主的盟主可以发布政令',
    DECREE_COOLDOWN: '政令每 7 天只能发布一次',
    LUOYANG_CLOSED: '洛阳只在每周六 21:00–23:00 开放',
    INVALID_PARAMS: '参数不正确',
  },
  close: '关闭',
};
