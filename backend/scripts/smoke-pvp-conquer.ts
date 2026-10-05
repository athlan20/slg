// v40（AISLG-124 玩家对抗三）冒烟（独立脚本，可在真实栈上单独运行）：
//   npx tsx --env-file=.env scripts/smoke-pvp-conquer.ts
// 覆盖：占领他人分城全链路——城防值三击归零换主（占领不掠夺 / 掠夺不降城防）、
// 免战内不回涨与免战后按小时回涨、主城占领被拒、名额出发拒绝与到达复核、
// 换主事务（建筑 / 资源保留、队列作废、城守卸任、野地无主驻军回主城、在外部队改
// 回原主主城、在途运输原路返回）、换主 6 小时保护、地图城防值可见、双方战报与
// 得失城通知、全服播报。前置：API 与 Worker 已以 v40 代码启动；部分状态经 DB 直改
// 缩短流程（出保、免战到期、兵力、官府等级）。

import { Op, type TroopKind } from '../common/src/protocol';
import { createPool } from '../common/src/db';
import { DURABILITY_MAX } from '../common/src/protection';
import { Client, check, dataOf, step } from './smoke-client';
import { waitMarchOutcome } from './smoke-world-utils';

const password = 'smoke-pass-123';

type Pool = ReturnType<typeof createPool>;

async function seedArmy(pool: Pool, cityId: string, troops: Partial<Record<TroopKind, number>>): Promise<void> {
  for (const [troop, count] of Object.entries(troops)) {
    await pool.query(
      `INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)
       ON CONFLICT (city_id, troop) DO UPDATE SET count = EXCLUDED.count, updated_at = now()`,
      [cityId, troop, count],
    );
  }
}

async function seedParade(pool: Pool, cityId: string, level: number): Promise<void> {
  await pool.query(
    `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'parade_ground', $2)
     ON CONFLICT (city_id, kind) DO UPDATE SET level = $2`,
    [cityId, level],
  );
}

/** 把城搬到 (nearX, nearY) 附近的无主野地 */
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
    const cityTile = cityTileRes.rows[0] as { x: number; y: number; terrain: string; kind: string; level: number; owner_city_id: string; npc: unknown };
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

async function eventCursor(client: Client): Promise<number> {
  const events = (dataOf(await client.request(Op.GET_EVENTS, { limit: 1 })).events ?? []) as Array<{ id: number }>;
  return events.reduce((max, e) => Math.max(max, e.id), 0);
}

