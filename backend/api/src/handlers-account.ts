// 账号级城池管理协议（v7/v9）：RENAME_CITY 城池改名与 RESET_ACCOUNT 一键重置。
// 从 handlers-city.ts 拆出以控制单文件行数；协议分发见 handlers.ts。
import { EventType, Op, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { INITIAL_BUILDINGS, INITIAL_POPULATION, INITIAL_RESOURCES } from '../../common/src/rules';
import { newbieUntilFrom } from '../../common/src/protection';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { loadCityState, lockCitySnapshot } from './views';
import { CITY_NAME_MAX } from './handlers-city';

export async function handleRenameCity(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const raw = readString(data, 'name');
  const name = raw?.trim() ?? '';
  if (name.length < 1 || name.length > CITY_NAME_MAX) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await lockCitySnapshot(client, accountId);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    await client.query(`UPDATE cities SET name = $2 WHERE id = $1`, [snap.cityId, name]);
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      type: EventType.CITY_RENAMED,
      initiator: role,
      detail: { from: snap.name, to: name },
    });
    await client.query('COMMIT');

    respondOk(ctx.registry, conn, op, seq, { cityId: snap.cityId, name });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_CITY_STATE, push: true, data: { reason: 'city_renamed', cityId: snap.cityId, name } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * 一键重置账号数据（v9）：仅玩家连接可调用（Agent 返回 AGENT_FORBIDDEN）。全部游戏数据
 * 回到开号初始状态——城池资源、数字等级、名称（回默认「主城」）、人口、自带建筑（1 级
 * 官府）复原为 rules.ts 的 INITIAL_* 常量，其余建筑与等级、建造队列与历史、事件流清空，
 * 随后写入一条 account_reset 审计事件。v12 起一并清理世界数据：行军清空、占领野地回到
 * 无主、分城删除且其地块转回无主野地（NPC 城池有限存量，不因重置复活）。会话凭证
 * （sessions）保留，发起方与其他在线连接不掉线；重置不可逆，请求必须显式 confirm=true。
 * 锁序：先锁 builds（DELETE）再锁 cities，与 Worker / CANCEL_BUILD 一致，避免死锁。
 */
