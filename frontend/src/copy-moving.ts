// 移动目标（流寇 / 运粮商队）文案（v28 AISLG-78；与 copy.ts 分文件以控制单文件行数）。
// v35（AISLG-112）截击改为「到了先埋伏」：提前到达不再扑空，部队原地埋伏等目标经过。

export const MOVING_COPY = {
  panel: {
    title: '流寇与商队',
    empty: '暂时没有移动目标（有玩家在线活动时会定期刷出，沿固定路线移动、过时消失）',
    hint: '路线与时刻表公开：出征选路线上的某一格，部队提前到达会原地埋伏，等目标走进该格或相邻格再开打',
    row: (label: string, level: number) => `${label} Lv${level}`,
    nowAt: (x: number, y: number) => `现在 (${x},${y})`,
    leaves: (remaining: string) => `${remaining} 后消失`,
    locate: '定位',
    strength: (min: number, max: number) => `守军约 ${min}–${max}`,
    loot: (min: number, max: number) => `带资源约 ${min}–${max}`,
    kindTag: { caravan: '商队', bandit: '流寇' } as Record<string, string>,
    banditNote: '流寇路过玩家野地会顺手掠夺采集收益',
    caravanNote: '守军弱，资源较多',
  },
  /** 地块详情里的截击表单 */
  intercept: {
    title: '截击移动目标',
    pickTarget: '选择要截击的目标',
    passAt: (label: string, level: number, clock: string) => `${label} Lv${level} 预计 ${clock} 经过此格`,
    passed: '该目标已经过了这一格',
    etaLine: (mine: string, theirs: string) => `你的部队预计 ${mine} 到达，目标预计 ${theirs} 经过`,
    verdictOk: '赶得上：到达时目标就在这一格或相邻格，立即接战',
    verdictAmbush: (wait: string, clock: string) => `将埋伏约 ${wait}，预计 ${clock} 接战（目标走进相邻格时开打）`,
    verdictLate: '赶不上：到达时目标已走远，会扑空返程',
    recommend: (x: number, y: number, clock: string) => `推荐截击格 (${x},${y}) · ${clock} 接战`,
    submit: '出兵截击',
    hint: (reach: number) => `部队提前到达会先埋伏，等目标走进选定格或相邻格（距离 ≤ ${reach}）再开打；太晚（目标已走远）才扑空；打赢按负重带走它携带的资源`,
    noTargets: '',
  },
  march: {
    label: (x: number, y: number) => `截击 → (${x},${y})`,
    ambushLabel: (x: number, y: number) => `埋伏中 → (${x},${y})，等目标经过`,
    started: (x: number, y: number, dueClock: string) => `部队出动截击 → (${x},${y})，预计 ${dueClock} 接战`,
  },
  event: {
    intercepted: (label: string, pos: string, loot: string, survivors: string) =>
      `截获${label} ${pos}：掠得${loot || '（无战利品）'}${survivors ? `，幸存 ${survivors} 返程` : ''}`,
    lost: (label: string, pos: string, survivors: string) => `截击${label} ${pos} 失败${survivors ? `，残部撤回（${survivors}）` : '，出击部队全灭'}`,
    missed: (pos: string) => `截击 ${pos} 扑空：到达时目标已走远，部队返程`,
    gone: (pos: string) => `截击 ${pos}：目标已消失（被击败或过时），部队返程`,
    banditPlundered: (pos: string, resource: string, amount: number) => `流寇路过野地 ${pos}，掠走${resource} ${amount}`,
  },
  report: {
    kind: '截击',
    endNoContactMissed: '扑空：到达时目标已走远，没有接战',
    endNoContactGone: '目标已消失（已被击败或过时），没有接战',
    sideMissed: '（已走远）',
  },
};
