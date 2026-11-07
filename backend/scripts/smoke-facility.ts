// 望楼（野地设施，AISLG-232）的端到端冒烟：对照需求「验收」逐条走真实 API + Worker。
// 前置：临时库已建表建世界，api 与 worker 已启动（time_scale 建议调小，例如 50——1 级望楼 3 秒完成）。
// 运行：cd backend && WS_URL=ws://127.0.0.1:18032/ws DATABASE_URL=... npx tsx --env-file=.env scripts/smoke-facility.ts
// 说明：为了让「自己占领的野地 / 别人的望楼可见」这类前置成立，两座城与两块野地由脚本直连数据库摆好
// （与 smoke-pvp-tile.ts 同一做法），其余全部走真实协议。

import pg from 'pg';
import { Op } from '../common/src/protocol';
import { Client, check, dataOf, step, stepTotal } from './smoke-client';
import { seedAccount } from './smoke-account';
import { setFogEnabled } from '../common/src/fog-config';

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8080/ws';
/** 建望楼后等 Worker 完成的宽限（time_scale 大时更短，这里按最慢的 3 级估算） */
const FINISH_WAIT_MS = Number(process.env.FACILITY_WAIT_MS || 30_000);
const password = 'smoke-pass-123';

interface Seat {
  username: string;
  client: Client;
  cityId: string;
  home: { x: number; y: number };
  tiles: Array<{ x: number; y: number }>;
}

async function login(username: string): Promise<{ client: Client; accountId: string }> {
  const client = await Client.connect(WS_URL);
  const res = await client.request(Op.LOGIN, { username, password, asAgent: false });
  check(res.ok === true, `${username} 登录成功`);
  return { client, accountId: String(dataOf(res).accountId) };
}

/** 直连数据库把一个账号的城与野地摆到固定坐标（世界已由 API 建好） */
async function prepareSeat(pool: pg.Pool, accountId: string, home: { x: number; y: number }, tiles: Array<{ x: number; y: number }>): Promise<string> {
  const city = await pool.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [accountId]);
  const cityId = city.rows[0].id as string;
  await pool.query(`UPDATE cities SET x = $2, y = $3, gold = 100000, wood = 100000, stone = 100000, food = 100000, iron = 100000 WHERE id = $1`, [cityId, home.x, home.y]);
  await pool.query(
    `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)
     ON CONFLICT (x, y) DO UPDATE SET kind = 'city', level = 0, owner_city_id = EXCLUDED.owner_city_id, npc = NULL`,
    [home.x, home.y, cityId],
  );
  for (const tile of tiles) {
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'wilderness', 2, $3, NULL)
       ON CONFLICT (x, y) DO UPDATE SET kind = 'wilderness', level = 2, owner_city_id = EXCLUDED.owner_city_id, npc = NULL`,
      [tile.x, tile.y, cityId],
    );
    await pool.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2`, [tile.x, tile.y]);
    await pool.query(`DELETE FROM wilderness_facilities WHERE x = $1 AND y = $2`, [tile.x, tile.y]);
  }
  return cityId;
}

