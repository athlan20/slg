// v38（AISLG-122 玩家对抗一）冒烟（独立脚本，可在真实栈上单独运行）：
//   npx tsx --env-file=.env scripts/smoke-pvp.ts
// 覆盖：新手保护拦截（侦察 / 攻击）、主动破保、玩家侦察读驻军与城墙、掠夺玩家城
// （守城战 / 单次比例上限 / 等级差衰减 / 双方战报 kind=pvp_raid）、被打后免战拦截、
// TRUCE 主动免战（重复开启 / 周窗口 / 开着不能打玩家 / 打野地不受限）、占领玩家城被拒。
// 前置：API 与 Worker 已以 v38 代码启动。兵力与部分前置状态（出保、资源、官府等级、
// 免战到期）经数据库直改以缩短流程，出征 / 侦察 / 免战与结算路径全部走真实链路。

import { Op, type TroopKind } from '../common/src/protocol';
import { createPool } from '../common/src/db';
import { PVP_GOLD_SHARE, PVP_PLUNDER_SHARE } from '../common/src/protection';
import { Client, check, dataOf, step } from './smoke-client';
import { waitMarchOutcome } from './smoke-world-utils';

const password = 'smoke-pass-123';

/** DB 直改城内驻军（冒烟提速：绕过征兵队列；出征校验只看 city_army） */
async function seedArmy(pool: ReturnType<typeof createPool>, cityId: string, troops: Partial<Record<TroopKind, number>>): Promise<void> {
  for (const [troop, count] of Object.entries(troops)) {
    await pool.query(
      `INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)
       ON CONFLICT (city_id, troop) DO UPDATE SET count = EXCLUDED.count, updated_at = now()`,
      [cityId, troop, count],
    );
  }
}

/** 预置校场等级（冒烟账号免受新号 1 支在外的上限约束，多支部队并行） */
async function seedParade(pool: ReturnType<typeof createPool>, cityId: string, level: number): Promise<void> {
  await pool.query(
    `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'parade_ground', $2)
     ON CONFLICT (city_id, kind) DO UPDATE SET level = $2`,
    [cityId, level],
  );
}

/** 取账号最新事件 id（增量游标） */
async function eventCursor(client: Client): Promise<number> {
  const events = (dataOf(await client.request(Op.GET_EVENTS, { limit: 1 })).events ?? []) as Array<{ id: number }>;
  return events.reduce((max, e) => Math.max(max, e.id), 0);
}

/** 把 cityId 的城搬到 (nearX, nearY) 附近的无主野地（共享世界出生点分散，冒烟控距用；
 *  内容交换保持 (x,y) 主键不动：目标格接收城池行内容，原城池格还原为无主野地） */
async function relocateCityNear(
  pool: ReturnType<typeof createPool>,
  cityId: string,
  nearX: number,
  nearY: number,
): Promise<{ x: number; y: number }> {
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
      `SELECT x, y, terrain, kind, level, owner_city_id, npc, plundered_at FROM world_tiles WHERE owner_city_id = $1 FOR UPDATE`,
      [cityId],
    );
    const cityTile = cityTileRes.rows[0] as {
      x: number; y: number; terrain: string; kind: string; level: number; owner_city_id: string; npc: unknown; plundered_at: Date | null;
    };
    await client.query(
      `UPDATE world_tiles SET terrain = $3, kind = $4, level = $5, owner_city_id = $6, npc = $7, plundered_at = $8
       WHERE x = $1 AND y = $2`,
      [free.x, free.y, cityTile.terrain, cityTile.kind, cityTile.level, cityTile.owner_city_id, JSON.stringify(cityTile.npc ?? null), null],
    );
    await client.query(
      `UPDATE world_tiles SET terrain = 'plain', kind = 'wilderness', level = 1, owner_city_id = NULL, npc = NULL, plundered_at = NULL
       WHERE x = $1 AND y = $2`,
      [cityTile.x, cityTile.y],
    );
    await client.query(`UPDATE cities SET x = $2, y = $3 WHERE id = $1`, [cityId, free.x, free.y]);
    await client.query('COMMIT');
    return { x: free.x, y: free.y };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 等待对玩家城的出征结局（跳过同坐标的返程 / 侦察事件；按编队规模识别掠夺主力） */