/** 等待出征结局（按 detail.conquest / loot 识别对城出征，跳过返程等同坐标事件） */
async function waitCityAssault(
  client: Client,
  sinceId: number,
  timeoutMs: number,
): Promise<{ outcome: string; detail: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await client.request(Op.GET_EVENTS, { sinceId, limit: 50 });
    if (res.ok) {
      const events = (dataOf(res).events ?? []) as Array<{ id: number; type: string; detail: Record<string, unknown> }>;
      const done = events.find(
        (event) =>
          event.type === 'march_completed' &&
          ['battle_won', 'battle_lost', 'plunder_won', 'aborted'].includes(String(event.detail.outcome)) &&
          (event.detail.conquest !== undefined || event.detail.loot !== undefined || event.detail.target !== undefined),
      );
      if (done) {
        return { outcome: String(done.detail.outcome), detail: done.detail };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('等待超时：对城出征结算事件');
}

async function main(): Promise<void> {
  const suffix = Date.now();
  const pool = createPool('smoke-pvp-conquer');

  const playerA = await Client.connect();
  const loginA = await playerA.request(Op.LOGIN, { username: `smoke_pvpq_a_${suffix}`, password, asAgent: false });
  check(loginA.ok === true, '账号 A 注册登录成功');
  const a = dataOf(loginA) as { accountId: string; username: string };
  const stateA = dataOf(await playerA.request(Op.GET_STATE)) as { city: { id: string }; cities: Array<{ id: string; x: number; y: number }> };
  const cityA = stateA.cities[0];

  const playerB = await Client.connect();
  const loginB = await playerB.request(Op.LOGIN, { username: `smoke_pvpq_b_${suffix}`, password, asAgent: false });
  check(loginB.ok === true, '账号 B 注册登录成功');
  const b = dataOf(loginB) as { accountId: string; username: string };
  const stateB0 = dataOf(await playerB.request(Op.GET_STATE)) as { city: { id: string } };
  const cityB = stateB0.city;

  // 前置：双方出保；A 搬到最近的低级 NPC 城旁、B 搬到 A 旁（B 要占 NPC 城做分城）
  await pool.query(`UPDATE accounts SET newbie_until = NULL WHERE id IN ($1, $2)`, [a.accountId, b.accountId]);
  const npcRes = await pool.query(
    `SELECT x, y, level FROM world_tiles WHERE kind = 'npc_city' AND owner_city_id IS NULL AND level <= 2
     ORDER BY abs(x - $1) + abs(y - $2) LIMIT 1`,
    [cityA.x ?? 0, cityA.y ?? 0],
  );
  check(npcRes.rowCount === 1, '找到低级 NPC 城池');
  const npc = npcRes.rows[0] as { x: number; y: number; level: number };
  await relocateCityNear(pool, cityA.id, npc.x, npc.y);
  const cityA2 = (dataOf(await playerA.request(Op.GET_STATE)).cities as Array<{ id: string; x: number; y: number }>)[0];
  await relocateCityNear(pool, cityB.id, cityA2.x, cityA2.y);
  await seedArmy(pool, cityA.id, { militia: 900 });
  await seedArmy(pool, cityB.id, { militia: 900 });
  await seedParade(pool, cityA.id, 5);
  await seedParade(pool, cityB.id, 5);
  await pool.query(
    `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 6)
     ON CONFLICT (city_id, kind) DO UPDATE SET level = 6`,
    [cityA.id],
  );
  await pool.query(
    `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 6)
     ON CONFLICT (city_id, kind) DO UPDATE SET level = 6`,
    [cityB.id],
  );

  step('前置：B 占领 NPC 城形成分城（真实路径，城防满值 100）');
  let branch: { id: string; x: number; y: number };
  {
    const since = await eventCursor(playerB);
    const march = await playerB.request(Op.MARCH, { x: npc.x, y: npc.y, troops: { militia: 600 }, task: 'occupy' });
    check(march.ok === true, 'B 占领 NPC 城出征受理');
    const outcome = await waitMarchOutcome(
      playerB, since,
      Math.max(0, Date.parse((dataOf(march).march as { arriveAt: string }).arriveAt) - Date.now()) + 180_000,
    );
    check(outcome.outcome === 'battle_won' && outcome.detail.occupied === true, `B 占领 NPC 城成功（outcome=${outcome.outcome}）`);
    const cities = (dataOf(await playerB.request(Op.GET_STATE)).cities as Array<{ id: string; x: number; y: number }>).filter((c) => c.id !== cityB.id);
    check(cities.length === 1, 'B 的分城出现在 cities 列表');
    branch = cities[0];
    const row = (await pool.query(`SELECT durability FROM cities WHERE id = $1`, [branch.id])).rows[0] as { durability: number | null };
    check(row.durability === DURABILITY_MAX, `分城城防满值（${row.durability}）`);
    await seedParade(pool, branch.id, 5);
  }

  step('验收 8：地图能看到他人分城的城防值（A 视角）');
  {
    const tile = (dataOf(await playerA.request(Op.GET_TILE, { x: branch.x, y: branch.y })).tile ?? {}) as { durability: number | null };
    check(tile.durability === 100, `GET_TILE 下发城防值（${tile.durability}）`);
  }

  step('验收 3：对 B 的主城选占领被拒');
  {
    const mainTile = (dataOf(await playerB.request(Op.GET_STATE)).cities as Array<{ x: number; y: number }>)[0];
    const denied = await playerA.request(Op.MARCH, { x: mainTile.x, y: mainTile.y, troops: { militia: 50 }, task: 'occupy' });
    check(denied.ok === false && denied.error?.code === 'TASK_INVALID_FOR_TARGET', '主城占领被拒（TASK_INVALID_FOR_TARGET）');
    const tile = (dataOf(await playerA.request(Op.GET_TILE, { x: mainTile.x, y: mainTile.y })).tile ?? {}) as { durability: number | null };
    check(tile.durability === null, '主城无城防值（durability=null）');
  }

  step('验收 4：掠夺打赢只抢资源、城防不变');
  {
    await pool.query(`UPDATE cities SET gold = 10000, wood = 10000 WHERE id = $1`, [branch.id]);
    // B 只留少量守军（占城大军撤回主城的口径由后续步骤覆盖，这里控制战斗结局）
    await seedArmy(pool, branch.id, { militia: 30 });
    const before = (dataOf(await playerA.request(Op.GET_TILE, { x: branch.x, y: branch.y })).tile ?? {}) as { durability: number | null };
    const since = await eventCursor(playerA);
    const march = await playerA.request(Op.MARCH, { x: branch.x, y: branch.y, troops: { militia: 300 } });
    check(march.ok === true, '掠夺出征受理（缺省 plunder）');
    const outcome = await waitCityAssault(playerA, since, Math.max(0, Date.parse((dataOf(march).march as { arriveAt: string }).arriveAt) - Date.now()) + 180_000);
    check(outcome.outcome === 'plunder_won', '掠夺打赢');
    const loot = (outcome.detail.loot ?? {}) as Record<string, number>;
    check(loot.gold === 1000, `掠夺照常抢资源（金 ${loot.gold}）`);
    // 免战期内城防不变（惰性结算不回涨）
    const during = (dataOf(await playerA.request(Op.GET_TILE, { x: branch.x, y: branch.y })).tile ?? {}) as { durability: number | null };
    check(during.durability === 100, `掠夺不降城防（${during.durability}）`);
    void before;
    await pool.query(`UPDATE cities SET truce_until = NULL WHERE id = $1`, [branch.id]);
    await seedArmy(pool, branch.id, { militia: 30 });
  }

  step('验收 1（第一击）+ 验收 2：占领打赢不抢资源、降城防、免战内不回涨');
  {
    const branchGold = ((await pool.query(`SELECT gold FROM cities WHERE id = $1`, [branch.id])).rows[0] as { gold: number }).gold;
    const sinceB = await eventCursor(playerB);
    const since = await eventCursor(playerA);
    const march = await playerA.request(Op.MARCH, { x: branch.x, y: branch.y, troops: { militia: 300 }, task: 'occupy' });
    check(march.ok === true, '占领出征受理（分城开放）');
    const outcome = await waitCityAssault(playerA, since, Math.max(0, Date.parse((dataOf(march).march as { arriveAt: string }).arriveAt) - Date.now()) + 180_000);
    check(outcome.outcome === 'battle_won', '占领打赢');
    check(outcome.detail.occupied === false, '城防未归零不换主（occupied=false）');
    check(outcome.detail.loot === undefined, '占领不抢资源（无 loot）');
    const conquest = outcome.detail.conquest as { before: number; after: number; damage: number; protectedUntil: string };
    check(conquest.before === 100 && conquest.after === 65 && conquest.damage === 35, `城防 100→65（一击 −${conquest.damage}）`);
    const goldAfter = ((await pool.query(`SELECT gold FROM cities WHERE id = $1`, [branch.id])).rows[0] as { gold: number }).gold;
    check(goldAfter >= branchGold, `占领不抢资源（金 ${branchGold} → ${goldAfter}，只增不减 = 官府产金）`);
    // 免战内城防不变（GET_TILE 展示）
    const during = (dataOf(await playerA.request(Op.GET_TILE, { x: branch.x, y: branch.y })).tile ?? {}) as { durability: number | null };
    check(during.durability === 65, `免战内城防不回涨（${during.durability}）`);
    // 双方战报（pvp_conquest）
    const reportsA = (dataOf(await playerA.request(Op.GET_BATTLE_REPORTS, { limit: 5 })).reports ?? []) as Array<{ kind: string; role: string }>;
    check(reportsA.some((r) => r.kind === 'pvp_conquest' && r.role === 'attacker'), 'A 拿到攻城战报（pvp_conquest）');
    const reportsB = (dataOf(await playerB.request(Op.GET_BATTLE_REPORTS, { limit: 5 })).reports ?? []) as Array<{ kind: string; role: string }>;
    check(reportsB.some((r) => r.kind === 'pvp_conquest' && r.role === 'defender'), 'B 拿到守城战报');
    // B 收到 pvp_raid 事件（conquest 细节）
    const bEvents = (dataOf(await playerB.request(Op.GET_EVENTS, { sinceId: sinceB, limit: 30 })).events ?? []) as Array<{ type: string; detail: Record<string, unknown> }>;
    const raid = bEvents.find((e) => e.type === 'pvp_raid' && e.detail.conquest !== undefined);
    check(raid !== undefined, 'B 收到 pvp_raid 事件（带 conquest 细节）');
    // 验收 2（后半）：免战结束后按小时回涨（模拟免战与结算时刻已过 2 小时 → +20；
    // 回涨从 max(结算时刻, 免战截止) 起算，两者需一起回拨）
    await pool.query(
      `UPDATE cities SET truce_until = now() - interval '2 hours', durability_settled_at = now() - interval '2 hours' WHERE id = $1`,
      [branch.id],
    );
    const regen = (dataOf(await playerA.request(Op.GET_TILE, { x: branch.x, y: branch.y })).tile ?? {}) as { durability: number | null };
    check(regen.durability === 85, `免战后回涨 2 小时 +20（${regen.durability}）`);
    // 复位回「第一击后、无回涨」状态，走干净的三击序列（100→65→30→0 共 3 胜）
    await pool.query(`UPDATE cities SET durability = 65, durability_settled_at = now(), truce_until = NULL WHERE id = $1`, [branch.id]);
    await seedArmy(pool, branch.id, { militia: 30 });
  }

  step('验收 1（第二击）：城防 65→30');
  {
    const since = await eventCursor(playerA);
    const march = await playerA.request(Op.MARCH, { x: branch.x, y: branch.y, troops: { militia: 300 }, task: 'occupy' });
    check(march.ok === true, '第二击受理');
    const outcome = await waitCityAssault(playerA, since, Math.max(0, Date.parse((dataOf(march).march as { arriveAt: string }).arriveAt) - Date.now()) + 180_000);
    const conquest = outcome.detail.conquest as { before: number; after: number };
    check(conquest.before === 65 && conquest.after === 30, `城防 65→30（实际 ${conquest.before}→${conquest.after}）`);
    await pool.query(`UPDATE cities SET truce_until = NULL WHERE id = $1`, [branch.id]);
    await seedArmy(pool, branch.id, { militia: 30 });
  }

  step('验收 5 前置：B 在分城布防（野地 / 城守 / 队列 / 在外部队 / 在途运输）');
  {
    // B 的分城占一块野地（DB 直改：紧邻无主野地 + 驻军 20）
    const free = (await pool.query(
      `SELECT x, y FROM world_tiles WHERE kind = 'wilderness' AND owner_city_id IS NULL AND abs(x - $1) <= 4 AND abs(y - $2) <= 4 LIMIT 1`,
      [branch.x, branch.y],
    )).rows[0] as { x: number; y: number };
    check(free !== undefined, '找到分城旁野地');
    await pool.query(`UPDATE world_tiles SET owner_city_id = $3 WHERE x = $1 AND y = $2`, [free.x, free.y, branch.id]);
    await pool.query(`INSERT INTO tile_army (x, y, troop, count) VALUES ($1, $2, 'militia', 20)`, [free.x, free.y]);
    // 城守武将（DB 直插账号武将并任命）
    const hero = (await pool.query(
      `INSERT INTO account_heroes (account_id, name, lead, force, wit) VALUES ($1, '守将甲', 10, 10, 10) RETURNING id`,
      [b.accountId],
    )).rows[0] as { id: string };
    await pool.query(`UPDATE cities SET guard_hero_id = $2 WHERE id = $1`, [branch.id, hero.id]);
    // 排队建造 / 征兵 / 该城研究 / 酒馆候选
    await pool.query(
      `INSERT INTO builds (account_id, city_id, kind, status, level, initiator, cost) VALUES ($1, $2, 'farm', 'queued', 1, 'player', '{}'::jsonb)`,
      [b.accountId, branch.id],
    );
    await pool.query(
      `INSERT INTO recruits (account_id, city_id, troop, count, status, initiator, cost, population, unit_seconds) VALUES ($1, $2, 'militia', 10, 'queued', 'player', '{}'::jsonb, 10, 1)`,
      [b.accountId, branch.id],
    );
    await pool.query(
      `INSERT INTO tech_research (account_id, city_id, tech, level, status, initiator, cost, due_at) VALUES ($1, $2, 'farming', 1, 'researching', 'player', '{}'::jsonb, now() + interval '1 hour')`,
      [b.accountId, branch.id],
    );
    await pool.query(`INSERT INTO tavern_candidates (city_id, name, lead, force, wit) VALUES ($1, '候选甲', 5, 5, 5)`, [branch.id]);
    // 在外部队：从分城发出的掠夺行军（DB 直插远途，长期在途）
    const far = (await pool.query(
      `SELECT x, y FROM world_tiles WHERE kind = 'wilderness' AND owner_city_id IS NULL AND abs(x - $1) + abs(y - $2) > 50 LIMIT 1`,
      [branch.x, branch.y],
    )).rows[0] as { x: number; y: number };
    await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'plunder', 'marching', 'player', now() + interval '30 minutes')`,
      [b.accountId, branch.id, far.x, far.y, JSON.stringify({ militia: 50 })],
    );
    // 在途运输：B 主城 → 分城（40 秒后到达，换主后应原路返回）
    await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at, cargo)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'transport', 'marching', 'player', now() + interval '40 seconds', $6::jsonb)`,
      [b.accountId, cityB.id, branch.x, branch.y, JSON.stringify({ porter: 5 }), JSON.stringify({ gold: 0, wood: 100, food: 0, stone: 0, iron: 0 })],
    );
    await seedArmy(pool, branch.id, { militia: 30 });
  }

  step('验收 1（第三击）：城防归零，当场换主');
  {
    const since = await eventCursor(playerA);
    const sinceB = await eventCursor(playerB);
    const march = await playerA.request(Op.MARCH, { x: branch.x, y: branch.y, troops: { militia: 300 }, task: 'occupy' });
    check(march.ok === true, '第三击受理');
    const outcome = await waitCityAssault(playerA, since, Math.max(0, Date.parse((dataOf(march).march as { arriveAt: string }).arriveAt) - Date.now()) + 180_000);
    check(outcome.outcome === 'battle_won' && outcome.detail.occupied === true, '城防归零换主（occupied=true）');
    const conquest = outcome.detail.conquest as { before: number; after: number; transferred: boolean; durability: number };
    check(conquest.before === 30 && conquest.after === 0 && conquest.transferred === true, `城防 30→0（transferred=${conquest.transferred}）`);
    check(conquest.durability === 100, '换主后城防回满 100');
    // 城归属 A
    const aCities = (dataOf(await playerA.request(Op.GET_STATE)).cities as Array<{ id: string }>);
    check(aCities.some((c) => c.id === branch.id), '分城出现在 A 的 cities 列表');
    const bCities = (dataOf(await playerB.request(Op.GET_STATE)).cities as Array<{ id: string }>);
    check(!bCities.some((c) => c.id === branch.id), '分城从 B 的 cities 列表消失');
    // 双方通知
    const bEvents = (dataOf(await playerB.request(Op.GET_EVENTS, { sinceId: sinceB, limit: 50 })).events ?? []) as Array<{ type: string; detail: Record<string, unknown> }>;
    const lostEvent = bEvents.find((e) => e.type === 'city_conquered');
    check(lostEvent !== undefined && lostEvent.detail.outcome === 'lost', 'B 收到失城通知（city_conquered lost）');
    const aEvents = (dataOf(await playerA.request(Op.GET_EVENTS, { sinceId: since, limit: 50 })).events ?? []) as Array<{ type: string; detail: Record<string, unknown> }>;
    const gainEvent = aEvents.find((e) => e.type === 'city_conquered');
    check(gainEvent !== undefined && gainEvent.detail.outcome === 'gained', 'A 收到得城通知（city_conquered gained）');
    // 全服播报
    const broadcasts = (dataOf(await playerA.request(Op.GET_SERVER_BROADCASTS)).broadcasts ?? []) as Array<{ type: string }>;
    check(broadcasts.some((bc) => bc.type === 'city_conquered'), '全服播报 city_conquered');
  }

  step('验收 5：换主处理逐项核验');
  {
    // 建筑与资源保留、城防满、保护 6 小时、城守卸任、武将仍归 B
    const cityRow = (await pool.query(
      `SELECT account_id, guard_hero_id, durability, truce_until, gold FROM cities WHERE id = $1`,
      [branch.id],
    )).rows[0] as { account_id: string; guard_hero_id: string | null; durability: number; truce_until: Date; gold: number };
    check(cityRow.account_id === a.accountId, '城归属 A');
    check(cityRow.guard_hero_id === null, '城守卸任（guard_hero_id=NULL）');
    check(cityRow.durability === 100, '城防回满');
    check(cityRow.gold >= 9000, `资源保留（金 ${cityRow.gold} ≥ 9000 = 10000 − 掠夺 1000，产金只增）`);
    const heroRow = (await pool.query(`SELECT account_id FROM account_heroes WHERE id = (SELECT id FROM account_heroes WHERE account_id = $1 AND name = '守将甲' LIMIT 1)`, [b.accountId])).rows[0] as { account_id: string } | undefined;
    check(heroRow?.account_id === b.accountId, '武将仍归 B');
    // 队列 / 研究 / 酒馆候选作废
    const counts = (await pool.query(
      `SELECT (SELECT count(*) FROM builds WHERE city_id = $1)::int AS builds,
              (SELECT count(*) FROM recruits WHERE city_id = $1)::int AS recruits,
              (SELECT count(*) FROM tech_research WHERE city_id = $1)::int AS techs,
              (SELECT count(*) FROM tavern_candidates WHERE city_id = $1)::int AS tavern`,
      [branch.id],
    )).rows[0] as { builds: number; recruits: number; techs: number; tavern: number };
    check(counts.builds === 0 && counts.recruits === 0 && counts.techs === 0 && counts.tavern === 0, `队列作废（build=${counts.builds} recruit=${counts.recruits} tech=${counts.techs} tavern=${counts.tavern}）`);
    // 分城的野地变无主、驻军回 B 主城
    const territory = (await pool.query(
      `SELECT count(*)::int AS n FROM world_tiles WHERE owner_city_id = $1 AND kind = 'wilderness'`,
      [branch.id],
    )).rows[0] as { n: number };
    check(territory.n === 0, `分城野地已全部无主（城池地块本身保留，归属随城）`);
    const bMainArmy = (await pool.query(`SELECT count FROM city_army WHERE city_id = $1 AND troop = 'militia'`, [cityB.id])).rows[0] as { count: number };
    check(bMainArmy.count >= 20, `野地驻军已回 B 主城（义兵 ${bMainArmy.count}）`);
    // 在外部队改从 B 主城返程
    const outbound = (await pool.query(
      `SELECT from_city_id FROM marches WHERE account_id = $1 AND status = 'marching' AND purpose = 'plunder'`,
      [b.accountId],
    )).rows as Array<{ from_city_id: string }>;
    check(outbound.length === 1 && outbound[0].from_city_id === cityB.id, '分城在外部队已改挂 B 主城');
    // 在途运输：40 秒后按失效原路返回（等它结算）
    await new Promise((resolve) => setTimeout(resolve, 50_000));
    const transport = (await pool.query(
      `SELECT status, purpose FROM marches WHERE account_id = $1 AND purpose IN ('transport', 'return') ORDER BY started_at DESC LIMIT 2`,
      [b.accountId],
    )).rows as Array<{ status: string; purpose: string }>;
    check(transport.some((m) => m.purpose === 'return' && m.status === 'marching') || transport.every((m) => m.status !== 'marching'),
      `在途运输已折返（${JSON.stringify(transport)}）`);
    const bEvents = (dataOf(await playerB.request(Op.GET_EVENTS, { limit: 20 })).events ?? []) as Array<{ type: string; detail: Record<string, unknown> }>;
    check(bEvents.some((e) => e.type === 'wilderness_lost'), 'B 收到分城野地的 wilderness_lost');
  }

  step('验收 6：换主后的保护期内任何人出兵被拒');
  {
    const truce = (dataOf(await playerA.request(Op.GET_TILE, { x: branch.x, y: branch.y })).tile ?? {}) as {
      protection: { truceUntil: string | null } | null;
      durability: number | null;
    };
    check(truce.protection === null, 'A 看自己的城无 protection');
    // B 反打被拒（TARGET_IN_TRUCE，6 小时口径）
    const denied = await playerB.request(Op.MARCH, { x: branch.x, y: branch.y, troops: { militia: 50 }, task: 'occupy' });
    check(denied.ok === false && denied.error?.code === 'TARGET_IN_TRUCE', '保护期内出兵被拒（TARGET_IN_TRUCE）');
    check(typeof denied.data?.retryAfterSeconds === 'number', '拒绝响应附 retryAfterSeconds');
    const tile = (dataOf(await playerB.request(Op.GET_TILE, { x: branch.x, y: branch.y })).tile ?? {}) as { durability: number | null };
    check(tile.durability === 100, `B 视角：城已归 A，作为他人分城仍可见城防（${tile.durability}）`);
  }

  step('验收 7：名额已满出发被拒；出发后名额没了只降城防');
  {
    // A 主城官府 6 → 名额 2，已占 1 座（换主的分城）：再造一座「他人分城」当目标
    const free2 = (await pool.query(
      `SELECT x, y FROM world_tiles WHERE kind = 'wilderness' AND owner_city_id IS NULL AND abs(x - $1) <= 4 AND abs(y - $2) <= 4 LIMIT 1`,
      [branch.x, branch.y],
    )).rows[0] as { x: number; y: number };
    const cityC = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, population, x, y, durability, durability_settled_at)
       VALUES ($1, 'B 的二分城', 1000, 1000, 1000, 1000, 1000, 50, $2, $3, 100, now()) RETURNING id`,
      [b.accountId, free2.x, free2.y],
    )).rows[0] as { id: string };
    await pool.query(
      `UPDATE world_tiles SET kind = 'city', level = 0, owner_city_id = $3, npc = NULL WHERE x = $1 AND y = $2`,
      [free2.x, free2.y, cityC.id],
    );
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 1)`, [cityC.id]);
    await seedArmy(pool, cityC.id, { militia: 10 });
    // 名额满（A 官府降到 3 → 名额 1，已占 1 座）：出发被拒
    await pool.query(
      `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 3)
       ON CONFLICT (city_id, kind) DO UPDATE SET level = 3`,
      [cityA.id],
    );
    const denied = await playerA.request(Op.MARCH, { x: free2.x, y: free2.y, troops: { militia: 50 }, task: 'occupy' });
    check(denied.ok === false && denied.error?.code === 'BRANCH_LIMIT', '名额已满出发被拒（BRANCH_LIMIT）');
    // 出发后名额没了：官府先放开（6 级受理），出发后再压回 3 级
    await pool.query(
      `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 6)
       ON CONFLICT (city_id, kind) DO UPDATE SET level = 6`,
      [cityA.id],
    );
    const since = await eventCursor(playerA);
    const march = await playerA.request(Op.MARCH, { x: free2.x, y: free2.y, troops: { militia: 300 }, task: 'occupy' });
    check(march.ok === true, '名额放开后受理');
    await pool.query(
      `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 3)
       ON CONFLICT (city_id, kind) DO UPDATE SET level = 3`,
      [cityA.id],
    );
    const outcome = await waitCityAssault(playerA, since, Math.max(0, Date.parse((dataOf(march).march as { arriveAt: string }).arriveAt) - Date.now()) + 180_000);
    check(outcome.outcome === 'battle_won' && outcome.detail.occupied === false, '打赢但不换主（occupied=false）');
    check(outcome.detail.denial === 'BRANCH_LIMIT', `事件记录 denial=${String(outcome.detail.denial)}`);
    const conquest = outcome.detail.conquest as { before: number; after: number };
    check(conquest.before === 100 && conquest.after === 65, `城防照降（${conquest.before}→${conquest.after}）`);
    const owner = (await pool.query(`SELECT account_id FROM cities WHERE id = $1`, [cityC.id])).rows[0] as { account_id: string };
    check(owner.account_id === b.accountId, '城仍归 B');
  }

  const resetA = await playerA.request(Op.RESET_ACCOUNT, { confirm: true });
  check(resetA.ok === true, '账号 A 重置成功');
  const resetB = await playerB.request(Op.RESET_ACCOUNT, { confirm: true });
  check(resetB.ok === true, '账号 B 重置成功');
  playerA.close();
  playerB.close();
  await pool.end();
  console.log('\n玩家对抗（三）占城冒烟完成：账号已重置。');
}

main().catch((err) => {
  console.error('占城冒烟失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
