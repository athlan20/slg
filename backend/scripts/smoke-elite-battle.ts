// AISLG-168 黑盒验收的「战斗表现」段（单独脚本，可在真实栈上复跑）：
// 用两账号做等兵数野地遭遇战——守方先占领一块 Lv1 无主野地（守方阵容），攻方再掠夺该地块
// （攻方阵容），同一套对比里双方人数与地块完全相同，只有兵种不同；每场读战报统计双方损失。
// 战斗引擎带随机源，故每张对阵跑多张地块取平均。数据库只用于造状态（建号、兵力、校场）。
//
// 运行：npx tsx --env-file=.env scripts/smoke-elite-battle.ts

import pg from 'pg';
import { Op } from '../common/src/protocol';
import { createPool, ensureSchema } from '../common/src/db';
import { Client, dataOf, step } from './smoke-client';
import { seedAccount } from './smoke-account';
import { findFreeLevel1, sleep, waitUntil } from './smoke-world-utils';
import type { TileLite } from './smoke-world-utils';

const RUNS = Number(process.env.ELITE_BATTLE_RUNS ?? 3);
const COUNT = Number(process.env.ELITE_BATTLE_COUNT ?? 20);
/** 只跑标签含该子串的对阵（复核单个对阵时用，例如 ELITE_BATTLE_FILTER=长枪兵 vs 轻骑兵） */
const FILTER = process.env.ELITE_BATTLE_FILTER;

/** 等兵数的对阵：攻方 vs 守方（只差兵种） */
const MATCHUPS: Array<{ label: string; attacker: string; defender: string }> = [
  { label: '羽林卫 vs 刀盾兵（同类重步兵，应更强）', attacker: 'yulin_guard', defender: 'swordsman' },
  { label: '丹阳兵 vs 刀盾兵（同类重步兵，应更强）', attacker: 'danyang_soldier', defender: 'swordsman' },
  { label: '诸葛连弩兵 vs 弓箭兵（同类远程，射程 80 > 70）', attacker: 'zhuge_crossbow', defender: 'archer' },
  { label: '白毦兵 vs 轻骑兵（枪兵克制骑兵 +40%）', attacker: 'baimao_soldier', defender: 'cavalry' },
  { label: '长枪兵 vs 轻骑兵（普通枪兵 +20%，对照组）', attacker: 'pikeman', defender: 'cavalry' },
  { label: '羽林卫 vs 铁骑兵（不压倒后期主力）', attacker: 'yulin_guard', defender: 'iron_cavalry' },
  { label: '西凉铁骑 vs 铁骑兵（不压倒后期主力）', attacker: 'xiliang_cavalry', defender: 'iron_cavalry' },
  { label: '虎豹骑 vs 铁骑兵（全军最快，不压倒后期主力）', attacker: 'hubao_cavalry', defender: 'iron_cavalry' },
];

const pool = createPool('smoke-elite-battle', 2);
const used: Array<{ x: number; y: number }> = [];
let cityA = '';
let cityD = '';
const password = 'smoke-pass-123';
const sql = async (text: string, params: unknown[] = []): Promise<pg.QueryResult> => pool.query(text, params);

async function seedArmy(cityId: string, troop: string, count: number): Promise<void> {
  await sql(`DELETE FROM city_army WHERE city_id=$1`, [cityId]);
  await sql(`INSERT INTO city_army (city_id, troop, count) VALUES ($1,$2,$3)`, [cityId, troop, count]);
}

/** 释放某城名下所有野地（每场开打前清一次，避免撞占领上限 = 官府等级） */
async function releaseTiles(cityId: string): Promise<void> {
  // 只放掉野地，城池自己占的那一格（kind='city'）不能动
  await sql(
    `DELETE FROM tile_army WHERE (x,y) IN (SELECT x,y FROM world_tiles WHERE owner_city_id=$1 AND kind='wilderness')`,
    [cityId],
  );
  // 连保护期一起清掉：否则刚换过主的地块会带着 owner_changed_until 再次出现在「无主」列表里
  await sql(
    `UPDATE world_tiles SET owner_city_id=NULL, owner_changed_until=NULL WHERE owner_city_id=$1 AND kind='wilderness'`,
    [cityId],
  );
}

async function seedGovernment(cityId: string, level: number): Promise<void> {
  await sql(
    `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1,'government',$2)
     ON CONFLICT (city_id, kind) DO UPDATE SET level=$2`,
    [cityId, level],
  );
}

async function seedParade(cityId: string): Promise<void> {
  await sql(
    `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1,'parade_ground',5)
     ON CONFLICT (city_id, kind) DO UPDATE SET level=5`,
    [cityId],
  );
}

async function relocateNear(cityId: string, nearX: number, nearY: number): Promise<{ x: number; y: number }> {
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

/** 取一块新鲜的 1 级无主野地；当前视野窗口用完了就把两城挪到地图别处再取 */
async function pickTile(defender: Client): Promise<TileLite> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await findFreeLevel1(defender, used);
    } catch {
      const nx = 80 + Math.floor(Math.random() * 840);
      const ny = 80 + Math.floor(Math.random() * 840);
      const spot = await relocateNear(cityD, nx, ny);
      await relocateNear(cityA, spot.x, spot.y);
    }
  }
  throw new Error('地图上找不到可用的 1 级无主野地');
}

