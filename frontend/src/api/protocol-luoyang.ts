// 洛阳争夺（v79，AISLG-200）的前端协议镜像。

export const DECREE_KINDS = ['recruit', 'march', 'research'] as const;
export type DecreeKind = (typeof DECREE_KINDS)[number];

export interface LuoyangOwnerView {
  cityId: string;
  cityName: string;
  accountId: string;
  username: string;
  allianceId: string | null;
  allianceName: string | null;
  durability: number;
}

export interface LuoyangDecreeView {
  kind: DecreeKind;
  until: string;
  nextAt: string;
  canPublish: boolean;
  leaderName: string | null;
}

export interface LuoyangStatusView {
  owner: LuoyangOwnerView | null;
  windowOpen: boolean;
  windowStartAt: string;
  windowEndAt: string;
  nextOpenAt: string;
  bonusPercent: number;
  assistCap: number;
  decree: LuoyangDecreeView | null;
  canPublishDecree: boolean;
  decreeNextAt: string | null;
  myAllianceIsHolder: boolean;
}

export type PublishDecreeResponseData = LuoyangStatusView;
