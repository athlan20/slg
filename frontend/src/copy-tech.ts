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
    // 返回值显式放宽为 string：三元直返字面量会被推断成字面量联合，英文孪生将无法 satisfies
    scoutDetail: (level: number): string =>
      level >= 6 ? '当前：精确数量' : level >= 3 ? '当前：兵种明细（数量为近似）' : '当前：只看总兵力约数',
  },
  /** 侦察科技决定情报详细度（侦察报告 / 地块详情） */
  scout: {
    rough: (min: number, max: number) => `侦察精度不足：只能看到总兵力约 ${min}–${max}（侦察科技 Lv3 起可见兵种明细、Lv6 起精确）`,
    kinds: (min: number, max: number) => `兵种明细为近似值，总兵力约 ${min}–${max}（侦察科技 Lv6 起精确）`,
    approx: '≈',
    garrisonRange: (min: number, max: number) => `总兵力约 ${min}–${max}`,
    /** 地块详情守军行的紧凑写法：行内已有守军标签，不带「总兵力」前缀 */
    garrisonRangeShort: (min: number, max: number) => `约 ${min}–${max}`,
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
  /** 科技效果说明（AISLG-137）：协议里的 effect 是服务端中文，前端按科技维护对照（不改协议）；
   *  中文值镜像 backend/common/src/tech.ts 的 effect，界面显示以这里为准 */
  effectText: {
    farming: '粮、木、石、铁产量每级 +5%',
    carrying: '部队负重每级 +5%（掠夺与运输共用）',
    marching: '行军速度每级 +5%',
    storage: '粮、木、石、铁储量上限每级 +5%',
    scouting: '侦察报告更详细：Lv3 起看到兵种明细，Lv6 起看到精确数量',
    defense: '主城守城时城墙减伤每级额外 +1%（加在城墙加成上）',
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
