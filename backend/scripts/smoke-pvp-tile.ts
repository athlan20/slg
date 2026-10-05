// v39（AISLG-123 玩家对抗二）冒烟（独立脚本，可在真实栈上单独运行）：
//   npx tsx --env-file=.env scripts/smoke-pvp-tile.ts
// 覆盖：抢占他人野地全链路——预警（target=wilderness）、野地战与双方战报
//（kind=pvp_wilderness）、易主与换主保护（TILE_PROTECTED）、名额满变无主、
// 空驻军直接拿下、掠夺任务被拒（TASK_INVALID_FOR_TARGET）、守方新手保护 / 主动免战
// 拦截、城级被动免战不保护野地、GET_TILE 的 protection.ownerChangedUntil。
// 前置：API 与 Worker 已以 v39 代码启动。兵力与部分前置状态（出保、免战到期、
// 空驻军）经数据库直改以缩短流程，出征 / 预警与结算全部走真实链路。

import { Op, type TroopKind } from '../common/src/protocol';
import { createPool } from '../common/src/db';
import { TILE_CAPTURE_PROTECTION_MS } from '../common/src/protection';
import { Client, check, dataOf, step } from './smoke-client';
import { waitMarchOutcome } from './smoke-world-utils';

const password = 'smoke-pass-123';

type Pool = ReturnType<typeof createPool>;

/** DB 直改城内驻军（冒烟提速：绕过征兵队列） */
async function seedArmy(pool: Pool, cityId: string, troops: Partial<Record<TroopKind, number>>): Promise<void> {
  for (const [troop, count] of Object.entries(troops)) {
    await pool.query(
      `INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)
       ON CONFLICT (city_id, troop) DO UPDATE SET count = EXCLUDED.count, updated_at = now()`,
      [cityId, troop, count],
    );
  }
}

/** 预置校场等级（免受新号 1 支在外的上限约束） */
async function seedParade(pool: Pool, cityId: string, level: number): Promise<void> {
  await pool.query(
    `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'parade_ground', $2)
     ON CONFLICT (city_id, kind) DO UPDATE SET level = $2`,
    [cityId, level],
  );
}

