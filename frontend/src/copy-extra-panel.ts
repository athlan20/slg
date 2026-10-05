// 组件内联文案集中（AISLG-137）：功能面板与页面组件里零散的中文字面量（拼接词、
// 短标签、少量整句）收拢到本文件，按组件语义分组；英文孪生见 copy-extra-panel-en.ts。
// 有既有文案键可复用的（如 COPY.cityMap.noCity）不进这里，组件直接复用原键。

export const EXTRA_PANEL = {
  /** 拼接词（全角标点在英文里换成半角加空格） */
  joiners: {
    /** 「标题：值」的全角冒号 */
    colon: '：',
    /** 枚举罗列的顿号 */
    enum: '、',
    /** 说明性小括号包裹 */
    paren: (text: string) => `（${text}）`,
  },
  /** Agent 卡（AgentPanel） */
  agentPanel: {
    /** 卡片标题 */
    title: 'Agent 状态与计划',
  },
  /** 战报弹窗（BattleReportModal） */
  battleReport: {
    /** 未接战结局的胜负徽章：目标消失 / 扑空 */
    resultTargetGone: '目标消失',
    resultMissed: '扑 空',
  },
  /** 武将卡（HeroCard） */
  heroCard: {
    /** 城守状态的城名兜底（城 id 查不到名字时） */
    cityFallback: '城池',
  },
  /** 离线日报摘要卡（OfflineSummaryCard） */
  offlineSummary: {
    /** 损失区减员行标签 */
    troopsLostLabel: '减员',
  },
  /** 城内视图（CityGrid）：三行分组标签（role 沿用分组中文 label，显示用这里） */
  cityGrid: {
    groupLabel: { resource: '资源', civil: '内政', military: '军事' } as Record<string, string>,
  },
  /** 手机分段条（PageGrid 的 blocks）上没有现成文案键的短标签 */
  pageTabs: {
    queue: '队列',
    stats: '概况',
    detail: '详情',
    log: '记录',
    daily: '日报',
    troops: '兵力',
  },
  /** 总览页泳道（OverviewPage） */
  overviewPage: {
    /** 泳道条目尚未起跑（排队等待）时的剩余时间占位 */
    queued: '排队',
  },
  /** 军情摘要（MilitarySummary） */
  militarySummary: {
    /** 多批来袭的批次后缀 */
    wavesTotal: (n: number) => `共 ${n} 批`,
  },
  /** 侦察报告（ScoutReportModal） */
  scoutReport: {
    /** 相对时间里不足 1 分钟的说法 */
    justNow: '刚刚',
  },
};
// 不写 as const：英文孪生（copy-extra-panel-en.ts）以本对象的类型为基准（satisfies typeof）。