async function waitPvpRaidOutcome(
  client: Client,
  sinceId: number,
  timeoutMs: number,
): Promise<{ outcome: string; detail: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await client.request(Op.GET_EVENTS, { sinceId, limit: 50 });
    if (res.ok) {
      const events = (dataOf(res).events ?? []) as Array<{ id: number; type: string; detail: Record<string, unknown> }>;
      const done = events.find((event) => {
        if (event.type !== 'march_completed') {
          return false;
        }
        const outcome = String(event.detail.outcome);
        const troops = event.detail.troops as Record<string, number> | undefined;
        const mainForce = (troops?.militia ?? 0) + (troops?.porter ?? 0) >= 100;
        return mainForce && (outcome === 'plunder_won' || outcome === 'battle_lost' || outcome === 'aborted');
      });
      if (done) {
        return { outcome: String(done.detail.outcome), detail: done.detail };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('等待超时：玩家城出征结算事件');
}

async function main(): Promise<void> {
  const suffix = Date.now();
  const pool = createPool('smoke-pvp');

  const playerA = await Client.connect();
  const loginA = await playerA.request(Op.LOGIN, { username: `smoke_pvp_a_${suffix}`, password, asAgent: false });
  check(loginA.ok === true, '账号 A 注册登录成功');
  const a = dataOf(loginA) as { accountId: string; username: string };
  const stateA = dataOf(await playerA.request(Op.GET_STATE)) as {
    city: { id: string; newbieUntil: string | null };
    cities: Array<{ id: string; x: number; y: number }>;
  };
  check(stateA.city.newbieUntil !== null, '新注册账号带新手保护（city.newbieUntil 非空）');
  const cityA = stateA.cities[0];

  const playerB = await Client.connect();
  const loginB = await playerB.request(Op.LOGIN, { username: `smoke_pvp_b_${suffix}`, password, asAgent: false });
  check(loginB.ok === true, '账号 B 注册登录成功');
  const b = dataOf(loginB) as { accountId: string; username: string };
  const stateB = dataOf(await playerB.request(Op.GET_STATE)) as { cities: Array<{ id: string; x: number; y: number }> };
  // 共享世界出生点分散：把 B 的城搬到 A 旁边（≤3 格），把冒烟里的行军压到分钟内
  const cityBMoved = await relocateCityNear(pool, (dataOf(await playerB.request(Op.GET_STATE)) as { city: { id: string } }).city.id, cityA.x, cityA.y);
  const cityB = { id: (dataOf(await playerB.request(Op.GET_STATE)) as { city: { id: string } }).city.id, ...cityBMoved };
  check(stateB.cities.length >= 1, '账号 B 城池就绪');

  step('验收 3（前半）：目标在新手保护期——A 打 / 侦察 B 被拒并带剩余时间');
  {
    await seedArmy(pool, cityA.id, { militia: 10, scout: 2 });
    await seedParade(pool, cityA.id, 5);
    await seedParade(pool, cityB.id, 5);
    const denied = await playerA.request(Op.MARCH, { x: cityB.x, y: cityB.y, troops: { militia: 1 } });
    check(denied.ok === false && denied.error?.code === 'NEWBIE_PROTECTED', '掠夺新手被拒（NEWBIE_PROTECTED）');
    check(typeof denied.data?.retryAfterSeconds === 'number' && (denied.data?.retryAfterSeconds as number) > 0, '拒绝响应附 retryAfterSeconds');
    check(typeof denied.data?.until === 'string', '拒绝响应附 until');
    const deniedScout = await playerA.request(Op.SCOUT, { x: cityB.x, y: cityB.y, count: 1 });
    check(
      deniedScout.ok === false && deniedScout.error?.code === 'NEWBIE_PROTECTED',
      '侦察新手也被拒（NEWBIE_PROTECTED）',
    );
    const tile = (dataOf(await playerA.request(Op.GET_TILE, { x: cityB.x, y: cityB.y })).tile ?? {}) as {
      protection: { newbieUntil: string | null; truceUntil: string | null; shieldUntil: string | null } | null;
    };
    check(tile.protection !== null && tile.protection.newbieUntil !== null, 'GET_TILE 可读对方保护状态（protection.newbieUntil）');
  }

  step('验收 4：新手保护期内主动侦察别的玩家 → 保护立即失效');
  {
    // B 出保（模拟官府到 5 级），A 仍在保护期：A 侦察 B 成功且自己破保
    await pool.query(`UPDATE accounts SET newbie_until = NULL WHERE id = $1`, [b.accountId]);
    const scout = await playerA.request(Op.SCOUT, { x: cityB.x, y: cityB.y, count: 1 });
    check(scout.ok === true, 'A 侦察 B（B 已出保）受理');
    const events = (dataOf(await playerA.request(Op.GET_EVENTS, { limit: 20 })).events ?? []) as Array<{ type: string }>;
    check(events.some((event) => event.type === 'newbie_protection_ended'), 'A 的事件流记录 newbie_protection_ended（主动进攻破保）');
    const stateNow = dataOf(await playerA.request(Op.GET_STATE)) as { city: { newbieUntil: string | null } };
    check(stateNow.city.newbieUntil === null, 'A 的新手保护已失效（newbieUntil=null）');
  }

  step('验收 1：侦察玩家城读到驻军与城墙（守城战口径）');
  {
    await seedArmy(pool, cityB.id, { militia: 30 });
    // 预置 6 级侦察科技：情报走精确档（0-2 级粗略档驻军全 0、只给总数范围，另行断言）
    await pool.query(
      `INSERT INTO account_techs (account_id, tech, level) VALUES ($1, 'scouting', 6)
       ON CONFLICT (account_id, tech) DO UPDATE SET level = 6`,
      [a.accountId],
    );
    const since = await eventCursor(playerA);
    const scout = await playerA.request(Op.SCOUT, { x: cityB.x, y: cityB.y, count: 1 });
    check(scout.ok === true, 'SCOUT 受理');
    const outcome = await waitMarchOutcome(
      playerA, since,
      Math.max(0, Date.parse((dataOf(scout).march as { arriveAt: string }).arriveAt) - Date.now()) + 120_000,
    );
    check(outcome.outcome === 'scouted', '事件 outcome=scouted');
    const intel = (outcome.detail.intel ?? {}) as {
      garrison: Record<string, number>;
      wallDefensePercent: number;
      kind: string;
    };
    check(intel.kind === 'city', '情报 kind=city');
    check((intel.garrison.militia ?? 0) === 30, `玩家城驻军来自 city_army（精确档读到义兵 ${intel.garrison.militia ?? 0}）`);
    check(typeof intel.wallDefensePercent === 'number', `城墙减伤随情报下发（${intel.wallDefensePercent}%）`);
  }

  step('验收 1 / 2：掠夺玩家城——预警、守城战、比例上限、双方战报');
  let bCityTruceUntil: string | null = null;
  {
    // B 攒资源等抢：仓库 10 级（每资源保护 10000）、粮 / 木 100000、金 20000
    await pool.query(`UPDATE cities SET food = 100000, wood = 100000, gold = 20000 WHERE id = $1`, [cityB.id]);
    await pool.query(
      `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'warehouse', 10)
       ON CONFLICT (city_id, kind) DO UPDATE SET level = 10`,
      [cityB.id],
    );
    // A 出征：100 义兵 + 200 民夫（负重 106000 > 全部上限合计，验证封顶而非负重）
    await seedArmy(pool, cityA.id, { militia: 100, porter: 200 });
    const sinceA = await eventCursor(playerA);
    const march = await playerA.request(Op.MARCH, { x: cityB.x, y: cityB.y, troops: { militia: 100, porter: 200 } });
    check(march.ok === true, '掠夺玩家城受理（缺省 plunder）');
    check(((dataOf(march).march ?? {}) as { purpose: string }).purpose === 'plunder', '行军 purpose=plunder');
    const arriveAt = (dataOf(march).march as { arriveAt: string }).arriveAt;
    // 验收 1：B 收到来袭预警（op 2017），带进攻方与到达时刻
    const warning = await playerB.waitPush(Op.PUSH_ATTACK_WARNING, 10_000, (data) => data.target === 'city');
    const warningData = warning.data as { attacker: { username: string }; arriveAt: string; armyMin: number };
    check(warningData.attacker.username === a.username, `预警带进攻方（${warningData.attacker.username}）`);
    check(warningData.arriveAt === arriveAt, '预警 arriveAt = 行军到达时刻');
    check(warningData.armyMin > 0, `预警带兵力范围（约 ${warningData.armyMin}）`);
    const warningEvents = (dataOf(await playerB.request(Op.GET_EVENTS, { limit: 20 })).events ?? []) as Array<{ type: string }>;
    check(warningEvents.some((event) => event.type === 'player_attack_warning'), 'B 的事件流记录 player_attack_warning');

    // 战斗结算：500 义兵打 30 义兵守军（守城战），A 应获胜
    const outcome = await waitPvpRaidOutcome(playerA, sinceA, Math.max(0, Date.parse(arriveAt) - Date.now()) + 120_000);
    check(outcome.outcome === 'plunder_won', `攻破玩家城（outcome=plunder_won）`);
    const loot = (outcome.detail.loot ?? {}) as Record<string, number>;
    // 验收 2：粮 / 木 ≤ (存量 − 仓库保护) × 30%；金 ≤ 存量 × 10%（A、B 官府同为 1 级无衰减）
    const foodCap = Math.floor((100000 - 10000) * PVP_PLUNDER_SHARE);
    const goldCap = Math.floor(20000 * PVP_GOLD_SHARE);
    check(loot.food === foodCap, `粮按 ${PVP_PLUNDER_SHARE * 100}% 封顶（${loot.food} = ${foodCap}，负重未先到）`);
    check(loot.wood === foodCap, `木按 ${PVP_PLUNDER_SHARE * 100}% 封顶（${loot.wood} = ${foodCap}）`);
    check(loot.gold === goldCap, `金币按 ${PVP_GOLD_SHARE * 100}% 封顶（${loot.gold} = ${goldCap}）`);
    const target = outcome.detail.target as { username: string } | undefined;
    check(target?.username === b.username, '事件带目标玩家名');

    // 验收 1：双方都有战报（kind=pvp_raid）
    const reportsA = (dataOf(await playerA.request(Op.GET_BATTLE_REPORTS, { limit: 5 })).reports ?? []) as Array<{ kind: string; role: string; won: boolean }>;
    const mine = reportsA.find((r) => r.kind === 'pvp_raid');
    check(mine !== undefined && mine.role === 'attacker' && mine.won === true, 'A 拿到攻方视角战报（pvp_raid / 胜）');
    const reportsB = (dataOf(await playerB.request(Op.GET_BATTLE_REPORTS, { limit: 5 })).reports ?? []) as Array<{ kind: string; role: string; won: boolean }>;
    const theirs = reportsB.find((r) => r.kind === 'pvp_raid');
    check(theirs !== undefined && theirs.role === 'defender' && theirs.won === false, 'B 拿到守方视角战报（pvp_raid / 败）');

    // 守方事件：pvp_raid garrison_lost + 免战截止
    const bEvents = (dataOf(await playerB.request(Op.GET_EVENTS, { limit: 50 })).events ?? []) as Array<{ type: string; detail: Record<string, unknown> }>;
    const raidEvent = bEvents.find((event) => event.type === 'pvp_raid');
    check(raidEvent !== undefined && raidEvent.detail.outcome === 'garrison_lost', 'B 的事件流记录 pvp_raid（garrison_lost）');
    bCityTruceUntil = (raidEvent?.detail.truceUntil as string) ?? null;
    check(bCityTruceUntil !== null, `守方事件带免战截止（${bCityTruceUntil}）`);
    const bState = (dataOf(await playerB.request(Op.GET_STATE)).city ?? {}) as { resources: Record<string, number>; truceUntil: string | null; army: Record<string, number> };
    check(
      bState.resources.food === 100000 - loot.food && bState.resources.wood === 100000 - loot.wood,
      `B 的资源按战利品扣减（粮剩 ${bState.resources.food}、木剩 ${bState.resources.wood}）`,
    );
    check(bState.truceUntil === bCityTruceUntil, 'B 的 city.truceUntil = 被打后免战');
    check((bState.army.militia ?? 0) === 0, 'B 守军全灭清空');
  }

  step('验收 3：B 在被打后免战期——A 出兵被拒并带原因与剩余时间');
  {
    const denied = await playerA.request(Op.MARCH, { x: cityB.x, y: cityB.y, troops: { militia: 10 } });
    check(denied.ok === false && denied.error?.code === 'TARGET_IN_TRUCE', '免战期掠夺被拒（TARGET_IN_TRUCE）');
    check(typeof denied.data?.retryAfterSeconds === 'number', '拒绝响应附 retryAfterSeconds');
    const tile = (dataOf(await playerA.request(Op.GET_TILE, { x: cityB.x, y: cityB.y })).tile ?? {}) as {
      protection: { truceUntil: string | null } | null;
    };
    check(tile.protection?.truceUntil === bCityTruceUntil, 'GET_TILE 的 protection.truceUntil 与事件一致');
  }

  step('验收 5：主动免战——B 开启后 A 打不了 B、B 打不了 A、打野地不受限');
  {
    await pool.query(`UPDATE cities SET truce_until = NULL WHERE id = $1`, [cityB.id]);
    const truce = await playerB.request(Op.TRUCE, {});
    check(truce.ok === true, 'TRUCE 受理（每周一次免费）');
    const truceData = dataOf(truce) as { shieldUntil: string; nextAvailableAt: string };
    check(Date.parse(truceData.shieldUntil) > Date.now(), `免战截止（${truceData.shieldUntil}）`);
    const again = await playerB.request(Op.TRUCE, {});
    check(again.ok === false && again.error?.code === 'TRUCE_ALREADY_ACTIVE', '免战中重复开启被拒（TRUCE_ALREADY_ACTIVE）');
    const deniedA = await playerA.request(Op.MARCH, { x: cityB.x, y: cityB.y, troops: { militia: 10 } });
    check(deniedA.ok === false && deniedA.error?.code === 'TARGET_IN_TRUCE', 'A 打免战中的 B 被拒（TARGET_IN_TRUCE）');
    const deniedB = await playerB.request(Op.MARCH, { x: cityA.x, y: cityA.y, troops: { militia: 10 } });
    check(deniedB.ok === false && deniedB.error?.code === 'SELF_TRUCE_ACTIVE', '免战中的 B 出兵打玩家被拒（SELF_TRUCE_ACTIVE）');
    // 打野地不受限：出征后立即撤回，不真正打（B 的守军已被攻破清空，先补兵力）
    await seedArmy(pool, cityB.id, { militia: 10 });
    const wild = (dataOf(await playerB.request(Op.GET_WORLD_MAP, { x: cityB.x - 5, y: cityB.y - 5, w: 10, h: 10 })).tiles ?? []) as Array<{ x: number; y: number; kind: string; owner: unknown }>;
    const target = wild.find((tile) => tile.kind === 'wilderness' && !tile.owner);
    check(target !== undefined, `找到一块无主野地 (${target?.x},${target?.y})`);
    const wildMarch = await playerB.request(Op.MARCH, { x: target!.x, y: target!.y, troops: { militia: 10 } });
    check(wildMarch.ok === true, '免战中的 B 打野地不受限');
    await playerB.request(Op.RECALL_MARCH, { marchId: (dataOf(wildMarch).march as { id: string }).id });
    // 周窗口：把免战置为已过期（模拟 12 小时后），再次开启 → TRUCE_WEEKLY_USED
    await pool.query(`UPDATE accounts SET self_truce_until = now() - interval '1 second' WHERE id = $1`, [b.accountId]);
    const weekly = await playerB.request(Op.TRUCE, {});
    check(weekly.ok === false && weekly.error?.code === 'TRUCE_WEEKLY_USED', '本周已用过被拒（TRUCE_WEEKLY_USED）');
    check(typeof weekly.data?.nextAvailableAt === 'string', '拒绝响应附 nextAvailableAt');
    const bState = (dataOf(await playerB.request(Op.GET_STATE)).city ?? {}) as { shieldNextAt: string | null };
    check(bState.shieldNextAt !== null, 'city.shieldNextAt 下发下次可开时刻');
    await pool.query(`UPDATE accounts SET self_truce_until = NULL, self_truce_used_at = NULL WHERE id = $1`, [b.accountId]);
  }

  step('验收 6：等级差衰减——A 官府拉到 20 级再打，收益按下限 25%');
  {
    await pool.query(`UPDATE cities SET food = 100000, wood = 100000, gold = 20000, truce_until = NULL WHERE id = $1`, [cityB.id]);
    await pool.query(
      `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 20)
       ON CONFLICT (city_id, kind) DO UPDATE SET level = 20`,
      [cityA.id],
    );
    await seedArmy(pool, cityA.id, { militia: 100, porter: 200 });
    const since = await eventCursor(playerA);
    const march = await playerA.request(Op.MARCH, { x: cityB.x, y: cityB.y, troops: { militia: 100, porter: 200 } });
    check(march.ok === true, '大号打小号不禁止（出征受理）');
    const outcome = await waitPvpRaidOutcome(playerA, since, Math.max(0, Date.parse((dataOf(march).march as { arriveAt: string }).arriveAt) - Date.now()) + 120_000);
    check(outcome.outcome === 'plunder_won', '大号照样攻破');
    const loot = (outcome.detail.loot ?? {}) as Record<string, number>;
    const expectedFood = Math.floor((100000 - 10000) * PVP_PLUNDER_SHARE * 0.25);
    const expectedGold = Math.floor(20000 * PVP_GOLD_SHARE * 0.25);
    check(loot.food === expectedFood, `等级差 19 级收益按下限 25%（粮 ${loot.food} = ${expectedFood}）`);
    check(loot.gold === expectedGold, `金币同口径衰减（${loot.gold} = ${expectedGold}）`);
  }

  step('出保后可被攻击 + 占领玩家城仍被拒（本条只做掠夺）');
  {
    const playerC = await Client.connect();
    const loginC = await playerC.request(Op.LOGIN, { username: `smoke_pvp_c_${suffix}`, password, asAgent: false });
    check(loginC.ok === true, '账号 C 注册登录成功');
    const c = dataOf(loginC) as { accountId: string };
    const cityC = (dataOf(await playerC.request(Op.GET_STATE)).cities as Array<{ x: number; y: number }>)[0];
    const blocked = await playerA.request(Op.MARCH, { x: cityC.x, y: cityC.y, troops: { militia: 10 } });
    check(blocked.ok === false && blocked.error?.code === 'NEWBIE_PROTECTED', 'C 在新手保护期，A 打 C 被拒');
    await pool.query(`UPDATE accounts SET newbie_until = NULL WHERE id = $1`, [c.accountId]);
    await pool.query(`UPDATE cities SET truce_until = NULL WHERE id = $1`, [cityB.id]);
    const okMarch = await playerA.request(Op.MARCH, { x: cityC.x, y: cityC.y, troops: { militia: 10 } });
    check(okMarch.ok === true, 'C 出保后可被攻击（受理，随后撤回）');
    await playerA.request(Op.RECALL_MARCH, { marchId: (dataOf(okMarch).march as { id: string }).id });
    const occupy = await playerA.request(Op.MARCH, { x: cityB.x, y: cityB.y, troops: { militia: 10 }, task: 'occupy' });
    check(occupy.ok === false && occupy.error?.code === 'TASK_INVALID_FOR_TARGET', 'task=occupy 对玩家城被拒（TASK_INVALID_FOR_TARGET）');
    const resetC = await playerC.request(Op.RESET_ACCOUNT, { confirm: true });
    check(resetC.ok === true, '账号 C 重置成功');
    playerC.close();
  }

  const resetA = await playerA.request(Op.RESET_ACCOUNT, { confirm: true });
  check(resetA.ok === true, '账号 A 重置成功');
  const resetB = await playerB.request(Op.RESET_ACCOUNT, { confirm: true });
  check(resetB.ok === true, '账号 B 重置成功');
  playerA.close();
  playerB.close();
  await pool.end();
  console.log('\n玩家对抗（一）冒烟完成：账号已重置。');
}

main().catch((err) => {
  console.error('玩家对抗冒烟失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
