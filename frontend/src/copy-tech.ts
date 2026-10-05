// 科技研究文案（v27，AISLG-77；与 copy.ts 分文件以控制单文件行数）

import type { TechKind } from './api/protocol-tech';

export const TECH_COPY = {
  panel: {
    title: '科技',
    academyMeta: (level: number) => (level > 0 ? `书院 Lv${level}` : '尚未建造书院'),
    noAcademy: '建造书院后才能研究科技（第 N 级科技要求书院 ≥ N 级）。科技账号共享，所有城都生效',
    sharedHint: '科技账号共享，所有城都生效；同一时间只研究一项',
    levelTag: (level: number, max: number) => `Lv${level}/${max}`,
    currentEffect: (percent: number) => (percent > 0 ? `当前 +${percent}%` : '尚未生效'),
    nextLine: (level: number, cost: string, seconds: string) => `下一级 Lv${level}：${cost} · 耗时 ${seconds}`,
    maxed: '已满级',
    needAcademy: (required: number) => `需书院 Lv${required}`,
    research: '研究',
    researching: '研究中…',
    researchingRow: (label: string, level: number, remaining: string) => `正在研究 ${label} Lv${level}，剩余 ${remaining}`,
    cancel: '取消研究（全额返还）',
    cancelBusy: '取消中…',
    inProgressDisabled: '已有进行中的研究',
    insufficient: '资源不足',
    scoutDetail: (level: number) =>
      level >= 6 ? '当前：精确数量' : level >= 3 ? '当前：兵种明细（数量为近似）' : '当前：只看总兵力约数',
  },
  /** 侦察科技决定情报详细度（侦察报告 / 地块详情） */
  scout: {
    rough: (min: number, max: number) => `侦察精度不足：只能看到总兵力约 ${min}–${max}（侦察科技 Lv3 起可见兵种明细、Lv6 起精确）`,
    kinds: (min: number, max: number) => `兵种明细为近似值，总兵力约 ${min}–${max}（侦察科技 Lv6 起精确）`,
    approx: '≈',
    garrisonRange: (min: number, max: number) => `总兵力约 ${min}–${max}`,
    noVerdict: '精度不足，无法评估战力对比（先研究侦察科技）',
    summaryRough: (min: number, max: number) => `守军 总兵力约 ${min}–${max}`,
  },
  names: {
    farming: '农耕',
    carrying: '负重',
    marching: '行军',
    storage: '储存',
    scouting: '侦察',
    defense: '城防',
  } satisfies Record<TechKind, string>,
  session: {
    started: (label: string, level: number) => `开始研究 ${label} Lv${level}`,
    cancelled: (label: string, level: number) => `取消研究 ${label} Lv${level}，成本已返还`,
    rejected: (message: string) => `研究被拒绝（${message}）`,
    failedFallback: '发起研究失败',
  },
  errors: {
    levelMax: '该科技已满级',
    inProgress: '已有进行中的研究，同一时间只能研究一项（可等它完成或取消）',
    academyTooLow: (required: number, have: number) => `发起研究的城书院等级不足：需要 Lv${required}，当前 Lv${have}`,
    insufficient: '资源不足以支付研究成本',
    notCancellable: '没有可取消的研究（可能刚好完成了）',
    fallback: '科技操作失败',
  },
  event: {
    started: (label: string, level: number) => `开始研究 ${label} Lv${level}`,
    completed: (label: string, level: number) => `研究完成：${label} Lv${level}，全城生效`,
    cancelled: (label: string, level: number, refund: string) => `取消研究 ${label} Lv${level}${refund ? `，返还 ${refund}` : ''}`,
  },
};
