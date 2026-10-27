// 洛阳争夺（v79，AISLG-200）的协议类型：洛阳状态 / 洛阳之主 / 政令。

import type { DecreeKind } from './luoyang';

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
  /** 生效截止（ISO 8601） */
  until: string;
  /** 下一次可发布时刻 */
  nextAt: string;
  /** 我是否是该联盟盟主且当前可以发布 */
  canPublish: boolean;
  /** 发布者（洛阳之主联盟盟主） */
  leaderName: string | null;
}

export interface LuoyangStatusView {
  /** 洛阳城与当前占领者；洛阳尚未被玩家占领（NPC 阶段）为 null */
  owner: LuoyangOwnerView | null;
  /** 当前是否在争夺窗口内（北京时间每周六 21:00–23:00） */
  windowOpen: boolean;
  windowStartAt: string;
  windowEndAt: string;
  /** 下一次开放时刻（窗口内为本次开始） */
  nextOpenAt: string;
  /** 洛阳之主联盟的全员产量加成（百分数；没有洛阳之主为 0） */
  bonusPercent: number;
  /** 洛阳可接收的协防部队上限 */
  assistCap: number;
  /** 洛阳之主联盟的当前政令；没有生效政令为 null */
  decree: LuoyangDecreeView | null;
  /** 我是否可以发布政令（洛阳之主盟主且不在 7 天冷却内） */
  canPublishDecree: boolean;
  /** 下一次可发布政令时刻（没有洛阳之主为 null） */
  decreeNextAt: string | null;
  /** 我所在联盟是否洛阳之主 */
  myAllianceIsHolder: boolean;
}

export interface PublishDecreeRequestData {
  kind: DecreeKind;
}

export type PublishDecreeResponseData = LuoyangStatusView;
