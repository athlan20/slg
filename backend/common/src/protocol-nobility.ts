// 声望与爵位协议（v76，AISLG-197）：查询爵位 / 每日俸禄状态与领取俸禄。
// 规则与数值见 common/src/nobility.ts。

/** 爵位状态（GET_NOBILITY 响应；也用于展示） */
export interface NobilityStatusView {
  /** 累计声望（只增不减，换季清零） */
  prestige: number;
  /** 爵位序号（0 = 平民）与名称 */
  index: number;
  name: string;
  privilege: string;
  /** 下一级爵位；已到「王」为 null */
  next: { index: number; name: string; threshold: number } | null;
  /** 距离下一级的进度（0..100；已满级为 100） */
  progressPercent: number;
  /** 每日俸禄（金币；平民为 0） */
  salaryGold: number;
  /** 今日（北京日）是否已领 */
  claimedToday: boolean;
  /** 现在是否可以领（非平民且今日未领） */
  claimable: boolean;
  /** 最近一次领取时刻（ISO；从未领过为 null） */
  lastClaimedAt: string | null;
  /** 下一可领时刻（今日已领为明日 0 点北京时间；否则为现在） */
  nextClaimAt: string;
  /** 普通武将上限加成（五大夫 +1、列侯再 +1） */
  heroCapBonus: number;
  /** 能否占领名城（爵位 ≥ 大夫） */
  canOccupyFamous: boolean;
}

export type GetNobilityResponseData = NobilityStatusView;

/** CLAIM_NOBILITY_SALARY 响应 */
export interface ClaimNobilitySalaryResponseData {
  /** 本次领取的金币 */
  gold: number;
  /** 领取后的爵位与声望 */
  index: number;
  name: string;
  prestige: number;
  /** 领取时刻（ISO） */
  claimedAt: string;
}