/** 把 cityId 的城搬到 (nearX, nearY) 附近的无主野地（共享世界出生点分散，控距用） */
async function relocateCityNear(pool: Pool, cityId: string, nearX: number, nearY: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const freeRes = await client.query(
      `SELECT x, y FROM world_tiles
       WHERE kind = 'wilderness' AND owner_city_id IS NULL
         AND abs(x - $1) <= 3 AND abs(y - $2) <= 3
       ORDER BY abs(x - $1) + abs(y - $2) LIMIT 1 FOR UPDATE`,
      [nearX, nearY],
    );
    check(freeRes.rowCount === 1, '找到城旁空地（relocateCityNear）');
    const free = freeRes.rows[0] as { x: number; y: number };
    const cityTileRes = await client.query(
      `SELECT x, y, terrain, kind, level, owner_city_id, npc FROM world_tiles WHERE owner_city_id = $1 FOR UPDATE`,
      [cityId],
    );
    const cityTile = cityTileRes.rows[0] as {
      x: number; y: number; terrain: string; kind: string; level: number; owner_city_id: string; npc: unknown;
    };
    await client.query(
      `UPDATE world_tiles SET terrain = $3, kind = $4, level = $5, owner_city_id = $6, npc = $7, plundered_at = NULL
       WHERE x = $1 AND y = $2`,
      [free.x, free.y, cityTile.terrain, cityTile.kind, cityTile.level, cityTile.owner_city_id, JSON.stringify(cityTile.npc ?? null)],
    );
    await client.query(
      `UPDATE world_tiles SET terrain = 'plain', kind = 'wilderness', level = 1, owner_city_id = NULL, npc = NULL
       WHERE x = $1 AND y = $2`,
      [cityTile.x, cityTile.y],
    );
    await client.query(`UPDATE cities SET x = $2, y = $3 WHERE id = $1`, [cityId, free.x, free.y]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 找主城附近的无主 1 级野地（排除已用坐标） */
async function findFreeTile(pool: Pool, nearX: number, nearY: number, exclude: Array<{ x: number; y: number }>): Promise<{ x: number; y: number; terrain: string }> {
  const res = await pool.query(
    `SELECT x, y, terrain FROM world_tiles
     WHERE kind = 'wilderness' AND owner_city_id IS NULL AND level = 1
       AND abs(x - $1) <= 4 AND abs(y - $2) <= 4
     ORDER BY abs(x - $1) + abs(y - $2) LIMIT 12`,
    [nearX, nearY],
  );
  for (const row of res.rows as Array<{ x: number; y: number; terrain: string }>) {
    if (!exclude.some((tile) => tile.x === row.x && tile.y === row.y)) {
      return row;
    }
  }
  throw new Error('主城附近找不到足够的无主 1 级野地');
}

/** 取账号最新事件 id（增量游标） */
async function eventCursor(client: Client): Promise<number> {
  const events = (dataOf(await client.request(Op.GET_EVENTS, { limit: 1 })).events ?? []) as Array<{ id: number }>;
  return events.reduce((max, e) => Math.max(max, e.id), 0);
}

async function main(): Promise<void> {
  const suffix = Date.now();
  const pool = createPool('smoke-pvp-tile');

  const playerA = await Client.connect();
  const loginA = await playerA.request(Op.LOGIN, { username: `smoke_pvpt_a_${suffix}`, password, asAgent: false });
  check(loginA.ok === true, '账号 A 注册登录成功');
  const a = dataOf(loginA) as { accountId: string; username: string };
  const stateA = dataOf(await playerA.request(Op.GET_STATE)) as { city: { id: string }; cities: Array<{ id: string; x: number; y: number }> };
  const cityA = stateA.cities[0];

  const playerB = await Client.connect();
  const loginB = await playerB.request(Op.LOGIN, { username: `smoke_pvpt_b_${suffix}`, password, asAgent: false });
  check(loginB.ok === true, '账号 B 注册登录成功');
  const b = dataOf(loginB) as { accountId: string; username: string };
  const stateB1 = dataOf(await playerB.request(Op.GET_STATE)) as { city: { id: string } };
  await relocateCityNear(pool, stateB1.city.id, cityA.x, cityA.y);
  const stateB = dataOf(await playerB.request(Op.GET_STATE)) as { cities: Array<{ id: string; x: number; y: number }> };
  const cityB = stateB.cities[0];

  // 前置：双方出新手保护、兵力与校场就绪
  await pool.query(`UPDATE accounts SET newbie_until = NULL WHERE id IN ($1, $2)`, [a.accountId, b.accountId]);
  await seedArmy(pool, cityA.id, { militia: 400 });
  await seedArmy(pool, cityB.id, { militia: 150 });
  await seedParade(pool, cityA.id, 5);
  await seedParade(pool, cityB.id, 5);

  const used: Array<{ x: number; y: number }> = [];
  const t1 = await findFreeTile(pool, cityA.x, cityA.y, used);
  used.push(t1);
  const t2 = await findFreeTile(pool, cityA.x, cityA.y, used);
  used.push(t2);
  const t3 = await findFreeTile(pool, cityA.x, cityA.y, used);
  used.push(t3);

  step('前置：B 占领野地 t1（真实占领路径，幸存驻守）');
  {
    const since = await eventCursor(playerB);
    const march = await playerB.request(Op.MARCH, { x: t1.x, y: t1.y, troops: { militia: 30 }, task: 'occupy' });
    check(march.ok === true, 'B 占领出征受理');
    const outcome = await waitMarchOutcome(
      playerB, since,
      Math.max(0, Date.parse((dataOf(march).march as { arriveAt: string }).arriveAt) - Date.now()) + 120_000,
    );
    check(outcome.outcome === 'battle_won' && outcome.detail.occupied === true, 'B 占领 t1 成功');
    const tile = (dataOf(await playerB.request(Op.GET_TILE, { x: t1.x, y: t1.y })).tile ?? {}) as { owner: { username: string } | null; garrison: number };
    check(tile.owner?.username === b.username, `t1 归属 B（驻军 ${tile.garrison}）`);
  }

  step('验收 6：对他人野地选掠夺被拒（TASK_INVALID_FOR_TARGET）');
  {
    const denied = await playerA.request(Op.MARCH, { x: t1.x, y: t1.y, troops: { militia: 10 }, task: 'plunder' });
    check(denied.ok === false && denied.error?.code === 'TASK_INVALID_FOR_TARGET', 'task=plunder 被拒');
    const deniedDefault = await playerA.request(Op.MARCH, { x: t1.x, y: t1.y, troops: { militia: 10 } });
    check(deniedDefault.ok === false && deniedDefault.error?.code === 'TASK_INVALID_FOR_TARGET', '缺省任务（掠夺）同样被拒');
  }

  step('验收 4：守方新手保护 / 主动免战拦截；城级被动免战不拦野地');
  {
    // B 开主动免战 → A 抢被拒
    const truce = await playerB.request(Op.TRUCE, {});
    check(truce.ok === true, 'B 开启主动免战');
    const deniedShield = await playerA.request(Op.MARCH, { x: t1.x, y: t1.y, troops: { militia: 10 }, task: 'occupy' });
    check(deniedShield.ok === false && deniedShield.error?.code === 'TARGET_IN_TRUCE', '主动免战中抢占被拒（TARGET_IN_TRUCE）');
    check(typeof deniedShield.data?.retryAfterSeconds === 'number', '拒绝响应附 retryAfterSeconds');
    await pool.query(`UPDATE accounts SET self_truce_until = NULL, self_truce_used_at = NULL WHERE id = $1`, [b.accountId]);
    // B 回到新手保护 → A 抢被拒
    await pool.query(`UPDATE accounts SET newbie_until = now() + interval '1 day' WHERE id = $1`, [b.accountId]);
    const deniedNewbie = await playerA.request(Op.MARCH, { x: t1.x, y: t1.y, troops: { militia: 10 }, task: 'occupy' });
    check(deniedNewbie.ok === false && deniedNewbie.error?.code === 'NEWBIE_PROTECTED', '新手保护中抢占被拒（NEWBIE_PROTECTED）');
    await pool.query(`UPDATE accounts SET newbie_until = NULL WHERE id = $1`, [b.accountId]);
    // B 的城处于被动免战（模拟刚被打）：不保护野地——下一步的出征受理即验证
    await pool.query(`UPDATE cities SET truce_until = now() + interval '2 hours' WHERE id = $1`, [cityB.id]);
  }

  step('验收 1：A 抢占 t1——预警、野地战、易主、双方战报、失地通知');
  {
    const sinceA = await eventCursor(playerA);
    const sinceB = await eventCursor(playerB);
    const march = await playerA.request(Op.MARCH, { x: t1.x, y: t1.y, troops: { militia: 200 }, task: 'occupy' });
    check(march.ok === true, '抢占出征受理（B 的城在被动免战中，不拦野地）');
    const arriveAt = (dataOf(march).march as { arriveAt: string }).arriveAt;
    // B 收到来袭预警（target=wilderness，带地形 / 等级 / 进攻方）
    const warning = await playerB.waitPush(Op.PUSH_ATTACK_WARNING, 10_000, (data) => data.target === 'wilderness');
    const warningData = warning.data as {
      x: number; y: number; terrain: string; level: number;
      attacker: { username: string }; arriveAt: string; armyMin: number;
    };
    check(warningData.x === t1.x && warningData.y === t1.y, '预警坐标 = 目标野地');
    check(warningData.terrain === t1.terrain && warningData.level === 1, `预警带地形与等级（${warningData.terrain} Lv${warningData.level}）`);
    check(warningData.attacker.username === a.username, `预警带进攻方（${warningData.attacker.username}）`);
    check(warningData.arriveAt === arriveAt, '预警 arriveAt = 行军到达时刻');
    const outcome = await waitMarchOutcome(playerA, sinceA, Math.max(0, Date.parse(arriveAt) - Date.now()) + 120_000);
    check(outcome.outcome === 'battle_won' && outcome.detail.occupied === true, '抢占成功（battle_won / occupied）');
    check(typeof outcome.detail.protectedUntil === 'string', `事件带换主保护截止（${String(outcome.detail.protectedUntil)}）`);
    // 地块易主 + 驻军 + 换主保护
    const tile = (dataOf(await playerA.request(Op.GET_TILE, { x: t1.x, y: t1.y })).tile ?? {}) as {
      owner: { username: string } | null; garrison: number;
      protection: { ownerChangedUntil: string | null } | null;
    };
    check(tile.owner?.username === a.username, `t1 已归 A（驻军 ${tile.garrison}）`);
    check(tile.protection === null, 'A 看自己的地不带 protection');
    // 双方战报（kind=pvp_wilderness）
    const reportsA = (dataOf(await playerA.request(Op.GET_BATTLE_REPORTS, { limit: 5 })).reports ?? []) as Array<{ kind: string; role: string; won: boolean }>;
    const mine = reportsA.find((r) => r.kind === 'pvp_wilderness');
    check(mine !== undefined && mine.role === 'attacker' && mine.won === true, 'A 拿到攻方视角战报（pvp_wilderness / 胜）');
    const reportsB = (dataOf(await playerB.request(Op.GET_BATTLE_REPORTS, { limit: 5 })).reports ?? []) as Array<{ kind: string; role: string; won: boolean }>;
    const theirs = reportsB.find((r) => r.kind === 'pvp_wilderness');
    check(theirs !== undefined && theirs.role === 'defender' && theirs.won === false, 'B 拿到守方视角战报（pvp_wilderness / 败）');
    // B 的失地通知（cause=conquest）
    const bEvents = (dataOf(await playerB.request(Op.GET_EVENTS, { sinceId: sinceB, limit: 50 })).events ?? []) as Array<{ type: string; detail: Record<string, unknown> }>;
    const lost = bEvents.find((event) => event.type === 'wilderness_lost');
    check(lost !== undefined && lost.detail.cause === 'conquest', 'B 收到失地通知（wilderness_lost / conquest）');
    check((lost?.detail.attacker as { username?: string } | undefined)?.username === a.username, '失地通知带进攻方');
  }

  step('验收 5 / 7：换主保护期内谁都不能抢；B 视角可见保护状态');
  {
    const denied = await playerB.request(Op.MARCH, { x: t1.x, y: t1.y, troops: { militia: 10 }, task: 'occupy' });
    check(denied.ok === false && denied.error?.code === 'TILE_PROTECTED', '保护期内抢占被拒（TILE_PROTECTED）');
    check(typeof denied.data?.retryAfterSeconds === 'number', '拒绝响应附 retryAfterSeconds');
    const tile = (dataOf(await playerB.request(Op.GET_TILE, { x: t1.x, y: t1.y })).tile ?? {}) as {
      protection: { ownerChangedUntil: string | null; newbieUntil: string | null; shieldUntil: string | null } | null;
    };
    check((tile.protection?.ownerChangedUntil ?? null) !== null, 'B 看到 t1 的换主保护截止（protection.ownerChangedUntil）');
    const until = Date.parse(tile.protection?.ownerChangedUntil ?? '');
    const expect = Date.now() + TILE_CAPTURE_PROTECTION_MS;
    check(Number.isFinite(until) && Math.abs(until - expect) < 120_000, `保护时长约 1 小时基准（差 ${Math.abs(until - expect) / 1000}s）`);
    await pool.query(`UPDATE world_tiles SET owner_changed_until = NULL WHERE x = $1 AND y = $2`, [t1.x, t1.y]);
  }

  step('验收 2：A 名额已满时打赢——地块变无主、部队返程');
  {
    // A 已占 t1（名额 = 官府 1 级 → 已满）；B 再占 t2 后被 A 打掉
    const sinceB = await eventCursor(playerB);
    const bMarch = await playerB.request(Op.MARCH, { x: t2.x, y: t2.y, troops: { militia: 40 }, task: 'occupy' });
    check(bMarch.ok === true, 'B 占领 t2 受理');
    await waitMarchOutcome(
      playerB, sinceB,
      Math.max(0, Date.parse((dataOf(bMarch).march as { arriveAt: string }).arriveAt) - Date.now()) + 120_000,
    );
    const sinceA = await eventCursor(playerA);
    const sinceB2 = await eventCursor(playerB);
    const march = await playerA.request(Op.MARCH, { x: t2.x, y: t2.y, troops: { militia: 150 }, task: 'occupy' });
    check(march.ok === true, '名额已满仍可出兵抢占（受理）');
    const outcome = await waitMarchOutcome(
      playerA, sinceA,
      Math.max(0, Date.parse((dataOf(march).march as { arriveAt: string }).arriveAt) - Date.now()) + 120_000,
    );
    check(outcome.outcome === 'battle_won' && outcome.detail.occupied === false, '打赢但未占领（occupied=false）');
    check(outcome.detail.denial === 'TERRITORY_LIMIT', '事件记录 denial=TERRITORY_LIMIT');
    const tile = (dataOf(await playerA.request(Op.GET_TILE, { x: t2.x, y: t2.y })).tile ?? {}) as { owner: unknown; garrison: number };
    check(tile.owner === null && tile.garrison === 0, 't2 变无主且无驻军');
    const bEvents = (dataOf(await playerB.request(Op.GET_EVENTS, { sinceId: sinceB2, limit: 50 })).events ?? []) as Array<{ type: string; detail: Record<string, unknown> }>;
    check(bEvents.some((event) => event.type === 'wilderness_lost' && event.detail.cause === 'conquest'), 'B 收到 t2 失地通知');
  }

  step('验收 3：B 没留驻军——A 不打直接拿下（无战报）');
  {
    const sinceB = await eventCursor(playerB);
    const bMarch = await playerB.request(Op.MARCH, { x: t3.x, y: t3.y, troops: { militia: 30 }, task: 'occupy' });
    check(bMarch.ok === true, 'B 占领 t3 受理');
    await waitMarchOutcome(
      playerB, sinceB,
      Math.max(0, Date.parse((dataOf(bMarch).march as { arriveAt: string }).arriveAt) - Date.now()) + 120_000,
    );
    // 模拟「占着地但没留驻军」：清空 t3 的 tile_army；A 提官府到 2 级腾出名额
    //（t1 已占 1 席，名额满时按规则会变无主而不是归 A——那是验收 2 的场景）
    await pool.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2`, [t3.x, t3.y]);
    await pool.query(
      `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 2)
       ON CONFLICT (city_id, kind) DO UPDATE SET level = 2`,
      [cityA.id],
    );
    const reportsBefore = ((dataOf(await playerA.request(Op.GET_BATTLE_REPORTS, { limit: 50 })).reports ?? []) as unknown[]).length;
    const sinceA = await eventCursor(playerA);
    const sinceB2 = await eventCursor(playerB);
    const march = await playerA.request(Op.MARCH, { x: t3.x, y: t3.y, troops: { militia: 50 }, task: 'occupy' });
    check(march.ok === true, '空驻军目标出征受理');
    const outcome = await waitMarchOutcome(
      playerA, sinceA,
      Math.max(0, Date.parse((dataOf(march).march as { arriveAt: string }).arriveAt) - Date.now()) + 120_000,
    );
    check(outcome.outcome === 'battle_won' && outcome.detail.occupied === true, '直接拿下（battle_won / occupied）');
    check(outcome.detail.unopposed === true, '事件带 unopposed（未接战）');
    const reportsAfter = ((dataOf(await playerA.request(Op.GET_BATTLE_REPORTS, { limit: 50 })).reports ?? []) as unknown[]).length;
    check(reportsAfter === reportsBefore, '未接战不生成战报');
    const tile = (dataOf(await playerA.request(Op.GET_TILE, { x: t3.x, y: t3.y })).tile ?? {}) as { owner: { username: string } | null; garrison: number };
    check(tile.owner?.username === a.username, `t3 已归 A（驻军 ${tile.garrison}）`);
    const bEvents = (dataOf(await playerB.request(Op.GET_EVENTS, { sinceId: sinceB2, limit: 50 })).events ?? []) as Array<{ type: string; detail: Record<string, unknown> }>;
    check(bEvents.some((event) => event.type === 'wilderness_lost' && event.detail.cause === 'conquest'), 'B 收到 t3 失地通知');
  }

  const resetA = await playerA.request(Op.RESET_ACCOUNT, { confirm: true });
  check(resetA.ok === true, '账号 A 重置成功');
  const resetB = await playerB.request(Op.RESET_ACCOUNT, { confirm: true });
  check(resetB.ok === true, '账号 B 重置成功');
  playerA.close();
  playerB.close();
  await pool.end();
  console.log('\n玩家对抗（二）野地抢占冒烟完成：账号已重置。');
}

main().catch((err) => {
  console.error('野地抢占冒烟失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
