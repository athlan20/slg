// 遣散士兵（v84，AISLG-209）：把城内驻军按兵种解散，返还征兵成本的 50%（DISBAND_REFUND_PERCENT），
// 不返还人口。从 handlers-army.ts 独立出来（征兵 / 取消征兵已占一份），只处理这一条协议。
// 规则要点：
// - 只认**该城城内驻军**（city_army）；在外部队（行军 / 返程 / 运输 / 侦察）、野地驻军与协防部队都不动；
// - 立即生效，无等待时间；返还资源直接入账该城，不钳储量（与 CANCEL_RECRUIT 同口径）；
// - 城里有敌情（行军指向本城或其名下野地 / 未结 NPC 来袭，见 common/src/city-battle.ts）时拒绝，返回
//   CITY_IN_BATTLE，不改任何数据（否则会变成「躲战损 + 拿回一半资源」的投机）；
// - troops 为空对象 / 未知兵种 / 非正整数 → INVALID_PARAMS（分发层已校验）；某兵种超过城内数量 →
//   INSUFFICIENT_TROOPS，同样不改任何数据；
// - 断粮 / 欠饷 / 免战都不拦（断粮时遣散正是止损手段）；遣散后按新编成校正断粮计时：不再断粮时
//   清掉 mutiny_next_at / starve_warned_at（starveAt 由视图按新净产量现算）。
// 锁序：与其它城池类写操作一致——先锁城池行（lockCitySnapshot 内含生产结算）。

import { EventType, Op, RESOURCE_KEYS, TROOP_KINDS, isTroopKind, type InitiatorRole, type Resources, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { disbandRefund } from '../../common/src/troops';
import { loadArmyFoodUsePerHour, productionPerHour } from '../../common/src/production';
import { territoryDisplayRates } from '../../common/src/wilderness-reserve';
import { projectStarvation } from '../../common/src/starvation';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { loadCityState, lockCitySnapshot } from './views';

type Troops = Partial<Record<TroopKind, number>>;

/**
 * DISBAND_TROOPS 的 troops 解析（v84）：必须是非空对象，键为已知兵种、值为正整数；不合法返回 null
 * （调用方答 INVALID_PARAMS）。缺省 / null / 数组 / 空对象都拒绝。
 */
export function readDisbandTroops(data: Record<string, unknown> | undefined): { troops: Troops } | null {
  const raw = data?.troops;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const troops: Troops = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isTroopKind(key)) {
      return null;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return null;
    }
    troops[key] = value;
  }
  if (Object.keys(troops).length === 0) {
    return null;
  }
  return { troops };
}

/** 请求数量超过城内驻军的兵种（无则 null） */
function overAskedTroop(army: Record<TroopKind, number>, troops: Troops): TroopKind | null {
  for (const kind of TROOP_KINDS) {
    const count = troops[kind] ?? 0;
    if (count > (army[kind] ?? 0)) {
      return kind;
    }
  }
  return null;
}

/** 遣散：扣城内驻军、返还资源、写事件，成功后回遣散后的城池状态并推送同账号其它连接 */
export async function handleDisbandTroops(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  troops: Troops,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await lockCitySnapshot(client, accountId);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    const over = overAskedTroop(snap.army, troops);
    if (over !== null) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INSUFFICIENT_TROOPS');
      return;
    }
    // 敌情拦截（与放弃分城同一判定，见 views 的 inBattle）：不改任何数据
    if (snap.inBattle) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'CITY_IN_BATTLE');
      return;
    }

    const disbanded: Troops = {};
    for (const kind of TROOP_KINDS) {
      const count = troops[kind] ?? 0;
      if (count > 0) {
        disbanded[kind] = count;
      }
    }
    const refunded = disbandRefund(disbanded);
    const afterResources: Resources = { ...snap.resources };
    for (const key of RESOURCE_KEYS) {
      afterResources[key] = snap.resources[key] + refunded[key];
    }
    for (const kind of TROOP_KINDS) {
      const count = disbanded[kind] ?? 0;
      if (count <= 0) {
        continue;
      }
      await client.query(
        `UPDATE city_army SET count = count - $3, updated_at = now() WHERE city_id = $1 AND troop = $2`,
        [snap.cityId, kind, count],
      );
    }
    // 归零的行随后删除（与征兵完成 / 哗变减员的存储口径一致）
    await client.query(`DELETE FROM city_army WHERE city_id = $1 AND count <= 0`, [snap.cityId]);
    await client.query(
      `UPDATE cities SET gold = $2, wood = $3, food = $4, stone = $5, iron = $6 WHERE id = $1`,
      [snap.cityId, afterResources.gold, afterResources.wood, afterResources.food, afterResources.stone, afterResources.iron],
    );
    // 遣散后按新编成校正断粮计时：净产量转正（不会断粮）时清空哗变计时与预警标记，
    // 仍在断粮则保留原计时（Worker 按同一口径继续每小时哗变）。
    const armyUsePerHour = await loadArmyFoodUsePerHour(client, snap.cityId, snap.techs);
    const rates = productionPerHour(
      snap.levels,
      territoryDisplayRates(snap.territory),
      snap.productionBonusPercent + snap.luoyangBonusPercent,
      snap.techs,
      snap.guardProductionPercent,
    );
    if (projectStarvation(afterResources.food, rates.food - armyUsePerHour, Date.now()).starveAtMs === null) {
      await client.query(
        `UPDATE cities SET mutiny_next_at = NULL, starve_warned_at = NULL
         WHERE id = $1 AND (mutiny_next_at IS NOT NULL OR starve_warned_at IS NOT NULL)`,
        [snap.cityId],
      );
    }
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      type: EventType.TROOPS_DISBANDED,
      initiator: role,
      detail: { cityId: snap.cityId, troops: disbanded, refunded },
    });
    await client.query('COMMIT');

    // 遣散后的城池状态（资源 / 驻军 / 小时耗粮 / 断粮预警都已按新编成现算）
    const cityState = await loadCityState(ctx.pool, accountId, snap.cityId);
    respondOk(ctx.registry, conn, op, seq, {
      disbanded,
      refunded,
      ...(cityState ? { city: cityState } : {}),
    });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_CITY_STATE, push: true, data: { reason: 'troops_disbanded', cityId: snap.cityId } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
