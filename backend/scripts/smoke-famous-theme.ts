// AISLG-167 黑盒验收（协议 v63）：名城主题建筑等级上限 25。
// 断言全部走 docs/agent-api.md 的协议（WebSocket）；数据库只用于造状态——建号、
// 把主城挪到洛阳旁边、预置兵力 / 建筑等级 / 资源，以及模拟「名城标记换主」，
// 与既有 smoke-pvp-conquer.ts 同口径。攻下洛阳本身是端到端的真实流程（两阶段）。
//
// 运行（api 与 worker 需已以 v63 代码启动；建议 BUILD_SECONDS=1 MARCH_SECONDS_PER_TILE=1）：
//   npx tsx --env-file=.env scripts/smoke-famous-theme.ts
// 可选项：--skip-conquer 跳过攻城（复用已有名城城）；--no-wait 跳过 24→25 的完工等待。

import pg from 'pg';
import { Op } from '../common/src/protocol';
import { createPool, ensureSchema } from '../common/src/db';
import { Client, dataOf, step, stepTotal } from './smoke-client';
import { seedAccount } from './smoke-account';

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8080/ws';
const TARGET = { x: 841, y: 155 }; // 洛阳（世界种子固定，先经 DB 定位再走协议攻打）
const SKIP_CONQUER = process.argv.includes('--skip-conquer');
const NO_WAIT = process.argv.includes('--no-wait');

/** 名城 → 主题建筑（协议文档 city.levelMax 的对应表） */
const THEME_OF: Record<string, string> = {
  洛阳: 'wall',
  长安: 'arrow_tower',
  官渡: 'farm',
  成都: 'iron_mine',
  建业: 'lumber_mill',
  邺城: 'government',
  许昌: 'post_station',
  襄阳: 'warehouse',
};
/** city.levels 的键集（协议文档 city.buildings 列出） */
const KINDS = [
  'farm', 'lumber_mill', 'quarry', 'iron_mine', 'house', 'government', 'barracks',
  'warehouse', 'wall', 'academy', 'parade_ground', 'beacon', 'post_station', 'arrow_tower', 'tavern',
];

const user = `f167_${Date.now()}`;
const password = 'smoke-pass-123';
let accountId = '';
let mainCityId = '';
let famousCityId = '';

const results: Array<{ label: string; ok: boolean; detail: string }> = [];

