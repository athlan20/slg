// QA 黑盒测试数据准备（AISLG-207 部分撤回）：一次性脚本，不进回归。
// 注册新账号 → 建军营/校场（Lv2）→ 征义兵与斥候 → 占领 1 级野地 → 再增援斥候，
// 形成双兵种驻军；最后打印账号、密码、野地坐标与驻军明细，供浏览器 GUI 登录测试。
// 前置：API 与 Worker 已启动；全局时间缩放调大（scripts/set-time-scale.ts 50）加速等待。
//   npx tsx --env-file=.env scripts/qa-recall-setup.ts

import { createPool } from '../common/src/db';
import { insertInitialCity } from '../common/src/main-city';
import { Op } from '../common/src/protocol';
import { hashPassword } from '../api/src/password';
import { insertAccountWithCity } from '../api/src/auth';
import { Client, check, dataOf } from './smoke-client';
import { findFreeLevel1, waitMarchOutcome } from './smoke-world-utils';

const password = 'qa-pass-207';

type CityState = {
  resources: Record<string, number>;
  territory: Array<{ x: number; y: number; garrison: number }>;
  army: Record<string, number>;
};

async function cityState(client: Client): Promise<CityState> {
  return (dataOf(await client.request(Op.GET_STATE)).city ?? {}) as CityState;
}

/** QA 数据准备专用：直接把账号名下各城资源抬到给定值（不改被测的召回链路） */
async function topUpResources(username: string, res: Record<string, number>): Promise<void> {
  const pool = createPool('qa-recall-topup', 1);
  try {
    await pool.query(
      `UPDATE cities SET gold = GREATEST(gold, $2), wood = GREATEST(wood, $3), food = GREATEST(food, $4),
              stone = GREATEST(stone, $5), iron = GREATEST(iron, $6)
       WHERE account_id = (SELECT id FROM accounts WHERE username = $1)`,
      [username, res.gold, res.wood, res.food, res.stone, res.iron],
    );
  } finally {
    await pool.end();
  }
}

async function buildAndAwait(client: Client, kind: string, upgrade: boolean): Promise<void> {
  const res = await client.request(upgrade ? Op.UPGRADE : Op.BUILD, { kind });
  check(res.ok === true, `${upgrade ? '升级' : '建造'} ${kind} 受理`);
  await client.waitPush(Op.PUSH_BUILD_STATE, 60_000, (data) => data.reason === 'build_completed');
  console.log(`  ✓ ${upgrade ? '升级' : '建造'} ${kind} 完成`);
}

async function recruitAndAwait(client: Client, troop: string, count: number): Promise<void> {
  const res = await client.request(Op.RECRUIT, { troop, count });
  check(res.ok === true, `征募 ${troop} ×${count} 受理`);
  await client.waitPush(Op.PUSH_RECRUIT_STATE, 120_000, (data) => data.reason === 'recruit_completed');
  console.log(`  ✓ ${troop} ×${count} 入城`);
}

async function main(): Promise<void> {
  const suffix = Date.now();
  const username = `qa_recall_${suffix}`;
  // 密码注册通道已关闭（v48）：直接按注册流程同款函数建号（含初始主城、新手期、Agent 令牌）
  const pool = createPool('qa-recall-setup', 1);
  {
    const db = await pool.connect();
    try {
      await insertAccountWithCity(db, { username, passwordHash: await hashPassword(password), signupIp: null });
    } finally {
      db.release();
    }
  }
  await pool.end();
  console.log(`== 账号：${username} / ${password} ==`);

  const client = await Client.connect();
  const login = await client.request(Op.LOGIN, { username, password, asAgent: false });
  check(login.ok === true, `WS 密码登录成功：${username}`);

  console.log('== 建造：军营 → 校场 Lv2 ==');
  await buildAndAwait(client, 'barracks', false);
  await buildAndAwait(client, 'parade_ground', false);
  await buildAndAwait(client, 'parade_ground', true);

  console.log('== 征兵：义兵 30 ==');
  await topUpResources(username, { gold: 6000, wood: 6000, food: 6000, stone: 6000, iron: 6000 });
  await recruitAndAwait(client, 'militia', 30);

  console.log('== 军营 Lv2 → 斥候 12 ==');
  await buildAndAwait(client, 'barracks', true);
  await recruitAndAwait(client, 'scout', 12);

  console.log('== 占领 1 级野地 ==');
  const target = await findFreeLevel1(client);
  const march = await client.request(Op.MARCH, { x: target.x, y: target.y, troops: { militia: 25 }, task: 'occupy' });
  check(march.ok === true, `占领出征受理 → (${target.x},${target.y})`);
  const marchData = (dataOf(march).march ?? {}) as { arriveAt: string };
  const travelMs = Math.max(0, Date.parse(marchData.arriveAt) - Date.now());
  await client.waitPush(Op.PUSH_MARCH_STATE, travelMs + 30_000, (data) => data.reason === 'march_arrived');
  const outcome = await waitMarchOutcome(client, 0, 30_000);
  console.log(`  ✓ 占领战斗结束：outcome=${outcome.outcome}`);

  console.log('== 增援斥候 12 上地块（双兵种驻军） ==');
  const reinforce = await client.request(Op.MARCH, { x: target.x, y: target.y, troops: { scout: 12 } });
  check(reinforce.ok === true, '增援出征受理（打自己地块=增援）');
  const reinforceData = (dataOf(reinforce).march ?? {}) as { arriveAt: string };
  const reinforceMs = Math.max(0, Date.parse(reinforceData.arriveAt) - Date.now());
  await client.waitPush(Op.PUSH_MARCH_STATE, reinforceMs + 30_000, (data) => data.reason === 'march_arrived');

  const detail = await client.request(Op.GET_TILE, { x: target.x, y: target.y });
  const tile = (dataOf(detail).tile ?? {}) as { owner: { username: string } | null; garrison: number; garrisonDetail: Record<string, number> };
  check(tile.owner?.username === username, '地块归本账号');
  console.log(`== 驻军明细：${JSON.stringify(tile.garrisonDetail)}（总 ${tile.garrison}） ==`);

  const state = await cityState(client);
  console.log(`== 领地：${JSON.stringify(state.territory)} ==`);
  console.log(`== GUI 测试入口：http://localhost:8424 ，账号 ${username} 密码 ${password}，野地 (${target.x},${target.y}) ==`);
  client.close();
}

main().catch((error) => {
  console.error('准备失败：', error);
  process.exit(1);
});