export async function handleResetAccount(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  // 仅限玩家连接：role 是连接自报标记，本限制拦住诚实声明的 Agent，不构成可验证的安全边界
  if (conn.role !== 'player') {
    respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    return;
  }
  if (data?.confirm !== true) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
    const accountId = conn.accountId as string;
    const role = conn.role as InitiatorRole;
    const client = await ctx.pool.connect();
    let firstCityId: string | null = null;
    try {
      await client.query('BEGIN');
      // 建造队列与历史（含在建条目）：与 Worker 的领取/激活并发时由行锁 + SKIP LOCKED 串开
      await client.query(`DELETE FROM builds WHERE account_id = $1`, [accountId]);
      // 征兵队列与历史一并清空（v11）
      await client.query(`DELETE FROM recruits WHERE account_id = $1`, [accountId]);
      // v27（AISLG-77）：科技等级与研究记录一并清空（回到开号初始状态）
      await client.query(`DELETE FROM tech_research WHERE account_id = $1`, [accountId]);
      // v29（AISLG-76）：黄巾之乱的个人贡献一并清空
      await client.query(`DELETE FROM yt_contrib WHERE account_id = $1`, [accountId]);
      await client.query(`DELETE FROM account_techs WHERE account_id = $1`, [accountId]);
      // 行军（出征与返程）一并清空（v12）：部队随重置消失，不结算到达
      await client.query(`DELETE FROM marches WHERE account_id = $1`, [accountId]);
      // 战报与侦察情报属账号游戏数据（v13）：一并清空
      await client.query(`DELETE FROM battle_reports WHERE account_id = $1`, [accountId]);
      await client.query(`DELETE FROM scout_intel WHERE account_id = $1`, [accountId]);
      const cityRes = await client.query(
        `SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at FOR UPDATE`,
        [accountId],
      );
      if (!cityRes.rowCount) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'INTERNAL');
        return;
      }
      firstCityId = cityRes.rows[0].id as string;
      const cityIds = cityRes.rows.map((row: { id: string }) => row.id);
      // 世界数据（v12）：占领的野地清驻军并回到无主；分城地块转回无主野地
      // （NPC 城池有限存量，被占后不复活）；随后删除分城行，主城与地块保留
      await client.query(
        `DELETE FROM tile_army WHERE (x, y) IN (
           SELECT x, y FROM world_tiles WHERE owner_city_id = ANY($1::uuid[])
         )`,
        [cityIds],
      );
      await client.query(
        `UPDATE world_tiles SET owner_city_id = NULL, npc = NULL,
                kind = CASE WHEN kind = 'city' THEN 'wilderness' ELSE kind END
         WHERE owner_city_id = ANY($1::uuid[])
           AND (kind = 'wilderness' OR (kind = 'city' AND owner_city_id <> $2))`,
        [cityIds, firstCityId],
      );
      await client.query(`DELETE FROM cities WHERE account_id = $1 AND id <> $2`, [accountId, firstCityId]);
      await client.query(
        `DELETE FROM city_buildings WHERE city_id = ANY($1::uuid[])`,
        [cityIds],
      );
    await client.query(`DELETE FROM city_army WHERE city_id = ANY($1::uuid[])`, [cityRes.rows.map((row: { id: string }) => row.id)]);
    // 复原开号之初（与注册同一套 INITIAL_* 常量）：资源、人口、自带建筑（1 级官府）
    await client.query(
      `UPDATE cities SET name = '主城', level = 1,
              gold = $2, wood = $3, food = $4, stone = $5, iron = $6,
              gold_rem = 0, food_rem = 0, wood_rem = 0, stone_rem = 0, iron_rem = 0,
              population = $7, population_rem = 0, settled_at = now()
       WHERE account_id = $1`,
      [
        accountId,
        INITIAL_RESOURCES.gold,
        INITIAL_RESOURCES.wood,
        INITIAL_RESOURCES.food,
        INITIAL_RESOURCES.stone,
        INITIAL_RESOURCES.iron,
        INITIAL_POPULATION,
      ],
    );
    for (const [kind, level] of Object.entries(INITIAL_BUILDINGS)) {
      await client.query(
        `INSERT INTO city_buildings (city_id, kind, level)
         SELECT id, $2, $3 FROM cities WHERE account_id = $1`,
        [accountId, kind, level],
      );
    }
    await client.query(`DELETE FROM events WHERE account_id = $1`, [accountId]);
    // Agent 自报计划属账号数据的一部分，一并清空（v10）
    await client.query(`DELETE FROM agent_plans WHERE account_id = $1`, [accountId]);
    // Agent 离线日报同属账号数据，一并清空（v23 AISLG-54）
    await client.query(`DELETE FROM agent_daily_reports WHERE account_id = $1`, [accountId]);
    // 累计掠夺台账随重置清零（v23 AISLG-61）
    await client.query(`UPDATE accounts SET plunder_total = 0 WHERE id = $1`, [accountId]);
    // v38（AISLG-122）：重置 = 回到开号初始状态——重新进入新手保护（3 天基准随缩放），
    // 清掉主动免战与本城被动免战（免战是「城被攻破」的产物，重置后不再是）
    await client.query(
      `UPDATE accounts SET newbie_until = $2, self_truce_until = NULL, self_truce_used_at = NULL WHERE id = $1`,
      [accountId, newbieUntilFrom(new Date())],
    );
    await client.query(
      `UPDATE cities SET truce_until = NULL WHERE account_id = $1`,
      [accountId],
    );
    await insertEvent(client, {
      accountId,
      cityId: firstCityId,
      type: EventType.ACCOUNT_RESET,
      initiator: role,
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  // 重置后即开号状态（无建筑无产量），直接组装视图返回
  const city = await loadCityState(ctx.pool, accountId);
  respondOk(ctx.registry, conn, op, seq, { city });
  ctx.registry.broadcast(
    accountId,
    { op: Op.PUSH_CITY_STATE, push: true, data: { reason: 'account_reset', cityId: firstCityId } },
    conn,
  );
}
