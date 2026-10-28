// 声望与爵位（v76，AISLG-197）的前端协议镜像：与 backend/common/src/protocol-nobility.ts 同构。

export interface NobilityStatusView {
  prestige: number;
  index: number;
  name: string;
  privilege: string;
  next: { index: number; name: string; threshold: number } | null;
  progressPercent: number;
  salaryGold: number;
  claimedToday: boolean;
  claimable: boolean;
  lastClaimedAt: string | null;
  nextClaimAt: string;
  heroCapBonus: number;
  canOccupyFamous: boolean;
}

export type GetNobilityResponseData = NobilityStatusView;

export interface ClaimNobilitySalaryResponseData {
  gold: number;
  index: number;
  name: string;
  prestige: number;
  claimedAt: string;
}