async function main(): Promise<void> {
  await ensureSchema(pool);
  step('准备：攻守两个账号出保，守方城邻野地');
  const suffix = Date.now();
  const userA = `f168bat_a_${suffix}`;
  const userD = `f168bat_d_${suffix}`;
  await seedAccount(userA, password);
  await seedAccount(userD, password);
  const a = await Client.connect();
  const d = await Client.connect();
  const loginA = await a.request(Op.LOGIN, { username: userA, password, asAgent: false });
  const loginD = await d.request(Op.LOGIN, { username: userD, password, asAgent: false });
  if (!loginA.ok || !loginD.ok) throw new Error('登录失败');
  const accA = String((await sql(`SELECT id FROM accounts WHERE username=$1`, [userA])).rows[0].id);
  const accD = String((await sql(`SELECT id FROM accounts WHERE username=$1`, [userD])).rows[0].id);
  cityA = String((dataOf(await a.request(Op.GET_STATE)).city as Record<string, any>).id);
  cityD = String((dataOf(await d.request(Op.GET_STATE)).city as Record<string, any>).id);
  await sql(`UPDATE accounts SET newbie_until=NULL WHERE id IN ($1,$2)`, [accA, accD]);
  await seedParade(cityA);
  await seedParade(cityD);
  await seedGovernment(cityA, 20);
  await seedGovernment(cityD, 20);
  const spot = await relocateNear(cityD, 500, 500);
  await relocateNear(cityA, spot.x, spot.y);

  for (const matchup of MATCHUPS.filter((m) => !FILTER || m.label.includes(FILTER))) {
    const attackerLosses: number[] = [];
    const defenderLosses: number[] = [];
    let wins = 0;
    let played = 0;
    for (let run = 0; run < RUNS; run += 1) {
      await releaseTiles(cityD);
      await releaseTiles(cityA);
      const tile: TileLite = await pickTile(d);
      used.push({ x: tile.x, y: tile.y });
      // 守方先占住这块地（守方阵容）
      await seedArmy(cityD, matchup.defender, COUNT);
      const occupy = await d.request(Op.MARCH, { cityId: cityD, x: tile.x, y: tile.y, troops: { [matchup.defender]: COUNT }, task: 'occupy' });
      if (!occupy.ok) throw new Error(`守方占位失败：${JSON.stringify(occupy.error)}`);
      await sleep(2500);
      await waitUntil('守方占位完成', 60_000, async () => ((dataOf(await d.request(Op.GET_STATE, { cityId: cityD })).city as Record<string, any>).marches as unknown[]).length === 0);
      // 攻方用同一人数掠夺（攻方阵容）
      await seedArmy(cityA, matchup.attacker, COUNT);
      const before = (dataOf(await a.request(Op.GET_BATTLE_REPORTS, { limit: 1 })).reports ?? []) as Array<{ id: number }>;
      const sinceId = before.length ? before[0].id : 0;
      // 他人占领的野地只能用 occupy 抢占（v39：缺省 plunder 返回 TASK_INVALID_FOR_TARGET），战斗口径与野地遭遇战一致
      const attack = await a.request(Op.MARCH, { cityId: cityA, x: tile.x, y: tile.y, troops: { [matchup.attacker]: COUNT }, task: 'occupy' });
      if (!attack.ok) throw new Error(`攻方出征失败：${JSON.stringify(attack.error)}`);
      await sleep(2500);
      await waitUntil('攻方出征结算', 60_000, async () => ((dataOf(await a.request(Op.GET_STATE, { cityId: cityA })).city as Record<string, any>).marches as unknown[]).length === 0);
      const reports = (dataOf(await a.request(Op.GET_BATTLE_REPORTS, { limit: 5 })).reports ?? []) as Array<Record<string, any>>;
      const report = reports.find((r) => Number(r.id) > sinceId);
      if (!report) {
        console.log(`  · ${matchup.label}：第 ${run + 1} 张未取到战报（跳过）`);
        continue;
      }
      const sum = (obj: Record<string, number> | undefined): number => Object.values(obj ?? {}).reduce((s, n) => s + Number(n ?? 0), 0);
      attackerLosses.push(sum(report.attacker?.losses));
      defenderLosses.push(sum(report.defender?.losses));
      if (report.won === true) wins += 1;
      played += 1;
    }
    if (!played) continue;
    const avg = (xs: number[]): number => Math.round((xs.reduce((s, n) => s + n, 0) / xs.length) * 10) / 10;
    console.log(
      `  · ${matchup.label}：${played} 场，攻方胜 ${wins}/${played}，平均损失 攻方 ${avg(attackerLosses)} / 守方 ${avg(defenderLosses)}（各 ${COUNT} 人）`,
    );
  }

  a.close();
  d.close();
  await pool.end().catch(() => undefined);
}

main().catch((err) => {
  console.error('执行中断：', err);
  process.exitCode = 1;
});