// 伤兵营「全部城池一键处理」文案（v88，AISLG-218）：汇总行、全城按钮、确认框与结果摘要。
// 挂在 ARMY_COPY.pools.poolsAll 下（copy-pages.ts 引用本对象），英文孪生见 copy-troop-pools-en.ts。
// 数值与规则不改：这里只有文案，花费 / 进度一律沿用现有 restoreCostPreview 与池子规则。

export const TROOP_POOL_ALL_COPY = {
  /** 汇总行：全部城池的合计（示例：全部城池：伤兵 128（5 座城有）· 最早 3 小时后过期） */
  summary: (poolLabel: string, total: number, citiesWith: number) => `全部城池：${poolLabel} ${total}（${citiesWith} 座城有）`,
  /** 汇总行的最早过期片段（不足 6 小时整体标红） */
  earliest: (remain: string) => ` · 最早 ${remain}后过期`,
  /** 全账号该池子为空（按钮同时置灰） */
  empty: '全部城池：无',
  /** 一键按钮（按池子不同） */
  healAll: '全部治疗',
  abandonAll: '全部放弃',
  recruitAll: '全部招降',
  releaseAll: '全部释放',
  recallAll: '全部劝回',
  /** 确认框 */
  dialogTitleRestore: '全部城池一键处理',
  dialogTitleRelease: '全部城池一键放弃',
  rowHost: (name: string, isMain: boolean) => (isMain ? `${name}（主）` : name),
  rowJoin: ' · ',
  rowFree: '免费，不返还任何东西',
  rowSkippedStarving: '跳过：断粮中',
  rowPopulation: (n: number) => `另扣人口 ${n}`,
  totalCost: (cost: string) => `合计花费 ${cost}`,
  totalFree: '合计：免费，不返还任何东西',
  totalSkipped: (n: number) => `（${n} 座城断粮中，跳过）`,
  confirm: '确认处理',
  cancel: '取消',
  busy: '处理中…',
  /** 结果摘要 */
  resultTitle: '处理结果',
  resultSuccess: '成功',
  /** 失败短语（结果摘要第一行；原因文本单独占一行，见 AISLG-219） */
  resultFailed: '失败',
  resultSummary: (ok: number, failed: number) => `成功 ${ok} 座 · 失败 ${failed} 座`,
  resultAllOk: (ok: number) => `${ok} 座城全部处理完成`,
  done: '知道了',
  offline: '连接已断开，无法处理',
};
