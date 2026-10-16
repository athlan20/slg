// AISLG-168 黑盒验收（协议 v64）：名城专属兵种。
// 断言全部走 docs/agent-api.md 的协议（WebSocket）；数据库只用于造状态——建号、把主城挪到
// 名城旁、预置官府 / 校场 / 军营 / 人口 / 资源 / 兵力、以及模拟「名城标记」的切换，与
// smoke-pvp-conquer.ts 同口径。打下洛阳 / 建业、以及 B 三击夺走洛阳都是端到端真实流程。
//
// 运行（api 与 worker 已以 v64 代码启动；建议 BUILD_SECONDS=1 MARCH_SECONDS_PER_TILE=1 RECRUIT_UNIT_SECONDS=1）：
//   npx tsx --env-file=.env scripts/smoke-famous-elite.ts
// 可选项：--skip-conquer 跳过攻城；--skip-owner-change 跳过换主（三击）段。

import pg from 'pg';
import { Op } from '../common/src/protocol';
import { createPool, ensureSchema } from '../common/src/db';
import { Client, dataOf, step, stepTotal } from './smoke-client';
import { seedAccount } from './smoke-account';
import { errCode, march, marchAll, marchSettle, recruit, sleep, state, tile, waitArmy, waitArmyPlus, waitUntil } from './smoke-elite-utils';
import { runEliteMatrix, type EliteDef } from './smoke-elite-matrix';

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8080/ws';
const LUOYANG = { x: 841, y: 155 };
const JIANYE = { x: 150, y: 845 };
const GUANDU = { x: 162, y: 168 }; // 保持 NPC 状态，用于核对守军兵种
const SKIP_CONQUER = process.argv.includes('--skip-conquer');
const SKIP_OWNER_CHANGE = process.argv.includes('--skip-owner-change');

/** 名城 → 专属兵（协议 RECRUIT summary / famous-effects.ts 的 FAMOUS_ELITE_TROOP） */
const ELITE_OF: Record<string, EliteDef> = {
  洛阳: { troop: 'yulin_guard', base: 'swordsman', barracks: 7 },
  建业: { troop: 'danyang_soldier', base: 'swordsman', barracks: 7 },
  襄阳: { troop: 'baimao_soldier', base: 'pikeman', barracks: 6 },
  许昌: { troop: 'huwei_guard', base: 'pikeman', barracks: 6 },
  成都: { troop: 'zhuge_crossbow', base: 'archer', barracks: 8 },
  邺城: { troop: 'xiandeng_warrior', base: 'archer', barracks: 8 },
  官渡: { troop: 'hubao_cavalry', base: 'cavalry', barracks: 9 },
  长安: { troop: 'xiliang_cavalry', base: 'cavalry', barracks: 9 },
};
const ELITE_TROOPS = Object.values(ELITE_OF).map((e) => e.troop);

const password = 'smoke-pass-123';
const suffix = Date.now();
const pool = createPool('smoke-famous-elite', 3);
const results: Array<{ label: string; ok: boolean; detail: string }> = [];

