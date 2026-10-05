// Worker 的行军推进与到达分发（v12 起，v13 扩展侦察 / 调兵 / 战斗委托，v16 扩展
// 掠夺 / 占领 / 增援）。战斗结算与 NPC 袭击在 battle-tick.ts；掠夺与占领在
// plunder-tick.ts；共用工具在 tick-shared.ts。设计：
// - 领取与结算同事务：marches 行先以 SKIP LOCKED 领取，随后按 cities → world_tiles 的
//   全局锁序加锁（与 API 出征 / 召回一致，不构成死锁环）；
// - 到达按 purpose 分发：plunder=掠夺（战斗 + 负重装填 + 冷却）、occupy=占领
//   （战斗 + 核限 + 改归属）、attack=legacy 在途行军（battle-tick 的 v15 结算路径）、
//   scout=产出情报并返程、transfer=并入本账号分城驻军、transport=货物入目标城后部队返程、reinforce=并入自有野地驻军、
//   return=部队回城；
// - 目标失效（易主 / 消失 / 任务不再适用）不战斗，部队按编队速度原路返回；
// - 事件与状态同一事务落库，pg_notify 在提交后发出，漏发由 API 兜底轮询 / 客户端
//   按需查询覆盖。

import pg from 'pg';
import { EventType, TROOP_KINDS, type InitiatorRole, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { toFullArmyCounts } from '../../common/src/battle';
import { loadNativeGarrison } from '../../common/src/native-garrison';
import { famousEncounter } from '../../common/src/famous-city';
import type { NpcCitySnapshot } from '../../common/src/world';
import { saveScoutIntel } from '../../common/src/battle-db';
import { loadTileArmy, type TileRow } from '../../common/src/world-db';
import {
  abortMarchToReturn,
  completeMarchEvent,
  creditLoot,
  createReturnMarch,
  markMarchArrived,
  reinforceTile,
  settleOwnerCity,
  troopsEnterCity,
  loadCityNaming,
  type MarchRow,
  type TileNotify,
} from './tick-shared';
import { buildScoutIntel, resolveBattleArrival } from './battle-tick';
import { resolveOccupyArrival, resolvePlunderArrival } from './plunder-tick';
import { resolveCampArrival } from './yt-camp';
import { lockYt, newYtNotifies, publishYtNotifies, type YtNotifies } from './yt-event';
import { campGarrison, loadCampAt } from '../../common/src/yellow-turban-db';
import { movingNotifyPayload, resolveInterceptArrival, type MovingNotify } from './intercept-tick';
import { scaledMs } from '../../common/src/time-scale';
import { readCargo } from '../../common/src/transport';
import { loadTechLevels } from '../../common/src/tech-db';
import { defenseExtraPercent } from '../../common/src/tech';
import { wallDefensePercent } from '../../common/src/battle';
import { loadBuildingLevels } from '../../common/src/production';

const MARCH_BATCH_LIMIT = 50;

/** NPC 袭击间隔（毫秒，v21 AISLG-28：30 分钟 → 120 分钟，压低补给成本把低等级
 *  占领净收益拉正；v19 曾 5 分钟 → 30 分钟。目标池 = 已占领野地（80%）+ 官府 ≥2
 *  的玩家主城（20%，AISLG-32 方案 A）；环境变量 NPC_RAID_INTERVAL_MS 覆盖便于验证；
 *  v20 默认基准受全局时间缩放 ÷ scale（AISLG-38），调用方每次调度取当前值 */
export const DEFAULT_NPC_RAID_INTERVAL_MS = 7_200_000;

export function npcRaidIntervalMs(): number {
  const raw = Number(process.env.NPC_RAID_INTERVAL_MS);
  if (Number.isFinite(raw) && raw >= 1000) {
    return Math.floor(raw);
  }
  return scaledMs(DEFAULT_NPC_RAID_INTERVAL_MS);
}

/** 处理一批到期行军；返回结算数量。单条失败抛出，整批回滚，下个周期重试。 */
export async function processDueMarches(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  const notifies: TileNotify[] = [];
  const movingNotifies: MovingNotify[] = [];
  const yt = newYtNotifies();
  try {
    await client.query('BEGIN');
    const due = await client.query(
      `SELECT * FROM marches
       WHERE status = 'marching' AND arrive_at <= now()
       ORDER BY arrive_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [MARCH_BATCH_LIMIT],
    );
    let resolved = 0;
    for (const march of due.rows as MarchRow[]) {
      const troops = toFullArmyCounts(march.troops ?? {});
      if (march.purpose === 'return') {
        await settleReturn(client, march, troops);
        notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
        resolved += 1;
        continue;
      }
      // 锁序与 API 一致（cities → world_tiles）：先锁出征城并结算生产，再锁目标地块。
      // 若先锁地块再锁城，会与 API 的 MARCH / RECALL（城→地块）构成死锁环。
      const settled = await settleOwnerCity(client, march.from_city_id, march.arrive_at);
      if (march.purpose === 'transport') {
        // v26：运输目标城先于地块加锁并结算生产（锁序 出发城 → 目标城 → 地块）
        await settleTransportTarget(client, march);
      }
      if (march.purpose === 'plunder') {
        // v38（AISLG-122）：掠夺目标是他人城池时，目标城同样先于地块加锁并结算生产
        // 到到达时刻（守方资源以开战时刻为准；锁序 出发城 → 目标城 → 地块，与运输一致）
        await settlePvpTarget(client, march);
      }
      if (march.purpose === 'occupy') {
        // v40（AISLG-124）：占领目标是他人分城时，目标城与守方主城先于地块加锁并结算
        // （换主要把野地驻军 / 在外部队收回守方主城；锁序 出发城 → 目标城 → 守方主城 → 地块）
        await settleConquestTargets(client, march);
      }
      const tileRes = await client.query(`SELECT * FROM world_tiles WHERE x = $1 AND y = $2 FOR UPDATE`, [march.x, march.y]);
      const tile = (tileRes.rowCount ? tileRes.rows[0] : null) as TileRow | null;
      await resolveArrival(client, march, troops, tile, settled, notifies, movingNotifies, yt);
      resolved += 1;
    }
    await client.query('COMMIT');
    for (const payload of notifies) {
      await pool.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify(payload)]);
    }
    // 黄巾之乱（v29 AISLG-76）：清剿进度 / 老巢 / 收场 / 播报 / 散成的流寇
    await publishYtNotifies(pool, yt);
    // 移动目标被截获（v28 AISLG-78）：全服广播
    for (const moving of movingNotifies) {
      await pool.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify(movingNotifyPayload(moving))]);
    }
    return resolved;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 返程行军：城池生产结算到到达时刻，部队并入城内驻军 */
async function settleReturn(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
): Promise<void> {
  const { row } = await settleOwnerCity(client, march.from_city_id, march.arrive_at);
  if (row) {
    await troopsEnterCity(client, march.from_city_id, troops);
    // v26（AISLG-79）：撤回 / 失效返程的运输货物随部队回到出发城（即时入账，不钳储量上限）
    const cargo = readCargo(march.cargo);
    if (cargo) {
      await creditLoot(client, march.from_city_id, cargo);
    }
  }
  // 城池行被删（重置）时部队随之消失；行军仍标记结算完成，避免重复处理
  const upd = await client.query(
    `UPDATE marches SET status = 'returned', resolved_at = clock_timestamp()
     WHERE id = $1 AND status = 'marching' RETURNING id`,
    [march.id],
  );
  if (upd.rowCount) {
    await completeMarchEvent(client, march, 'returned', { troops });
  }
}

/**
 * 出征 / 侦察 / 调兵 / 掠夺 / 占领到达的分发。出征城已在调用方按锁序锁定并把生产
 * 结算到到达时刻（settled）；本函数内不得再锁 cities。掠夺 / 占领（v16）委托
 * plunder-tick；legacy attack（升级前在途）委托 battle-tick.resolveBattleArrival。
 */
async function resolveArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow | null,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
  movingNotifies: MovingNotify[],
  yt: YtNotifies,
): Promise<void> {
  // v29（AISLG-76）：掠夺任务的目标格上有进行中的黄巾营地 / 老巢 → 走营地结算
  if (march.purpose === 'plunder' && tile?.kind === 'wilderness' && !tile.owner_city_id) {
    if (await loadCampAt(client, march.x, march.y)) {
      // 先取黄巾全局锁再锁营地行（与 yt-tick 串行；顺序：出发城 → 地块 → 黄巾锁 → 营地 → 事件）
      await lockYt(client);
      const camp = await loadCampAt(client, march.x, march.y, true);
      if (camp) {
        await resolveCampArrival(client, march, troops, camp, settled, notifies, yt);
        return;
      }
    }
  }
  if (march.purpose === 'intercept') {
    await resolveInterceptArrival(client, march, troops, settled, notifies, movingNotifies);
    return;
  }
  if (march.purpose === 'scout') {
    await settleScoutArrival(client, march, troops, tile, settled, notifies);
    return;
  }
  if (march.purpose === 'transfer') {
    await settleTransferArrival(client, march, troops, tile, settled, notifies);
    return;
  }
  if (march.purpose === 'transport') {
    await settleTransportArrival(client, march, troops, tile, settled, notifies);
    return;
  }
  if (march.purpose === 'plunder' || march.purpose === 'occupy') {
    // v16 掠夺 / 占领：目标可攻性复核（含自有地块转增援）在 plunder-tick 内完成
    await (march.purpose === 'plunder'
      ? resolvePlunderArrival(client, march, troops, tile, settled, notifies)
      : resolveOccupyArrival(client, march, troops, tile, settled, notifies));
    return;
  }
  if (march.purpose === 'reinforce') {
    await settleReinforceArrival(client, march, troops, tile, settled, notifies);
    return;
  }

  // legacy attack（v16 前发出的在途行军）：可攻击性复核（提交后目标可能易主）
  const ownTile =
    tile?.kind === 'wilderness' && tile.owner_city_id
      ? (await client.query(`SELECT 1 FROM cities WHERE id = $1 AND account_id = $2`, [tile.owner_city_id, march.account_id])).rowCount === 1
      : false;
  const attackable =
    (tile?.kind === 'npc_city' && tile.npc) ||
    (tile?.kind === 'wilderness' && (!tile.owner_city_id || ownTile));
  if (!attackable) {
    await abortMarchToReturn(client, march, troops, settled, notifies);
    return;
  }

  // 增援自己的地块：不战斗，直接并入驻军
  if (tile?.kind === 'wilderness' && ownTile) {
    await reinforceTile(client, march, troops, tile, notifies);
    return;
  }

  await resolveBattleArrival(client, march, troops, tile as TileRow, settled, notifies);
}

/** reinforce 到达：目标是本账号占领野地 → 并入驻军；否则按失效返程（v16） */
async function settleReinforceArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow | null,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  const own =
    tile?.kind === 'wilderness' && tile.owner_city_id
      ? (await client.query(`SELECT 1 FROM cities WHERE id = $1 AND account_id = $2`, [tile.owner_city_id, march.account_id])).rowCount === 1
      : false;
  if (!own) {
    // 目标不再是本账号占领的野地（召回 / NPC 袭击 / 重置）：部队原路返回
    await abortMarchToReturn(client, march, troops, settled, notifies);
    return;
  }
  await reinforceTile(client, march, troops, tile as TileRow, notifies);
}

/** 侦察到达：不战斗，产出情报快照（事件 + scout_intel）后原地返程 */
async function settleScoutArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow | null,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  if (!tile) {
    // 目标地块消失（世界重建等）：按失效返程
    await abortMarchToReturn(client, march, troops, settled, notifies);
    return;
  }
  // 驻军快照：占领野地 / 分城（kind='city'）取地块驻军；未占领野地取原住守军编成；
  // NPC 城池取驻防快照（随情报固化为当时数值）
  let garrison: Partial<Record<TroopKind, number>> = {};
  /** v38（AISLG-122）：玩家城侦察的城墙减伤（城墙 + 守方城防科技）；其余目标为 undefined */
  let pvpWallPercent: number | undefined;
  if (tile.kind === 'wilderness' && !tile.owner_city_id) {
    // v29（AISLG-76）：黄巾营地 / 老巢所在格——侦察到的是营地当前守军（含战后存量与老巢当前阶段）
    const camp = await loadCampAt(client, tile.x, tile.y);
    garrison = camp ? campGarrison(camp, new Date()) : await loadNativeGarrison(client, tile);
  } else if (tile.kind === 'npc_city') {
    const npc = tile.npc as NpcCitySnapshot | null;
    // 名城取当前阶段守军（外围 / 城守）；普通 NPC 城取驻防快照
    garrison = npc?.famous ? famousEncounter(npc, new Date()).garrison : npc?.garrison ?? {};
  } else if (tile.kind === 'city' && tile.owner_city_id) {
    // v38（AISLG-122）：玩家城驻军 = 该城的 city_army（v24 起分城驻军不落地块驻军），
    // 城墙减伤 = 城墙等级 + 守方城防科技（与守城战同口径）
    const armyRes = await client.query(
      `SELECT troop, count FROM city_army WHERE city_id = $1 AND count > 0`,
      [tile.owner_city_id],
    );
    for (const row of armyRes.rows as { troop: TroopKind; count: number }[]) {
      garrison[row.troop] = row.count;
    }
    const levels = await loadBuildingLevels(client, tile.owner_city_id);
    const ownerRes = await client.query(`SELECT account_id FROM cities WHERE id = $1`, [tile.owner_city_id]);
    const ownerAccountId = (ownerRes.rows[0] as { account_id: string } | undefined)?.account_id;
    pvpWallPercent = wallDefensePercent(
      levels.wall ?? 0,
      ownerAccountId ? defenseExtraPercent(await loadTechLevels(client, ownerAccountId)) : 0,
    );
  } else {
    garrison = await loadTileArmy(client, tile.x, tile.y);
  }
  let owner: { username: string; cityName: string } | null = null;
  if (tile.owner_city_id) {
    const naming = await loadCityNaming(client, tile.owner_city_id);
    owner = naming ? { username: naming.username, cityName: naming.cityName } : null;
  }
  const nowRes = await client.query(`SELECT now() AS now`);
  const at = (nowRes.rows[0].now as Date).toISOString();
  const intel = buildScoutIntel(tile, toFullArmyCounts(garrison), owner, at, await loadTechLevels(client, march.account_id), pvpWallPercent);
  await saveScoutIntel(client, march.account_id, intel);
  await client.query(
    `UPDATE marches SET status = 'arrived', resolved_at = clock_timestamp() WHERE id = $1 AND status = 'marching'`,
    [march.id],
  );
  await completeMarchEvent(client, march, 'scouted', { intel, troops });
  // 斥候原地返程（同编队速度，路径对称）
  await createReturnMarch(client, march, troops, settled, march.initiator);
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
}

/** 调兵到达：目标是本账号分城 → 并入其地块驻军；否则按失效返程 */
async function settleTransferArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow | null,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  const own =
    tile?.kind === 'city' && tile.owner_city_id
      ? ((await client.query(
          `SELECT id, name FROM cities WHERE id = $1 AND account_id = $2 AND id <> $3`,
          [tile.owner_city_id, march.account_id, march.from_city_id],
        )).rows[0] as { id: string; name: string } | undefined)
      : undefined;
  if (!own) {
    // 目标不再是本账号分城（重置等）：部队原路返回
    await abortMarchToReturn(client, march, troops, settled, notifies);
    return;
  }
  // v24（AISLG-58）：分城驻军即该城的 city_army（可独立征兵 / 出兵），不再落地块驻军
  await troopsEnterCity(client, own.id, troops);
  await markMarchArrived(client, march.id);
  await completeMarchEvent(client, march, 'transferred', { troops, cityId: own.id, cityName: own.name });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
  notifies.push({ reason: 'tile_changed', accountId: march.account_id, x: tile!.x, y: tile!.y, tileReason: 'garrison_reinforced' });
}

/**
 * 运输到达（v26，AISLG-79）：目标是本账号另一座城 → 先把目标城生产结算到到达时刻再
 * 货物入账（即时入账、不钳储量上限，与掠夺所得同规则），部队自动返回出发城；
 * 目标失效（重置等）按失效返程，货物随部队带回。出发城 / 目标城各记一条「运输完成」事件。
 * 目标城的锁与生产结算在地块加锁前由 settleTransportTarget 完成。
 */
async function settleTransportArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow | null,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  const cargo = readCargo(march.cargo);
  const own =
    tile?.kind === 'city' && tile.owner_city_id
      ? ((await client.query(
          `SELECT id, name FROM cities WHERE id = $1 AND account_id = $2 AND id <> $3`,
          [tile.owner_city_id, march.account_id, march.from_city_id],
        )).rows[0] as { id: string; name: string } | undefined)
      : undefined;
  if (!own || !cargo) {
    await abortMarchToReturn(client, march, troops, settled, notifies);
    return;
  }
  await creditLoot(client, own.id, cargo);
  await markMarchArrived(client, march.id);
  const returning = await createReturnMarch(client, march, troops, settled, march.initiator);
  const from = await loadCityNaming(client, march.from_city_id);
  await completeMarchEvent(client, march, 'transported', {
    troops,
    cargo,
    cityId: own.id,
    cityName: own.name,
    fromCityName: from?.cityName ?? null,
    returning,
  });
  // 目标城记录（同账号，cityId 指向目标城）：城池维度的事件流里能看到「收到运输」
  await insertEvent(client, {
    accountId: march.account_id,
    cityId: own.id,
    buildId: march.id,
    type: EventType.MARCH_COMPLETED,
    initiator: march.initiator as InitiatorRole,
    detail: { x: march.x, y: march.y, purpose: 'transport', outcome: 'transport_received', cargo, fromCityId: march.from_city_id, fromCityName: from?.cityName ?? null },
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
}

/** 运输到达前：无锁读目标地块定位目标城（须为本账号另一座城），锁定并结算其生产到到达时刻 */
async function settleTransportTarget(client: pg.PoolClient, march: MarchRow): Promise<void> {
  const res = await client.query(
    `SELECT c.id FROM world_tiles t JOIN cities c ON c.id = t.owner_city_id
     WHERE t.x = $1 AND t.y = $2 AND t.kind = 'city' AND c.account_id = $3 AND c.id <> $4`,
    [march.x, march.y, march.account_id, march.from_city_id],
  );
  if (res.rowCount) {
    await settleOwnerCity(client, (res.rows[0] as { id: string }).id, march.arrive_at);
  }
}

/** 掠夺到达前（v38，AISLG-122）：无锁读目标地块，是他人城池时锁定并结算其生产到到达时刻。
 *  预判与地块加锁之间存在极小竞态（地块恰好转为玩家城）：到达结算按目标失效返程兜底 */
async function settlePvpTarget(client: pg.PoolClient, march: MarchRow): Promise<void> {
  const res = await client.query(
    `SELECT c.id FROM world_tiles t JOIN cities c ON c.id = t.owner_city_id
     WHERE t.x = $1 AND t.y = $2 AND t.kind = 'city' AND c.account_id <> $3`,
    [march.x, march.y, march.account_id],
  );
  if (res.rowCount) {
    await settleOwnerCity(client, (res.rows[0] as { id: string }).id, march.arrive_at);
  }
}

/** 占领到达前（v40，AISLG-124）：目标是他人的**分城**时，锁定并结算目标城与守方主城
 *  （换主事务要把野地驻军 / 在外部队收回守方主城，主城必须先于地块加锁；
 *  目标是主城或非城池时不动作——发起时已拒绝，在途变化由到达结算兜底） */
async function settleConquestTargets(client: pg.PoolClient, march: MarchRow): Promise<void> {
  const res = await client.query(
    `SELECT c.id, c.account_id,
            (SELECT c2.id FROM cities c2 WHERE c2.account_id = c.account_id ORDER BY c2.created_at LIMIT 1) AS main_id
     FROM world_tiles t JOIN cities c ON c.id = t.owner_city_id
     WHERE t.x = $1 AND t.y = $2 AND t.kind = 'city' AND c.account_id <> $3`,
    [march.x, march.y, march.account_id],
  );
  if (!res.rowCount) {
    return;
  }
  const row = res.rows[0] as { id: string; account_id: string; main_id: string };
  await settleOwnerCity(client, row.id, march.arrive_at);
  if (row.main_id !== row.id) {
    await settleOwnerCity(client, row.main_id, march.arrive_at);
  }
}
