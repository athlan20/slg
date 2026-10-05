// 玩家对抗（一）的 API 侧共用逻辑（v38，AISLG-122）：来袭预警事件与推送、新手保护
// 因主动进攻失效。从 handlers-world / handlers-battle 拆出以控制单文件行数；
// 结算侧在 Worker 的 pvp-raid.ts，规则在 common/src/protection.ts。

import pg from 'pg';
import { Op, type InitiatorRole, type TroopKind } from '../../common/src/protocol';
import { EventType } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { beaconLeadMultiplier, warningIntel } from '../../common/src/building-effects';
import { loadBuildingLevels } from '../../common/src/production';
import type { PlayerAttackWarningPushData } from '../../common/src/protocol-pvp';
import type { MarchRow } from './views';
import type { HandlerContext } from './handlers';

/** 预警载荷的公共部分（march_started 事件 detail 与 PUSH_ATTACK_WARNING data 同构；
 *  调用方补 attacker / arriveAt / marchId） */
export async function buildWarningIntel(
  client: pg.PoolClient,
  targetCityId: string,
  troops: Partial<Record<TroopKind, number>>,
): Promise<Record<string, unknown>> {
  // 敌情按被袭击城的烽火台等级分档（与 NPC 来袭预警同口径）；烽火台不延长提前量——
  // 玩家来袭的预警窗口就是行军时长本身
  const beacon = (await loadBuildingLevels(client, targetCityId)).beacon;
  const intel = warningIntel(troops, beacon);
  return { beaconLevel: beacon, beaconLead: beaconLeadMultiplier(beacon), ...intel };
}

/**
 * 玩家部队来袭预警（v38 AISLG-122 城池；v39 AISLG-123 野地抢占）：MARCH 成功发起后，
 * 在发起事务内给守方账号写 player_attack_warning 事件；提交后由调用方经 pushAttackWarning
 * 推送在线连接。野地目标的敌情按其所属城（targetCityId）的烽火台分档（AISLG-81 口径）。
 * 返回事件 detail（与推送 data 同构）。
 */
export async function insertAttackWarning(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  target: {
    accountId: string;
    /** 城池目标 = 该城；野地目标 = 占领该地块的城（烽火台归属） */
    cityId: string;
    x: number;
    y: number;
    kind: 'city' | 'wilderness';
    terrain: string | null;
    level: number;
  },
  attacker: { username: string; cityId: string; cityName: string },
): Promise<Record<string, unknown>> {
  const intel = await buildWarningIntel(client, target.cityId, troops);
  const detail: Record<string, unknown> = {
    x: target.x,
    y: target.y,
    target: target.kind,
    terrain: target.terrain,
    level: target.level,
    ...intel,
    attacker: { username: attacker.username, cityId: attacker.cityId, cityName: attacker.cityName },
    arriveAt: march.arrive_at.toISOString(),
    marchId: march.id,
  };
  await insertEvent(client, {
    accountId: target.accountId,
    cityId: target.cityId,
    buildId: march.id,
    type: EventType.PLAYER_ATTACK_WARNING,
    initiator: null,
    detail,
  });
  return detail;
}

/** 预警推送给守方账号的全部在线连接（提交后调用；漏收由事件流兜底） */
export function pushAttackWarning(ctx: HandlerContext, defenderAccountId: string, detail: Record<string, unknown>): void {
  ctx.registry.broadcast(
    defenderAccountId,
    { op: Op.PUSH_ATTACK_WARNING, push: true, data: detail },
  );
}

/**
 * 新手保护因主动进攻失效（v38 AISLG-122 城池；v39 AISLG-123 抢野地）：保护期内的账号
 * 侦察或攻击**其他玩家**（侦察 / 掠夺其城池、抢占其野地），保护立即结束（打野地 / NPC
 * 不触发）。返回 true = 本次确实终结了保护（写事件）。
 */
export async function breakNewbieProtection(
  client: pg.PoolClient,
  accountId: string,
  cause: 'scout' | 'plunder' | 'occupy',
  target: { username: string; x: number; y: number },
  initiator: InitiatorRole,
): Promise<boolean> {
  const upd = await client.query(
    `UPDATE accounts SET newbie_until = NULL WHERE id = $1 AND newbie_until IS NOT NULL RETURNING newbie_until`,
    [accountId],
  );
  if (!upd.rowCount) {
    return false;
  }
  await insertEvent(client, {
    accountId,
    type: EventType.NEWBIE_PROTECTION_ENDED,
    initiator,
    detail: { cause: 'aggression', action: cause, target: { username: target.username, x: target.x, y: target.y } },
  });
  return true;
}