function verify(label: string, ok: boolean, detail = ''): void {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` —— ${detail}` : ''}`);
}
const eq = (label: string, actual: unknown, expected: unknown): void =>
  verify(label, JSON.stringify(actual) === JSON.stringify(expected), `实际 ${JSON.stringify(actual)} / 期望 ${JSON.stringify(expected)}`);
const sql = async (text: string, params: unknown[] = []): Promise<pg.QueryResult> => pool.query(text, params);


async function seedLevel(cityId: string, kind: string, level: number): Promise<void> {
  await sql(
    `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1,$2,$3)
     ON CONFLICT (city_id, kind) DO UPDATE SET level = $3`,
    [cityId, kind, level],
  );
}

/** 资源预置到仓储上限之上：产出停止累积，金 / 木 / 石 / 铁在测试期间恒定 */
async function seedRich(cityId: string, amount = 5e6): Promise<void> {
  await sql(`UPDATE cities SET gold=$2, wood=$2, food=$2, stone=$2, iron=$2, population=2000 WHERE id=$1`, [cityId, amount]);
}

async function seedArmy(cityId: string, troops: Record<string, number>): Promise<void> {
  for (const [troop, count] of Object.entries(troops)) {
    await sql(
      `INSERT INTO city_army (city_id, troop, count) VALUES ($1,$2,$3)
       ON CONFLICT (city_id, troop) DO UPDATE SET count = $3, updated_at = now()`,
      [cityId, troop, count],
    );
  }
}

async function relocateCityNear(cityId: string, nearX: number, nearY: number): Promise<{ x: number; y: number }> {
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const free = await conn.query(
      `SELECT x, y FROM world_tiles WHERE kind='wilderness' AND owner_city_id IS NULL
         AND abs(x - $1) <= 3 AND abs(y - $2) <= 3 ORDER BY abs(x-$1)+abs(y-$2) LIMIT 1 FOR UPDATE`,
      [nearX, nearY],
    );
    const from = (await conn.query(`SELECT x,y,terrain,kind,level,owner_city_id,npc FROM world_tiles WHERE owner_city_id=$1 FOR UPDATE`, [cityId])).rows[0] as Record<string, any>;
    const to = free.rows[0] as { x: number; y: number };
    await conn.query(
      `UPDATE world_tiles SET terrain=$3, kind=$4, level=$5, owner_city_id=$6, npc=$7, plundered_at=NULL WHERE x=$1 AND y=$2`,
      [to.x, to.y, from.terrain, from.kind, from.level, from.owner_city_id, JSON.stringify(from.npc ?? null)],
    );
    await conn.query(`UPDATE world_tiles SET terrain='plain', kind='wilderness', level=1, owner_city_id=NULL, npc=NULL WHERE x=$1 AND y=$2`, [from.x, from.y]);
    await conn.query(`UPDATE cities SET x=$2, y=$3 WHERE id=$1`, [cityId, to.x, to.y]);
    await conn.query('COMMIT');
    return to;
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}


/**
 * 收尾复原（AISLG-168 测试会把洛阳 / 建业从 NPC 城占成自己的分城，跑完要还回去，
 * 否则同一个库再跑一次就没有可打的名城）：删掉本次打下的分城，并把那两块地块按
 * 未被本次使用的 Lv3 名城（长安）的快照写回 NPC 名城状态。
 */
async function restoreFamousTiles(): Promise<void> {
  const places: Array<{ x: number; y: number; name: string }> = [
    { ...LUOYANG, name: '洛阳' },
    { ...JIANYE, name: '建业' },
  ];
  for (const place of places) {
    await sql(`DELETE FROM cities WHERE x=$1 AND y=$2`, [place.x, place.y]);
    await sql(
      `UPDATE world_tiles t SET terrain=src.terrain, kind='npc_city', level=src.level, owner_city_id=NULL,
         npc = jsonb_set(src.npc, '{famous,name}', to_jsonb($3::text)), plundered_at=NULL, owner_changed_until=NULL
       FROM (SELECT terrain, level, npc FROM world_tiles WHERE x=163 AND y=501) src
       WHERE t.x=$1 AND t.y=$2`,
      [place.x, place.y, place.name],
    );
  }
  console.log('  · 收尾：洛阳 / 建业 已复原为 NPC 名城');
}

async function main(): Promise<void> {
  console.log(`AISLG-168 黑盒验收 target: ${WS_URL}`);
  await ensureSchema(pool);

  step('准备：两个账号（A 占名城、B 夺名城）、主城可攻 Lv3 NPC 名城的资格');
  const userA = `f168a_${suffix}`;
  const userB = `f168b_${suffix}`;
  const playerA = await Client.connect();
  const playerB = await Client.connect();
  let mainA = '';
  let luoyang = '';
  try {
    await seedAccount(userA, password);
    await seedAccount(userB, password);
    const loginA = await playerA.request(Op.LOGIN, { username: userA, password, asAgent: false, docVersion: 64 });
    const loginB = await playerB.request(Op.LOGIN, { username: userB, password, asAgent: false, docVersion: 64 });
    if (!loginA.ok || !loginB.ok) throw new Error(`LOGIN 失败：${JSON.stringify(loginA.error ?? loginB.error)}`);
    verify('LOGIN 返回服务端协议版本 64', Number(dataOf(loginA).protocolVersion) === 64, `protocolVersion=${dataOf(loginA).protocolVersion}`);
    const accA = String((await sql(`SELECT id FROM accounts WHERE username=$1`, [userA])).rows[0].id);
    const accB = String((await sql(`SELECT id FROM accounts WHERE username=$1`, [userB])).rows[0].id);
    mainA = String((await state(playerA)).cities[0].id);
    const mainB = String((await state(playerB)).cities[0].id);
    console.log(`  · A=${userA} 主城 ${mainA.slice(0, 8)}；B=${userB} 主城 ${mainB.slice(0, 8)}`);
    // A：官府 6（分城名额 3、可攻 Lv3）、军营 9、校场 5、人口 / 资源充足；给的攻城兵力只用于打名城
    await seedLevel(mainA, 'government', 6);
    await seedLevel(mainA, 'barracks', 9);
    await seedLevel(mainA, 'parade_ground', 5);
    await seedRich(mainA);
    await seedArmy(mainA, { militia: 300, swordsman: 500, archer: 500, cavalry: 200 });
    // B：同资格，兵力更大（要连赢三场夺走洛阳）
    await sql(`UPDATE accounts SET newbie_until = NULL WHERE id IN ($1, $2)`, [accA, accB]);
    await seedLevel(mainB, 'government', 6);
    await seedLevel(mainB, 'barracks', 9);
    await seedLevel(mainB, 'parade_ground', 5);
    await seedRich(mainB);
    await seedArmy(mainB, { militia: 500, swordsman: 4000, archer: 4000, cavalry: 1500 });
    await relocateCityNear(mainA, LUOYANG.x, LUOYANG.y);

    step('1. 驻军视图：city.army 已有 8 种专属兵键');
    {
      const army = (await state(playerA, mainA)).city.army as Record<string, number>;
      const missing = ELITE_TROOPS.filter((troop) => army[troop] === undefined);
      verify('city.army 含全部 8 种专属兵键', missing.length === 0, missing.length ? `缺失 ${missing.join(',')}` : ELITE_TROOPS.join(','));
      eq('专属兵初始为 0', ELITE_TROOPS.map((troop) => army[troop]), ELITE_TROOPS.map(() => 0));
    }

    step('2. 非名城城：专属兵一律被拒（军营够高也一样）');
    {
      const beforeRes = (await state(playerA, mainA)).city.resources as Record<string, number>;
      for (const troop of ['yulin_guard', 'danyang_soldier', 'hubao_cavalry']) {
        const res = await recruit(playerA, mainA, troop, 1);
        verify(`主城（军营 9）征募 ${troop} 返回 ELITE_TROOP_LOCKED`, res.ok === false && errCode(res) === 'ELITE_TROOP_LOCKED', errCode(res));
      }
      const afterRes = (await state(playerA, mainA)).city.resources as Record<string, number>;
      eq('被拒的几次均未扣资源 / 人口', [afterRes.gold, afterRes.wood], [beforeRes.gold, beforeRes.wood]);
      const res2 = await recruit(playerA, mainA, 'swordsman', 1);
      verify('对照：主城征募普通兵种（刀盾兵）成功', res2.ok === true, errCode(res2));
      if (res2.ok === true) {
        await waitArmy(playerA, mainA, 'swordsman', 501);
        verify('普通兵种在主城照常入城（主城 501 刀盾兵）', true, '刀盾兵 501');
      }
    }

    step('3. 占下洛阳（外围 plunder → 城守 occupy）');
    {
      if (SKIP_CONQUER) {
        console.log('  · --skip-conquer：跳过攻城');
      } else {
        const before = await tile(playerA, LUOYANG.x, LUOYANG.y);
        eq('攻前 fame.stage = outer', (before.famous as Record<string, any>)?.stage, 'outer');
        await marchAll(playerA, mainA, LUOYANG.x, LUOYANG.y, 'plunder');
        eq('清外围后 stage = keeper', ((await tile(playerA, LUOYANG.x, LUOYANG.y)).famous as Record<string, any>)?.stage, 'keeper');
        await marchAll(playerA, mainA, LUOYANG.x, LUOYANG.y, 'occupy');
      }
      const cities = (await state(playerA, mainA)).cities;
      const ly = cities.find((c) => c.name === '洛阳');
      verify('cities[] 出现「洛阳」分城', ly !== undefined, JSON.stringify(cities.map((c) => c.name)));
      if (!ly) throw new Error('没有拿到洛阳分城');
      luoyang = String(ly.id);
      await seedLevel(luoyang, 'barracks', 7);
      await seedRich(luoyang);
      eq('洛阳 barracks = 7（羽林卫门槛）', (await state(playerA, luoyang)).city.levels.barracks, 7);
    }

    step('4. 洛阳征募羽林卫：成本 / 人口 / 耗时 / 耗粮口径');
    let baseCost: Record<string, number> = {};
    let eliteCost: Record<string, number> = {};
    {
      // 对照：同一座城的刀盾兵（普通重步兵）
      const beforeBase = (await state(playerA, luoyang)).city;
      const swordsBefore = Number(beforeBase.army.swordsman ?? 0);
      const baseRes = await recruit(playerA, luoyang, 'swordsman', 1);
      verify('洛阳征募刀盾兵（对照）成功', baseRes.ok === true, errCode(baseRes));
      const afterBase = (await state(playerA, luoyang)).city;
      for (const key of ['gold', 'wood', 'food', 'stone', 'iron']) {
        baseCost[key] = Number(beforeBase.resources[key]) - Number(afterBase.resources[key]);
      }
      await waitArmyPlus(playerA, luoyang, 'swordsman', swordsBefore, 1);
      const baseFoodUse = Number((await state(playerA, luoyang)).city.armyFoodUsePerHour) - Number(beforeBase.armyFoodUsePerHour);
      console.log(`  · 刀盾兵：成本 ${JSON.stringify(baseCost)}，耗粮 +${baseFoodUse}/h`);

      const beforeElite = (await state(playerA, luoyang)).city;
      const eliteBefore = Number(beforeElite.army.yulin_guard ?? 0);
      const requestedAt = Date.now();
      const res = await recruit(playerA, luoyang, 'yulin_guard', 10);
      verify('洛阳（名城本城）征募羽林卫 ×10 成功', res.ok === true, errCode(res));
      const afterElite = (await state(playerA, luoyang)).city;
      for (const key of ['gold', 'wood', 'food', 'stone', 'iron']) {
        eliteCost[key] = Number(beforeElite.resources[key]) - Number(afterElite.resources[key]);
      }
      const popSpent = Number(beforeElite.population.current) - Number(afterElite.population.current);
      const due = (res.data as Record<string, any>)?.recruit as Record<string, any> | undefined;
      const dueSeconds = due?.dueAt ? (Date.parse(String(due.dueAt)) - requestedAt) / 1000 : null;
      eq('征募 10 名，人口各占 2（共 20）', popSpent, 20);
      eq('成本 = 刀盾兵 × 2 × 10（金木石铁）', ['gold', 'wood', 'stone', 'iron'].map((k) => eliteCost[k]), ['gold', 'wood', 'stone', 'iron'].map((k) => baseCost[k] * 20));
      verify('成本（粮）同样 × 2 × 10，容 ±2 结算噪声', Math.abs(eliteCost.food - baseCost.food * 20) <= 2, `${eliteCost.food} vs ${baseCost.food * 20}`);
      verify('批次耗时 = 单兵 × 数量（RECRUIT_UNIT_SECONDS=1 下 10 秒）', dueSeconds !== null && Math.abs(dueSeconds - 10) <= 2, `dueAt-发起=${dueSeconds}s`);
      const got = await waitArmyPlus(playerA, luoyang, 'yulin_guard', eliteBefore, 10);
      const after = (await state(playerA, luoyang)).city;
      const eliteFoodUse = Number(after.armyFoodUsePerHour) - Number(beforeElite.armyFoodUsePerHour);
      verify('羽林卫入城（army.yulin_guard 达到 10）', got >= 10, `实际 ${got}`);
      eq('全军耗粮增量 = 单兵 9 × 10（刀盾兵 6 的 1.5 倍）', eliteFoodUse, 90);
    }

    step('5. 军营门槛：名城本城但军营不够 → TROOP_NOT_AVAILABLE');
    {
      await seedLevel(luoyang, 'barracks', 6);
      const res = await recruit(playerA, luoyang, 'yulin_guard', 1);
      verify('洛阳军营 6（< 羽林卫 7）→ TROOP_NOT_AVAILABLE', res.ok === false && errCode(res) === 'TROOP_NOT_AVAILABLE', errCode(res));
      const good = await recruit(playerA, luoyang, 'baimao_soldier', 1);
      verify('洛阳军营 6 征募白毦兵（门槛 6）→ 因不是襄阳而 ELITE_TROOP_LOCKED', good.ok === false && errCode(good) === 'ELITE_TROOP_LOCKED', errCode(good));
      await seedLevel(luoyang, 'barracks', 7);
    }

    step('6. 别的名城的专属兵：跨名城一律被拒');
    {
      for (const troop of ['danyang_soldier', 'hubao_cavalry', 'zhuge_crossbow']) {
        const res = await recruit(playerA, luoyang, troop, 1);
        verify(`洛阳征募 ${troop} → ELITE_TROOP_LOCKED`, res.ok === false && errCode(res) === 'ELITE_TROOP_LOCKED', errCode(res));
      }
    }

    step('7. 调兵：羽林卫从洛阳送回主城（换主前的存量）');
    {
      const mainTile = (await state(playerA, mainA)).cities.find((c) => c.id === mainA) as Record<string, any>;
      const res = (await playerA.request(Op.MARCH, { cityId: luoyang, x: Number(mainTile.x), y: Number(mainTile.y), troops: { yulin_guard: 6 } })) as unknown as Record<string, any>;
      verify('从洛阳调兵 6 名羽林卫到主城（目标为本账号城池）', res.ok === true, errCode(res));
      await marchSettle(playerA, luoyang);
      const mainArmy = (await state(playerA, mainA)).city.army as Record<string, number>;
      eq('主城驻军出现羽林卫 6', mainArmy.yulin_guard, 6);
      eq('洛阳剩 4', ((await state(playerA, luoyang)).city.army as Record<string, number>).yulin_guard, 4);
    }

    step('8. 占下建业：本城可征丹阳兵，跨名城被拒');
    {
      if (!SKIP_CONQUER) {
        const main = await state(playerA, mainA);
        console.log(`  · 主城迁到建业旁（原 ${main.cities.find((c) => c.id === mainA)?.x},${main.cities.find((c) => c.id === mainA)?.y}）`);
        await relocateCityNear(mainA, JIANYE.x, JIANYE.y);
        await seedArmy(mainA, { militia: 300, swordsman: 500, archer: 500, cavalry: 200 });
        await marchAll(playerA, mainA, JIANYE.x, JIANYE.y, 'plunder', ELITE_TROOPS);
        await marchAll(playerA, mainA, JIANYE.x, JIANYE.y, 'occupy', ELITE_TROOPS);
      }
      const jy = (await state(playerA, mainA)).cities.find((c) => c.name === '建业');
      verify('cities[] 出现「建业」分城', jy !== undefined, JSON.stringify((await state(playerA, mainA)).cities.map((c) => c.name)));
      if (!jy) throw new Error('没有拿到建业分城');
      const jianye = String(jy.id);
      await seedLevel(jianye, 'barracks', 7);
      await seedRich(jianye);
      const ok = await recruit(playerA, jianye, 'danyang_soldier', 4);
      verify('建业征募丹阳兵 ×4 成功', ok.ok === true, errCode(ok));
      if (ok.ok) await waitArmy(playerA, jianye, 'danyang_soldier', 4);
      const cross = await recruit(playerA, jianye, 'yulin_guard', 1);
      verify('建业征募羽林卫 → ELITE_TROOP_LOCKED', cross.ok === false && errCode(cross) === 'ELITE_TROOP_LOCKED', errCode(cross));
      const cross2 = await recruit(playerA, luoyang, 'danyang_soldier', 1);
      verify('洛阳征募丹阳兵 → ELITE_TROOP_LOCKED', cross2.ok === false && errCode(cross2) === 'ELITE_TROOP_LOCKED', errCode(cross2));
      // 留一个可复用的名人城 id
      (globalThis as Record<string, unknown>).jianyeId = jianye;
    }

    step('9. 专属兵可编队 / 出征 / 驻守 / 召回，战报带兵种');
    const jianyeId = String((globalThis as Record<string, unknown>).jianyeId);
    {
      // 找一块无主野地，用主城的羽林卫占领
      const win = await playerA.request(Op.GET_WORLD_MAP, {});
      const tiles = (dataOf(win).tiles ?? []) as Array<{ x: number; y: number; kind: string; level: number; owner: unknown }>;
      const target = tiles.find((t) => t.kind === 'wilderness' && t.owner === null && t.level === 1);
      verify('主城周边找到无主野地', target !== undefined, JSON.stringify(target ?? null));
      if (target) {
        const res = (await playerA.request(Op.MARCH, { cityId: mainA, x: target.x, y: target.y, troops: { yulin_guard: 6 }, task: 'occupy' })) as unknown as Record<string, any>;
        verify('羽林卫 6 名出征占领野地受理', res.ok === true, errCode(res));
        await marchSettle(playerA, mainA);
        const t = await tile(playerA, target.x, target.y);
        verify('野地归本账号（专属兵战斗成立）', (t.owner as Record<string, any>)?.accountId !== undefined || t.garrison > 0, `owner=${JSON.stringify(t.owner ?? null)} garrison=${t.garrison}`);
        const territory = ((await state(playerA, mainA)).city.territory ?? []) as Array<Record<string, any>>;
        const held = territory.find((x) => x.x === target.x && x.y === target.y);
        eq('主城领地出现该地块，驻军 6 名羽林卫', held?.garrison, 6);
        const reports = (dataOf(await playerA.request(Op.GET_BATTLE_REPORTS, { limit: 5 })).reports ?? []) as Array<Record<string, any>>;
        const withElite = reports.find((r) => {
          const troops = JSON.stringify(r.attacker?.troops ?? {}) + JSON.stringify(r.defender?.troops ?? {});
          return troops.includes('yulin_guard');
        });
        verify('战报编成里含 yulin_guard', withElite !== undefined, reports.length ? `最近 ${reports.length} 份战报` : '无战报');
        const recalled = await playerA.request(Op.RECALL_GARRISON, { cityId: mainA, x: target.x, y: target.y });
        verify('召回驻守（RECALL_GARRISON）成功', recalled.ok === true, errCode(recalled as unknown as Record<string, any>));
        await marchSettle(playerA, mainA);
        const back = (await state(playerA, mainA)).city.army as Record<string, number>;
        verify('召回后羽林卫回到主城', Number(back.yulin_guard ?? 0) >= 6, `army.yulin_guard=${back.yulin_guard}`);
      }
    }

    step('10. 数值倍率矩阵：8 座名城专属兵逐一对照同类普通兵');
    {
      const host = jianyeId;
      await seedLevel(host, 'barracks', 9);
      await seedRich(host);
      await runEliteMatrix(
        {
          query: sql,
          cityOf: async (cityId: string) => (await state(playerA, cityId)).city,
          recruit: (cityId: string, troop: string, count: number) => recruit(playerA, cityId, troop, count),
          waitArmy: (cityId: string, troop: string, expected: number) => waitArmy(playerA, cityId, troop, expected),
          verify,
          eq,
        },
        host,
        ELITE_OF,
      );
      await sql(`UPDATE cities SET famous_name='建业' WHERE id=$1`, [host]);
    }

    step('11. NPC 名城守军仍用普通兵种');
    {
      const mainB = (await state(playerB)).cities[0].id;
      await relocateCityNear(String(mainB), GUANDU.x, GUANDU.y);
      await seedArmy(String(mainB), { scout: 3 });
      await sql(
        `INSERT INTO account_techs (account_id, tech, level) SELECT account_id, 'scouting', 6 FROM cities WHERE id = $1
         ON CONFLICT (account_id, tech) DO UPDATE SET level = 6`,
        [String(mainB)],
      );
      await sql(`UPDATE city_army SET count = 0 WHERE city_id = $1 AND troop <> 'scout'`, [mainB]).catch(() => undefined);
      const before = await tile(playerB, GUANDU.x, GUANDU.y);
      eq('官渡仍是 NPC 名城（stage=outer）', (before.famous as Record<string, any>)?.stage, 'outer');
      const res = (await playerB.request(Op.SCOUT, { cityId: String(mainB), x: GUANDU.x, y: GUANDU.y, count: 1 })) as unknown as Record<string, any>;
      verify('侦察官渡受理', res.ok === true, errCode(res));
      await marchSettle(playerB, String(mainB));
      const after = await tile(playerB, GUANDU.x, GUANDU.y);
      const npc = (after.npc ?? {}) as Record<string, any>;
      const garrison = (npc.garrison ?? {}) as Record<string, number>;
      // 视图按全部兵种键下发（没有的为 0），只看实到的构成
      const arrived = Object.entries(garrison).filter(([, n]) => Number(n) > 0);
      const eliteInGarrison = arrived.filter(([k]) => ELITE_TROOPS.includes(k));
      const composition = arrived.map(([k, n]) => `${k}:${n}`).join(', ');
      verify('侦察明细档位为 exact/kinds（否则看不出兵种）', npc.scoutDetail === 'exact' || npc.scoutDetail === 'kinds', `detail=${npc.scoutDetail ?? '-'}`);
      verify('侦察快照里没有专属兵（守军仍是普通兵种）', eliteInGarrison.length === 0, `实到 ${composition}`);
      verify('实到守军都是普通兵种且非空', arrived.length > 0 && arrived.every(([k]) => !ELITE_TROOPS.includes(k)), composition);
      verify(
        '外围守军与 Lv3 名城口径一致（义兵 150 / 刀盾 45 / 弓 60 / 轻骑 18，各 ×1.5）',
        [garrison.militia, garrison.swordsman, garrison.archer, garrison.cavalry, arrived.length].join(',') === '150,45,60,18,4',
        `${composition}（兵种数 ${arrived.length}）`,
      );
    }

    step('12. 换主：B 三击夺走洛阳 → 新主人可练、原主人不可、存量不消失');
    if (SKIP_OWNER_CHANGE) {
      console.log('  · --skip-owner-change：跳过换主段');
    } else {
      const luoyangArmyBefore = ((await state(playerA, luoyang)).city.army as Record<string, number>).yulin_guard;
      const mainArmyBefore = ((await state(playerA, mainA)).city.army as Record<string, number>).yulin_guard;
      const mainB = String((await state(playerB)).cities[0].id);
      await relocateCityNear(mainB, LUOYANG.x, LUOYANG.y);
      await seedArmy(mainB, { militia: 500, swordsman: 4000, archer: 4000, cavalry: 1500 });
      const durabilities = [65, 30];
      for (let hit = 1; hit <= 3; hit += 1) {
        await marchAll(playerB, mainB, LUOYANG.x, LUOYANG.y, 'occupy');
        await sql(`UPDATE cities SET truce_until = NULL WHERE x=$1 AND y=$2`, [LUOYANG.x, LUOYANG.y]);
        const t = await tile(playerB, LUOYANG.x, LUOYANG.y);
        if (hit <= 2) {
          eq(`第 ${hit} 击：城防降到 ${durabilities[hit - 1]}`, t.durability, durabilities[hit - 1]);
          const owner = t.owner as Record<string, any>;
          eq(`第 ${hit} 击后仍是 A 的城`, owner?.username, userA);
          await seedArmy(String(owner.cityId), { militia: 30 }); // 守军已全灭，补一点让下一击必赢
        } else {
          eq('第 3 击：洛阳归 B', (t.owner as Record<string, any>)?.username, userB);
        }
      }
      const citiesA = (await state(playerA, mainA)).cities;
      verify('A 的城池列表已无洛阳', citiesA.every((c) => c.name !== '洛阳'), JSON.stringify(citiesA.map((c) => c.name)));
      const after = await tile(playerB, LUOYANG.x, LUOYANG.y);
      eq('洛阳归 B', (after.owner as Record<string, any>)?.username, userB);
      const bLuoyang = String((after.owner as Record<string, any>)?.cityId);
      eq('换主后仍带名城标记', ((await state(playerB, bLuoyang)).city as Record<string, any>).famousName, '洛阳');
      // 新主人可以练
      await seedLevel(bLuoyang, 'barracks', 7);
      await seedRich(bLuoyang);
      const newOwner = await recruit(playerB, bLuoyang, 'yulin_guard', 2);
      verify('新主人（B）在洛阳征募羽林卫成功', newOwner.ok === true, errCode(newOwner));
      if (newOwner.ok) await waitArmy(playerB, bLuoyang, 'yulin_guard', 2);
      // 原主人不能再练
      const oldMain = await recruit(playerA, mainA, 'yulin_guard', 1);
      verify('原主人（A）在主城征募羽林卫 → ELITE_TROOP_LOCKED', oldMain.ok === false && errCode(oldMain) === 'ELITE_TROOP_LOCKED', errCode(oldMain));
      const oldBranch = await recruit(playerA, jianyeId, 'yulin_guard', 1);
      verify('原主人（A）在建业征募羽林卫 → ELITE_TROOP_LOCKED', oldBranch.ok === false && errCode(oldBranch) === 'ELITE_TROOP_LOCKED', errCode(oldBranch));
      // 存量不消失
      const mainArmyAfter = ((await state(playerA, mainA)).city.army as Record<string, number>).yulin_guard;
      eq('原主人主城里的 6 名羽林卫仍在（不消失）', mainArmyAfter, mainArmyBefore);
      // 洛阳城内的驻军按现有分城易主规则处理（守城战被歼则随城清空；未全灭则按幸存留在城里）
      const bLuoyangArmy = ((await state(playerB, bLuoyang)).city.army as Record<string, number>).yulin_guard;
      verify(
        '洛阳城内的羽林卫按现有易主规则处理（守方被歼即清空，不残留为 A 的部队）',
        Number(bLuoyangArmy ?? 0) === 0 || Number(bLuoyangArmy ?? 0) === 2,
        `换主前（A 城内）${luoyangArmyBefore} → 换主后（B 城内）${bLuoyangArmy ?? 0}（B 自己征募的 2 名在内）`,
      );

      step('13. 复测 AISLG-167 未通过项：失守后超出上限的等级按当前上限生效');
      {
        await sql(`UPDATE city_buildings SET level=25 WHERE city_id=$1 AND kind='wall'`, [bLuoyang]);
        let st = await state(playerB, bLuoyang);
        eq('名城本城：levels.wall = 25、defenseBonus = 80', [st.city.levels.wall, st.city.defenseBonus], [25, 80]);
        await sql(`UPDATE cities SET famous_name=NULL WHERE id=$1`, [bLuoyang]);
        st = await state(playerB, bLuoyang);
        eq('失守后：levelMax.wall 回 20 且 levels.wall 按上限报 20', [st.city.levelMax.wall, st.city.levels.wall], [20, 20]);
        eq('失守后：defenseBonus 按 20 级生效（70，而非 75）', st.city.defenseBonus, 70);
        eq('失守后：costs.wall.upgrade = null（不能再升）', st.city.costs.wall.upgrade, null);
        const up = (await playerB.request(Op.UPGRADE, { cityId: bLuoyang, kind: 'wall' })) as unknown as Record<string, any>;
        verify('失守后再升 → BUILDING_LEVEL_MAX', up.ok === false && errCode(up) === 'BUILDING_LEVEL_MAX', errCode(up));
        await sql(`UPDATE cities SET famous_name='洛阳' WHERE id=$1`, [bLuoyang]);
        st = await state(playerB, bLuoyang);
        eq('重新占领：levels.wall 恢复 25、defenseBonus 80（库存未丢）', [st.city.levels.wall, st.city.defenseBonus], [25, 80]);
      }
    }
  } finally {
    if (!SKIP_CONQUER) await restoreFamousTiles();
    const failed = results.filter((r) => !r.ok);
    console.log(`\n===== AISLG-168 黑盒验收汇总（${stepTotal()} 步，${results.length} 条断言）=====`);
    console.log(`通过 ${results.length - failed.length} / 失败 ${failed.length}`);
    for (const f of failed) console.log(`  ✗ ${f.label} —— ${f.detail}`);
    playerA.close();
    playerB.close();
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error('\n执行中断：', err);
  process.exitCode = 1;
});