/** 轮询城池状态直到该地块的望楼建到 target 级（Worker 到期完成） */
async function waitLevel(seat: Seat, x: number, y: number, target: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await seat.client.request(Op.GET_STATE, { cityId: seat.cityId });
    const city = dataOf(res).city as { territory: Array<{ x: number; y: number; facility: { level: number } | null }> } | undefined;
    const item = city?.territory.find((tile) => tile.x === x && tile.y === y);
    if (item?.facility?.level === target) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`等待 (${x}, ${y}) 的望楼升到 ${target} 级超时`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main(): Promise<void> {
  const A: Seat = { username: `wf_a_${Date.now()}`, client: null as unknown as Client, cityId: '', home: { x: 300, y: 300 }, tiles: [] };
  const B: Seat = { username: `wf_b_${Date.now()}`, client: null as unknown as Client, cityId: '', home: { x: 306, y: 300 }, tiles: [] };
  await seedAccount(A.username, password);
  await seedAccount(B.username, password);
  const loginA = await login(A.username);
  const loginB = await login(B.username);
  A.client = loginA.client;
  B.client = loginB.client;

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    step('准备：A / B 各一座城、A 两块野地；迷雾开启');
    // A 的两块野地在 A 城周围（B 的城能看到 A 的第一块地）
    A.tiles = [{ x: 302, y: 300 }, { x: 303, y: 300 }];
    A.cityId = await prepareSeat(pool, loginA.accountId, A.home, A.tiles);
    // B 名下也有一块野地：资源不足 / 迷雾关闭仍可建 这两步用它（不受 A 的名额与在建状态干扰）
    B.tiles = [{ x: 308, y: 300 }];
    B.cityId = await prepareSeat(pool, loginB.accountId, B.home, B.tiles);
    await setFogEnabled(pool, true);
    await new Promise((resolve) => setTimeout(resolve, 6000)); // 等 API / Worker 的开关缓存刷新（TTL 4 秒）
    check(true, 'A 占领 (302,300) 与 (303,300)，B 的城在 (306,300)');

    step('非自己的野地 / 城池 / 无主地被拒');
    {
      const otherTile = await B.client.request(Op.FACILITY_BUILD, { x: A.tiles[0].x, y: A.tiles[0].y });
      check(otherTile.ok === false && otherTile.error?.code === 'FACILITY_TILE_INVALID', '别人的野地返回 FACILITY_TILE_INVALID');
      const city = await A.client.request(Op.FACILITY_BUILD, { x: A.home.x, y: A.home.y });
      check(city.ok === false && city.error?.code === 'FACILITY_TILE_INVALID', '城池格返回 FACILITY_TILE_INVALID');
      const free = await A.client.request(Op.FACILITY_BUILD, { x: 350, y: 350 });
      check(free.ok === false && free.error?.code === 'FACILITY_TILE_INVALID', '无主野地返回 FACILITY_TILE_INVALID');
      const npc = await A.client.request(Op.FACILITY_BUILD, { x: 700, y: 700 });
      check(npc.ok === false && npc.error?.code === 'FACILITY_TILE_INVALID', 'NPC 城返回 FACILITY_TILE_INVALID');
    }

    step('新建 1 级望楼：扣 300 / 200 / 100，到点后完成（事件 facility_completed）');
    {
      const before = await A.client.request(Op.GET_STATE, { cityId: A.cityId });
      const res = await A.client.request(Op.FACILITY_BUILD, { x: A.tiles[0].x, y: A.tiles[0].y });
      check(res.ok === true, 'FACILITY_BUILD 成功');
      const facility = dataOf(res).facility as { level: number; building: { toLevel: number; finishAt: string } | null };
      check(facility.building?.toLevel === 1, '响应里 building.toLevel = 1');
      const after = dataOf(res).city as { resources: { gold: number; wood: number; stone: number } };
      const was = (dataOf(before).city as { resources: { gold: number; wood: number; stone: number } }).resources;
      check(was.gold - after.resources.gold === 300 && was.wood - after.resources.wood === 200 && was.stone - after.resources.stone === 100, '扣费 金 300 / 木 200 / 石 100');
      const again = await A.client.request(Op.FACILITY_BUILD, { x: A.tiles[0].x, y: A.tiles[0].y });
      check(again.ok === false && again.error?.code === 'FACILITY_BUILDING', '建造中再点被拒（FACILITY_BUILDING）');
      const push = await A.client.waitPush(Op.PUSH_TILE_STATE, FINISH_WAIT_MS, (data) => data.reason === 'facility_completed');
      check((dataOf(push as never).tile as { facility: { level: number } | null }).facility?.level === 1, '收到 PUSH_TILE_STATE（facility_completed，1 级）');
    }

    step('升到 2 级：扣 600 / 400 / 200，视野 8 格');
    {
      const before = dataOf(await A.client.request(Op.GET_STATE, { cityId: A.cityId })).city as { resources: { gold: number; wood: number; stone: number } };
      const res = await A.client.request(Op.FACILITY_BUILD, { x: A.tiles[0].x, y: A.tiles[0].y });
      check(res.ok === true, '升级到 2 级成功');
      const after = dataOf(res).city as { resources: { gold: number; wood: number; stone: number } };
      check(before.resources.gold - after.resources.gold === 600 && before.resources.wood - after.resources.wood === 400 && before.resources.stone - after.resources.stone === 200, '扣费 金 600 / 木 400 / 石 200');
      await waitLevel(A, A.tiles[0].x, A.tiles[0].y, 2, FINISH_WAIT_MS);
      const state = dataOf(await A.client.request(Op.GET_STATE, { cityId: A.cityId })).city as {
        territory: Array<{ x: number; y: number; facility: { level: number; visionRadius: number } | null }>;
      };
      const item = state.territory.find((tile) => tile.x === A.tiles[0].x && tile.y === A.tiles[0].y);
      check(item?.facility?.visionRadius === 8, '2 级视野半径 8');
    }

    step('别人看得到望楼与等级、看不到进度；迷雾里望楼视野内的格子可见');
    {
      const map = await B.client.request(Op.GET_WORLD_MAP, { x: A.tiles[0].x - 2, y: A.tiles[0].y - 2, w: 5, h: 5 });
      const tiles = dataOf(map).tiles as Array<{ x: number; y: number; facility: { kind: string; level: number } | null }>;
      const tile = tiles.find((item) => item.x === A.tiles[0].x && item.y === A.tiles[0].y);
      check(tile?.facility?.kind === 'watchtower' && tile.facility.level === 2, 'B 在地图上看到 A 的望楼 2 级');
      check(dataOf(map).fogEnabled === true, '地图响应带 fogEnabled = true');
      const detail = await B.client.request(Op.GET_TILE, { x: A.tiles[0].x, y: A.tiles[0].y });
      const tileDetail = dataOf(detail).tile as { facilityBuilding: unknown; facility: { level: number } | null };
      check(tileDetail.facilityBuilding === null, 'B 看不到建造进度（facilityBuilding = null）');
      // 望楼视野 8 格 → 离它 7 格、不在 B 城视野内的格子也应可见（B 城在 306,300，视野 12 格，
      // 所以取 (296, 292)：离 B 城 14 格、离望楼 (302,300) 8 格以内）
      const far = await B.client.request(Op.GET_WORLD_MAP, { x: 295, y: 291, w: 3, h: 3 });
      check((dataOf(far).tiles as unknown[]).length === 9, 'A 的望楼视野内的格子对 B 可见');
    }

    step('每城 2 座上限：第 3 块地被拒');
    {
      // 第 2 座：第二块野地（同时给「升级不受名额限制」留出空间）
      const second = await A.client.request(Op.FACILITY_BUILD, { x: A.tiles[1].x, y: A.tiles[1].y });
      check(second.ok === true, '同一座城第 2 座可以建');
      // 再摆一块 A 名下的野地：第 3 座应被拒
      await pool.query(
        `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES (304, 300, 'plain', 'wilderness', 1, $1, NULL)
         ON CONFLICT (x, y) DO UPDATE SET kind = 'wilderness', owner_city_id = EXCLUDED.owner_city_id, npc = NULL`,
        [A.cityId],
      );
      const third = await A.client.request(Op.FACILITY_BUILD, { x: 304, y: 300 });
      check(third.ok === false && third.error?.code === 'FACILITY_LIMIT', '第 3 座被拒（FACILITY_LIMIT）');
      check(dataOf(third).limit === 2, '响应附 limit = 2');
    }

    step('资源不足被拒且不扣（B 的野地，B 城只剩 5 金）');
    {
      await pool.query(`UPDATE cities SET gold = 5, wood = 5, stone = 5 WHERE id = $1`, [B.cityId]);
      const goldBefore = Number((await pool.query(`SELECT gold FROM cities WHERE id = $1`, [B.cityId])).rows[0].gold);
      const res = await B.client.request(Op.FACILITY_BUILD, { x: B.tiles[0].x, y: B.tiles[0].y });
      check(res.ok === false && res.error?.code === 'INSUFFICIENT_RESOURCES', '资源不足返回 INSUFFICIENT_RESOURCES');
      // 生产会把金币往上推，但绝不会扣掉 300：只要不比请求前少就说明没有扣费
      const goldAfter = Number((await pool.query(`SELECT gold FROM cities WHERE id = $1`, [B.cityId])).rows[0].gold);
      check(goldAfter >= goldBefore, `不扣资源（请求前 ${goldBefore}，请求后 ${goldAfter}）`);
      await pool.query(`UPDATE cities SET gold = 100000, wood = 100000, stone = 100000 WHERE id = $1`, [B.cityId]);
    }

    step('迷雾关闭（fog_enabled 关）时望楼仍可建，但不产生视野效果');
    {
      await setFogEnabled(pool, false);
      await new Promise((resolve) => setTimeout(resolve, 6000));
      const map = await B.client.request(Op.GET_WORLD_MAP, { x: 295, y: 291, w: 3, h: 3 });
      check(dataOf(map).fogEnabled === false, '地图响应带 fogEnabled = false（界面据此注明「迷雾未开启」）');
      check((dataOf(map).tiles as unknown[]).length === 9, '迷雾关闭时不裁剪视野（远格也返回，望楼视野不再有意义）');
      const res = await B.client.request(Op.FACILITY_BUILD, { x: B.tiles[0].x, y: B.tiles[0].y });
      check(res.ok === true, '迷雾关闭时望楼仍可建');
      await waitLevel(B, B.tiles[0].x, B.tiles[0].y, 1, FINISH_WAIT_MS);
      await setFogEnabled(pool, true);
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }

    step('野地被抢 / 放弃后望楼毁掉，原主人收到 facility_lost');
    {
      const res = await A.client.request(Op.RECALL_GARRISON, { x: A.tiles[0].x, y: A.tiles[0].y });
      check(res.ok === true, '撤回驻军（放弃占领）成功');
      const map = await B.client.request(Op.GET_WORLD_MAP, { x: A.tiles[0].x, y: A.tiles[0].y, w: 1, h: 1 });
      const tile = (dataOf(map).tiles as Array<{ facility: unknown }>)[0];
      check(tile !== undefined && tile.facility === null, '地块上不再有设施');
      const events = dataOf(await A.client.request(Op.GET_EVENTS, { limit: 50 })).events as Array<{ type: string; detail: Record<string, unknown> }>;
      const lost = events.find((event) => event.type === 'facility_lost');
      check(lost !== undefined && lost.detail.x === A.tiles[0].x && lost.detail.cause === 'recall', '原主人收到 facility_lost（cause=recall）');
    }
  } finally {
    await pool.end();
    A.client?.close();
    B.client?.close();
  }
  console.log(`\n冒烟完成，共 ${stepTotal()} 步`);
}

main().catch((err) => {
  console.error('冒烟失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