/** 记录一条验收断言（失败不中断，最后统一汇总） */
function verify(label: string, ok: boolean, detail = ''): void {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`);
}
const eq = (label: string, actual: unknown, expected: unknown): void =>
  verify(label, JSON.stringify(actual) === JSON.stringify(expected), `实际 ${JSON.stringify(actual)} / 期望 ${JSON.stringify(expected)}`);

const pool = createPool('smoke-famous-theme', 2);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const sql = async (text: string, params: unknown[] = []): Promise<pg.QueryResult> => pool.query(text, params);

interface State { city: Record<string, any>; cities: Array<Record<string, any>> }

async function state(client: Client, cityId?: string): Promise<State> {
  const res = await client.request(Op.GET_STATE, cityId ? { cityId } : {});
  if (!res.ok) throw new Error(`GET_STATE 失败：${JSON.stringify(res.error)}`);
  const data = dataOf(res);
  return { city: data.city as Record<string, any>, cities: (data.cities ?? []) as Array<Record<string, any>> };
}

/** 升级（可选连升）；返回整条响应帧 */
async function upgrade(client: Client, cityId: string, kind: string, toLevel?: number): Promise<Record<string, any>> {
  const res = await client.request(Op.UPGRADE, toLevel === undefined ? { cityId, kind } : { cityId, kind, toLevel });
  return res as unknown as Record<string, any>;
}

function errCode(res: Record<string, any>): string {
  return String((res.error as { code?: string } | undefined)?.code ?? '(无错误码)');
}

/** 等一次出征 + 返程走完（marches 里不再有该城的行军） */
async function waitMarchCycle(client: Client, cityId: string, timeoutMs = 180_000): Promise<void> {
  await sleep(1500); // 先让行军登记出行
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { city } = await state(client, cityId);
    if ((city.marches as unknown[]).length === 0) return;
    await sleep(1000);
  }
  throw new Error('等待行军结束超时');
}

/** 用城内现有全部兵力对目标打一轮：外围阶段（plunder 清外围）与城守阶段（occupy 占领） */
async function attackRound(client: Client, cityId: string, task: 'plunder' | 'occupy'): Promise<void> {
  const { city } = await state(client, cityId);
  const army = city.army as Record<string, number>;
  const troops: Record<string, number> = {};
  for (const [troop, count] of Object.entries(army)) {
    if (count > 0) troops[troop] = count;
  }
  const res = await client.request(Op.MARCH, { cityId, x: TARGET.x, y: TARGET.y, troops, task });
  if (!res.ok) throw new Error(`MARCH(${task}) 失败：${JSON.stringify(res.error)}`);
  await waitMarchCycle(client, cityId);
}

async function tile(client: Client, x: number, y: number): Promise<Record<string, any>> {
  const res = await client.request(Op.GET_TILE, { x, y });
  if (!res.ok) throw new Error(`GET_TILE 失败：${JSON.stringify(res.error)}`);
  return dataOf(res).tile as Record<string, any>;
}

/** 预置某城建筑等级（不存在则插入） */
async function seedLevel(cityId: string, kind: string, level: number): Promise<void> {
  await sql(
    `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, $2, $3)
     ON CONFLICT (city_id, kind) DO UPDATE SET level = $3`,
    [cityId, kind, level],
  );
}

/** 资源预置到仓储上限之上：产出停止累积，数值在测试期间保持稳定（便于校验返还额） */
async function seedRich(cityId: string): Promise<void> {
  await sql(`UPDATE cities SET gold=5e6, wood=5e6, food=5e6, stone=5e6, iron=5e6 WHERE id=$1`, [cityId]);
}

async function seedArmy(cityId: string): Promise<void> {
  const troops: Record<string, number> = { militia: 400, pikeman: 400, swordsman: 600, archer: 600, cavalry: 200 };
  for (const [troop, count] of Object.entries(troops)) {
    await sql(
      `INSERT INTO city_army (city_id, troop, count) VALUES ($1,$2,$3)
       ON CONFLICT (city_id, troop) DO UPDATE SET count = $3, updated_at = now()`,
      [cityId, troop, count],
    );
  }
}

/** 把城搬到目标附近的无主野地（世界格搬移，与 smoke-pvp-conquer.ts 同法） */
async function relocateCityNear(cityId: string, nearX: number, nearY: number): Promise<{ x: number; y: number }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const free = await client.query(
      `SELECT x, y FROM world_tiles WHERE kind='wilderness' AND owner_city_id IS NULL
         AND abs(x - $1) <= 3 AND abs(y - $2) <= 3 ORDER BY abs(x-$1)+abs(y-$2) LIMIT 1 FOR UPDATE`,
      [nearX, nearY],
    );
    const tileRes = await client.query(`SELECT x,y,terrain,kind,level,owner_city_id,npc FROM world_tiles WHERE owner_city_id=$1 FOR UPDATE`, [cityId]);
    const from = tileRes.rows[0] as Record<string, any>;
    const to = free.rows[0] as { x: number; y: number };
    await client.query(
      `UPDATE world_tiles SET terrain=$3, kind=$4, level=$5, owner_city_id=$6, npc=$7, plundered_at=NULL WHERE x=$1 AND y=$2`,
      [to.x, to.y, from.terrain, from.kind, from.level, from.owner_city_id, JSON.stringify(from.npc ?? null)],
    );
    await client.query(`UPDATE world_tiles SET terrain='plain', kind='wilderness', level=1, owner_city_id=NULL, npc=NULL WHERE x=$1 AND y=$2`, [from.x, from.y]);
    await client.query(`UPDATE cities SET x=$2, y=$3 WHERE id=$1`, [cityId, to.x, to.y]);
    await client.query('COMMIT');
    return to;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  console.log(`AISLG-167 黑盒验收 target: ${WS_URL}, account: ${user}`);
  await ensureSchema(pool);

  step('准备：建号 + 主城可攻下 Lv3 NPC 城的资格');
  await seedAccount(user, password);
  const player = await Client.connect();
  {
    const res = await player.request(Op.LOGIN, { username: user, password, asAgent: false, docVersion: 64 });
    if (!res.ok) throw new Error(`LOGIN 失败：${JSON.stringify(res.error)}`);
    const data = dataOf(res);
    accountId = String(data.accountId);
    verify('LOGIN 返回服务端协议版本 64', Number(data.protocolVersion) === 64, `protocolVersion=${data.protocolVersion}`);
    const acc = await sql(`SELECT id FROM accounts WHERE username=$1`, [user]);
    accountId = String((acc.rows[0] as { id: string }).id);
    const main = await sql(
      `SELECT c.id, c.x, c.y FROM cities c WHERE c.account_id=$1 ORDER BY c.created_at LIMIT 1`,
      [accountId],
    );
    mainCityId = String((main.rows[0] as { id: string }).id);
  }
  // 主城：官府 6（分城名额 3、可攻 Lv3 目标）、城墙 20（普通城上限基线）、校场 5、粮木石铁 20、城墙主题外建筑留一个 1 级做常规升级回归
  await seedLevel(mainCityId, 'government', 6);
  await seedLevel(mainCityId, 'wall', 20);
  await seedLevel(mainCityId, 'parade_ground', 5);
  await seedLevel(mainCityId, 'farm', 1);
  await seedRich(mainCityId);
  {
    const spot = await relocateCityNear(mainCityId, TARGET.x, TARGET.y);
    console.log(`  · 主城已搬到洛阳旁 (${spot.x}, ${spot.y})`);
  }
  await seedArmy(mainCityId);

  step('基线：普通城（主城）建筑上限仍是 20');
  {
    const { city } = await state(player, mainCityId);
    const levelMax = city.levelMax as Record<string, number>;
    verify('GET_STATE 下发 city.levelMax（v63 新字段）', levelMax !== undefined && levelMax !== null, `levelMax=${JSON.stringify(levelMax)}`);
    for (const kind of KINDS) {
      eq(`普通城 levelMax.${kind} = 20`, levelMax?.[kind], 20);
    }
    eq('普通城城墙 20 级：costs.wall.upgrade 为 null（已满级）', city.costs.wall.upgrade, null);
    eq('普通城城墙 20 级：costs.wall.upgradeSeconds 为 null', city.costs.wall.upgradeSeconds, null);
    eq('普通城城墙 20 级：defenseBonus = 70', city.defenseBonus, 70);
  }
  {
    const res = await upgrade(player, mainCityId, 'wall');
    verify('普通城城墙 20 → 21 被拒（BUILDING_LEVEL_MAX）', res.ok === false && errCode(res) === 'BUILDING_LEVEL_MAX', errCode(res));
  }
  {
    const res = await upgrade(player, mainCityId, 'wall', 21);
    verify('普通城城墙连升 toLevel=21 被拒（BUILDING_LEVEL_MAX）', res.ok === false && errCode(res) === 'BUILDING_LEVEL_MAX', errCode(res));
    const res2 = await upgrade(player, mainCityId, 'wall', 25);
    verify('普通城城墙连升 toLevel=25 被拒（BUILDING_LEVEL_MAX）', res2.ok === false && errCode(res2) === 'BUILDING_LEVEL_MAX', errCode(res2));
  }
  {
    const before = await state(player, mainCityId);
    const res = await upgrade(player, mainCityId, 'farm');
    verify('回归：普通建筑（农田 1 → 2）照常可升', res.ok === true, errCode(res));
    if (res.ok === true) {
      await sleep(4000);
      const after = await state(player, mainCityId);
      eq('农田升到 2 级', (after.city.levels as Record<string, number>).farm, 2);
      verify('普通建筑升满 20 级前的成本字段仍在（farm 2 级 → upgrade 非 null）', after.city.costs.farm.upgrade !== null, `before.farm=${(before.city.levels as Record<string, number>).farm}`);
    }
  }

  step('端到端：两阶段打下洛阳，成为名城分城');
  {
    const t = await tile(player, TARGET.x, TARGET.y);
    verify('洛阳地块 kind = npc_city', t.kind === 'npc_city', `kind=${t.kind}`);
    verify('洛阳 famous.name = 洛阳', (t.famous as Record<string, any>)?.name === '洛阳', JSON.stringify(t.famous ?? null));
    eq('洛阳 famous.stage = outer（先清外围）', (t.famous as Record<string, any>)?.stage, 'outer');
    if (SKIP_CONQUER) {
      console.log('  · --skip-conquer：跳过攻城');
    } else {
      await attackRound(player, mainCityId, 'plunder');
      const afterOuter = await tile(player, TARGET.x, TARGET.y);
      eq('清外围后 famous.stage = keeper', (afterOuter.famous as Record<string, any>)?.stage, 'keeper');
      await attackRound(player, mainCityId, 'occupy');
      const afterKeeper = await tile(player, TARGET.x, TARGET.y);
      verify('占领后地块归本账号', (afterKeeper.owner as Record<string, any>)?.accountId === accountId, JSON.stringify(afterKeeper.owner ?? null));
    }
    const { cities } = await state(player, mainCityId);
    const ly = cities.find((c) => c.name === '洛阳');
    verify('cities[] 出现名城分城「洛阳」', ly !== undefined, JSON.stringify(cities.map((c) => c.name)));
    if (!ly) throw new Error('没有拿到洛阳分城，后续无法继续');
    famousCityId = String(ly.id);
  }

  step('洛阳：主题建筑（城墙）上限 25，其他建筑仍 20');
  {
    const { city } = await state(player, famousCityId);
    eq('city.famousName = 洛阳', city.famousName, '洛阳');
    const levelMax = city.levelMax as Record<string, number>;
    eq('levelMax.wall = 25', levelMax.wall, 25);
    for (const kind of KINDS) {
      if (kind === 'wall') continue;
      eq(`洛阳非主题建筑 levelMax.${kind} = 20`, levelMax[kind], 20);
    }
    eq('洛阳城墙继承 NPC 等级 3（可继续升）', (city.levels as Record<string, number>).wall, 3);
    verify('洛阳城墙 3 级时 costs.wall.upgrade 非 null', city.costs.wall.upgrade !== null, JSON.stringify(city.costs.wall));
    eq('洛阳城墙 3 级时 defenseBonus = 15 + 名城 5 = 20', city.defenseBonus, 20);
  }

  step('城墙 21~25 级：单级增益 +1（defenseBonus 口径）');
  for (const level of [20, 21, 22, 23, 24, 25]) {
    await seedLevel(famousCityId, 'wall', level);
    const { city } = await state(player, famousCityId);
    const expected = 50 + 20 + Math.max(0, level - 20) + 5; // 前 10 级 ×5、11~20 级 ×2、21~25 级 ×1，再叠洛阳 +5
    eq(`城墙 ${level} 级 → defenseBonus ${expected}`, city.defenseBonus, expected);
  }

  step('洛阳城墙：上限判定与连升计划（含成本 / 耗时曲线延伸到 25）');
  await seedLevel(famousCityId, 'wall', 20);
  await seedLevel(famousCityId, 'quarry', 19); // 占住队首，让连升条目进入排队以便校验后取消
  await seedRich(famousCityId);
  {
    const { city } = await state(player, famousCityId);
    eq('洛阳城墙 20 级：levelMax.wall 仍 25', (city.levelMax as Record<string, number>).wall, 25);
    verify('洛阳城墙 20 级：costs.wall.upgrade 非 null（普通城此处为 null）', city.costs.wall.upgrade !== null, JSON.stringify(city.costs.wall));
    verify('洛阳城墙 20 级：costs.wall.upgradeSeconds > 0', Number(city.costs.wall.upgradeSeconds) > 0, `upgradeSeconds=${city.costs.wall.upgradeSeconds}`);
  }
  {
    const res = await upgrade(player, famousCityId, 'wall', 26);
    verify('洛阳城墙连升 toLevel=26 被拒（超上限 25）', res.ok === false && errCode(res) === 'BUILDING_LEVEL_MAX', errCode(res));
  }
  let chainBuildId = '';
  // 资源预置在仓储上限之上 → 产出停止累积，金 / 木 / 石 / 铁在测试期间恒定（粮会被军队吃掉，不参与等值比较）
  const pre = await state(player, famousCityId);
  const beforeResources = pre.city.resources as Record<string, number>;
  const quarryCost = pre.city.costs.quarry.upgrade as Record<string, number>;
  verify('洛阳采石场 19 级：costs.quarry.upgrade 非 null（下一步成本可展示）', quarryCost !== null, JSON.stringify(quarryCost));
  {
    const active = await upgrade(player, famousCityId, 'quarry');
    verify('洛阳采石场 19 → 20 可升（非主题建筑上限仍是 20）', active.ok === true, errCode(active));
    const res = await upgrade(player, famousCityId, 'wall', 25);
    const data = (res.data ?? {}) as Record<string, any>;
    const chain = (data.chain ?? []) as Array<{ level: number; cost: Record<string, number>; seconds: number }>;
    verify('洛阳城墙连升 toLevel=25 被接受', res.ok === true, errCode(res));
    eq('连升链覆盖 21..25 共 5 级', chain.map((c) => c.level), [21, 22, 23, 24, 25]);
    eq('响应 build.level = 首个推进等级 21', (data.build as Record<string, any>)?.level, 21);
    eq('响应 build.toLevel = 25', (data.build as Record<string, any>)?.toLevel, 25);
    eq('整链只占 1 个队列位（队首为采石场在建，其后 1 条城墙）', ((await state(player, famousCityId)).city.queue as unknown[]).length, 2);
    // 成本与耗时：倍数 = 9 × 1.3^(L−9)，逐级递增且相邻比值 ≈ 1.3；BUILD_SECONDS=1 时秒数即倍数
    const secs = chain.map((c) => c.seconds);
    const ratios = secs.slice(1).map((s, i) => s / secs[i]);
    verify('各级成本随等级递增', chain.every((c, i) => i === 0 || c.cost.gold > chain[i - 1].cost.gold), chain.map((c) => c.cost.gold).join(' < '));
    verify('各级耗时随等级递增（25 级耗时最长）', secs.every((s, i) => i === 0 || s > secs[i - 1]), secs.join(' < '));
    verify('相邻级耗时比 ≈ 1.3（成本曲线 1.3 倍延伸口径）', ratios.every((r) => Math.abs(r - 1.3) < 0.02), ratios.map((r) => r.toFixed(3)).join(', '));
    verify('24 → 25 单级耗时明显更长（> 20 → 21 的 2 倍）', secs[4] > secs[0] * 2, `${secs[4]}s vs ${secs[0]}s`);
    console.log(`  · 整链成本 gold 合计 ${chain.reduce((sum, c) => sum + c.cost.gold, 0)}、耗时合计 ${secs.reduce((sum, s) => sum + s, 0)}s`);
    chainBuildId = String((data.build as Record<string, any>)?.id);
  }
  {
    const charged = (await state(player, famousCityId)).city.resources as Record<string, number>;
    const res = await player.request(Op.CANCEL_BUILD, { buildId: chainBuildId });
    verify('取消排队的连升条目（CANCEL_BUILD）成功', res.ok === true, errCode(res as unknown as Record<string, any>));
    const after = (await state(player, famousCityId)).city.resources as Record<string, number>;
    verify(
      '发起时按整链一次性预扣（发起后金币 < 取消后金币）',
      charged.gold < after.gold,
      `${beforeResources.gold} →（发起）${charged.gold} →（取消）${after.gold}`,
    );
    eq('取消后按快照全额返还：余额回到「只扣掉采石场那一级」', after.gold, beforeResources.gold - quarryCost.gold);
    eq('取消后木材同样只剩采石场那级', after.wood, beforeResources.wood - quarryCost.wood);
    eq('取消后队列只剩采石场在建', ((await state(player, famousCityId)).city.queue as unknown[]).length, 1);
  }

  step('实际升到 25 级（真实完工链路）');
  if (NO_WAIT) {
    console.log('  · --no-wait：跳过完工等待');
  } else {
    await seedLevel(famousCityId, 'wall', 24);
    await seedRich(famousCityId);
    // 等采石场那条在建清空，避免占用队首
    for (let i = 0; i < 60; i += 1) {
      const { city } = await state(player, famousCityId);
      if ((city.queue as unknown[]).length === 0) break;
      await sleep(2000);
    }
    const res = await upgrade(player, famousCityId, 'wall');
    verify('洛阳城墙 24 → 25 发起成功（未超上限）', res.ok === true, errCode(res));
    const due = (res.data as Record<string, any>)?.build as Record<string, any> | undefined;
    console.log(`  · 24 → 25 预计完成 ${String(due?.dueAt)}（BUILD_SECONDS=1 下约 461 秒）`);
    const waitMs = Number(process.env.FAMOUS_THEME_WAIT_MS ?? 520_000);
    const deadline = Date.now() + waitMs;
    let level = 0;
    while (Date.now() < deadline) {
      const { city } = await state(player, famousCityId);
      level = (city.levels as Record<string, number>).wall;
      if (level >= 25) break;
      await sleep(5000);
    }
    eq('等待完工：城墙等级 = 25', level, 25);
    const { city } = await state(player, famousCityId);
    eq('25 级后 costs.wall.upgrade 为 null（已到上限）', city.costs.wall.upgrade, null);
    eq('25 级后 defenseBonus = 75 + 5 = 80', city.defenseBonus, 80);
    const res2 = await upgrade(player, famousCityId, 'wall');
    verify('25 级后再升被拒（BUILDING_LEVEL_MAX）', res2.ok === false && errCode(res2) === 'BUILDING_LEVEL_MAX', errCode(res2));
    const res3 = await upgrade(player, famousCityId, 'wall', 26);
    verify('25 级后连升 toLevel=26 被拒', res3.ok === false && errCode(res3) === 'BUILDING_LEVEL_MAX', errCode(res3));
  }

  step('八座名城 → 主题建筑对应表（按协议 levelMax 逐座验证）');
  {
    const currentName = (await state(player, famousCityId)).city.famousName;
    for (const [name, theme] of Object.entries(THEME_OF)) {
      await sql(`UPDATE cities SET famous_name=$2 WHERE id=$1`, [famousCityId, name]);
      const { city } = await state(player, famousCityId);
      const levelMax = city.levelMax as Record<string, number>;
      eq(`${name}：levelMax.${theme} = 25`, levelMax[theme], 25);
      const others = KINDS.filter((k) => k !== theme);
      verify(`${name}：其余 ${others.length} 种建筑仍为 20`, others.every((k) => levelMax[k] === 20), others.filter((k) => levelMax[k] !== 20).join(',') || '全部 20');
    }
    await sql(`UPDATE cities SET famous_name=$2 WHERE id=$1`, [famousCityId, currentName]);
    console.log(`  · 名城标记已复原为 ${currentName}`);
  }

  step('失守（名城标记换主）：等级、上限与效果的实际口径');
  {
    await seedLevel(famousCityId, 'wall', 25);
    await sql(`UPDATE cities SET famous_name=NULL WHERE id=$1`, [famousCityId]);
    const { city } = await state(player, famousCityId);
    eq('失守后 famousName 为 null', city.famousName, null);
    eq('失守后 levelMax.wall 回到 20', (city.levelMax as Record<string, number>).wall, 20);
    // 口径（AISLG-167 第二轮，产品拍板 A）：展示与效果按当前上限 20 封顶；库存等级保留，重新占领即恢复
    eq('失守后展示等级按上限封顶（wall = 20）', (city.levels as Record<string, number>).wall, 20);
    const stored = (await sql(`SELECT level FROM city_buildings WHERE city_id = $1 AND kind = 'wall'`, [famousCityId])).rows[0];
    eq('失守后库存等级保留（city_buildings.wall = 25）', stored?.level, 25);
    verify('失守后不能再升（costs.wall.upgrade = null）', city.costs.wall.upgrade === null, JSON.stringify(city.costs.wall));
    const res = await upgrade(player, famousCityId, 'wall');
    verify('失守后再升被拒（BUILDING_LEVEL_MAX）', res.ok === false && errCode(res) === 'BUILDING_LEVEL_MAX', errCode(res));
    eq('失守后 defenseBonus 按 20 级封顶（70）', city.defenseBonus, 70);
    await sql(`UPDATE cities SET famous_name=$2 WHERE id=$1`, [famousCityId, '洛阳']);
    const back = (await state(player, famousCityId)).city;
    eq('重新占领洛阳后展示等级恢复（wall = 25）', (back.levels as Record<string, number>).wall, 25);
    eq('重新占领洛阳后 levelMax.wall = 25', (back.levelMax as Record<string, number>).wall, 25);
  }

  step('名城专属兵（v64，AISLG-168）：只能在占领对应名城的分城征募，失守即失去资格');
  {
    // 洛阳分城（上一步已恢复为名城）：军营 7 级 + 资源，可征羽林卫
    await seedLevel(famousCityId, 'barracks', 7);
    await seedRich(famousCityId);
    await seedLevel(mainCityId, 'barracks', 7);
    const inFamous = await player.request(Op.RECRUIT, { troop: 'yulin_guard', count: 1, cityId: famousCityId });
    verify('洛阳分城（占领中）可征募羽林卫', inFamous.ok === true, errCode(inFamous));
    // 主城非名城：军营够，仍被专属锁拒绝（专属锁先于军营门槛判定）
    const inMain = await player.request(Op.RECRUIT, { troop: 'yulin_guard', count: 1, cityId: mainCityId });
    eq('主城（非名城）征募羽林卫被拒', errCode(inMain), 'ELITE_TROOP_LOCKED');
    // 普通兵不受影响
    const porter = await player.request(Op.RECRUIT, { troop: 'porter', count: 1, cityId: mainCityId });
    verify('主城征募普通民夫不受专属锁影响', porter.ok === true, errCode(porter));
    // 失守：标记撤下后，原分城同样拒绝
    await sql(`UPDATE cities SET famous_name=NULL WHERE id=$1`, [famousCityId]);
    const lost = await player.request(Op.RECRUIT, { troop: 'yulin_guard', count: 1, cityId: famousCityId });
    eq('失守后原分城征募羽林卫被拒', errCode(lost), 'ELITE_TROOP_LOCKED');
    await sql(`UPDATE cities SET famous_name=$2 WHERE id=$1`, [famousCityId, '洛阳']);
    // 同一专属兵换到别的名城分城也不行：主城改标为建业 → 只能征建业丹阳兵，不能征羽林卫
    await sql(`UPDATE cities SET famous_name=$2 WHERE id=$1`, [mainCityId, '建业']);
    const wrongCity = await player.request(Op.RECRUIT, { troop: 'yulin_guard', count: 1, cityId: mainCityId });
    eq('建业分城征募羽林卫被拒（只认对应名城）', errCode(wrongCity), 'ELITE_TROOP_LOCKED');
    const rightCity = await player.request(Op.RECRUIT, { troop: 'danyang_soldier', count: 1, cityId: mainCityId });
    verify('建业分城可征丹阳兵', rightCity.ok === true, errCode(rightCity));
    await sql(`UPDATE cities SET famous_name=NULL WHERE id=$1`, [mainCityId]);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== AISLG-167 黑盒验收汇总（${stepTotal()} 步，${results.length} 条断言）=====`);
  console.log(`通过 ${results.length - failed.length} / 失败 ${failed.length}`);
  for (const f of failed) console.log(`  ✗ ${f.label} —— ${f.detail}`);
  player.close();
}

main()
  .catch((err) => {
    console.error('\n执行中断：', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
  });