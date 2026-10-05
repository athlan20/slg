// 玩家对抗（一）的协议载荷类型（v38，AISLG-122）：PUSH_ATTACK_WARNING 预警、
// TRUCE 主动免战与地块保护状态视图。规则与数值在 common/src/protection.ts。

import type { TroopKind } from './protocol-army';

/** PUSH_ATTACK_WARNING（op 2017）推送载荷（v38，AISLG-122）：玩家部队来袭预警。
 *  与 NPC 来袭预警（PUSH_NPC_ATTACK_WARNING，op 2010）同构，另带 attacker 进攻方；
 *  预警在进攻方 MARCH 成功时即发出，arriveAt = 行军到达时刻（预警提前量 = 行军
 *  时长本身，烽火台只影响敌情详细度、不延长提前量）。
 *  v39（AISLG-123）起 target 另有 'wilderness'：抢占他人野地的出征同样预警
 *  （被抢占方按其所属城烽火台分档看到敌情）。 */
export interface PlayerAttackWarningPushData {
  /** 进攻方行军 id（唯一键，客户端去重用） */
  marchId: string;
  x: number;
  y: number;
  /** 来袭目标：city = 城池（v38）；wilderness = 抢占占领野地（v39） */
  target: 'city' | 'wilderness';
  /** 目标地形（仅 wilderness；city 为 null） */
  terrain: string | null;
  /** 目标等级（仅 wilderness；city 为 0） */
  level: number;
  /** 敌情详细度（由被袭击城的烽火台等级决定，与 NPC 预警同分档）：
   *  range 只给总兵力范围 / kinds 另给各兵种范围 / exact 另给精确编成 army */
  intel?: 'range' | 'kinds' | 'exact';
  /** 被袭击城的烽火台等级（0 = 未建） */
  beaconLevel?: number;
  armyMin: number;
  armyMax: number;
  armyKinds?: Partial<Record<TroopKind, { min: number; max: number }>>;
  army?: Partial<Record<TroopKind, number>>;
  /** 进攻方（发起 MARCH 的账号与出发城） */
  attacker: { username: string; cityId: string; cityName: string };
  /** 预计到达时刻（ISO 8601；即行军到达结算时刻） */
  arriveAt: string;
}

/** TRUCE（op 53）请求载荷：开启主动免战，无参数 */
export interface TruceRequestData {}

/** TRUCE（op 53）响应载荷 */
export interface TruceResponseData {
  /** 免战截止时刻（ISO 8601，本次开启 12 小时基准随缩放） */
  shieldUntil: string;
  /** 下一次可开启时刻（ISO 8601；本周期内再次开启返回 TRUCE_WEEKLY_USED） */
  nextAvailableAt: string;
}

/** 玩家城与他人占领野地的保护状态（TileView.protection，v38 / v39）：任一截止时刻
 *  未到即受保护；非玩家目标、自己的地为 null。到期自动失效，无事件。 */
export interface TileProtectionView {
  /** 新手保护截止（账号级；别人不能侦察 / 攻击他，含他的野地） */
  newbieUntil: string | null;
  /** 被动免战截止（城级：被攻破 / 被抢后；只保护城本身，不保护野地——野地为 null） */
  truceUntil: string | null;
  /** 主动免战截止（账号级：开着时别人打不了他，含抢他的野地） */
  shieldUntil: string | null;
  /** 换主保护截止（地块级，v39：野地刚被抢占后的保护期内谁都不能再抢；城池为 null） */
  ownerChangedUntil: string | null;
}
