// AISLG-168 黑盒验收的「征兵时长倍率」探针：专属兵的 RECRUIT_UNIT_SECONDS 覆盖关掉时才看得出来，
// 所以单独放一个脚本，在正常（未覆盖）时长下用「同名城池征 1 名」对比 dueAt − 发起时刻：
// 羽林卫 38s / 丹阳兵 38s（刀盾兵 25s）、白毦兵 30s（长枪兵 20s）、诸葛连弩兵 45s（弓箭兵 30s）、
// 虎豹骑 60s（轻骑兵 40s）——即同类普通兵的 ×1.5（占位数值，四舍五入到整秒）。
//
// 运行（api 与 worker 以 **不带** RECRUIT_UNIT_SECONDS 的正常时长启动）：
//   npx tsx --env-file=.env scripts/smoke-elite-timing.ts
// 前置：指定账号的某个城标记为对应名城、军营等级足够（默认用 LATEST=1 取最近一个 f168a_/f168 账号）。

import { Op } from '../common/src/protocol';
import { createPool, ensureSchema } from '../common/src/db';
import { Client, dataOf } from './smoke-client';

const password = 'smoke-pass-123';
/** 同类普通兵 → 专属兵（同一承载城逐对测） */
const PAIRS: Array<{ base: string; elite: string; eliteCity: string; barracks: number }> = [
  { base: 'swordsman', elite: 'yulin_guard', eliteCity: '洛阳', barracks: 7 },
  { base: 'pikeman', elite: 'baimao_soldier', eliteCity: '襄阳', barracks: 6 },
  { base: 'archer', elite: 'zhuge_crossbow', eliteCity: '成都', barracks: 8 },
  { base: 'cavalry', elite: 'hubao_cavalry', eliteCity: '官渡', barracks: 9 },
];
const HOST_TOWN_OF = '洛阳'; // 承载城：先把它的名城标记换成目标名城再征

const pool = createPool('smoke-elite-timing', 2);
const sql = async (text: string, params: unknown[] = []): Promise<{ rows: Array<Record<string, any>>; rowCount: number | null }> =>
  pool.query(text, params) as unknown as Promise<{ rows: Array<Record<string, any>>; rowCount: number | null }>;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function recruitSeconds(client: Client, cityId: string, troop: string): Promise<number> {
  const requestedAt = Date.now();
  const res = await client.request(Op.RECRUIT, { cityId, troop, count: 1 });
  if (!res.ok) throw new Error(`征募 ${troop} 失败：${JSON.stringify(res.error)}`);
  const view = (dataOf(res).recruit ?? {}) as Record<string, any>;
  const seconds = view.dueAt ? (Date.parse(String(view.dueAt)) - requestedAt) / 1000 : Number.NaN;
  // 等这批兵入城，避免占用征兵队列
  const before = Number((dataOf(await client.request(Op.GET_STATE, { cityId })).city as Record<string, any>).army[troop] ?? 0);
  for (let i = 0; i < 120; i += 1) {
    const now = Number((dataOf(await client.request(Op.GET_STATE, { cityId })).city as Record<string, any>).army[troop] ?? 0);
    if (now > before) break;
    await sleep(1000);
  }
  return seconds;
}

async function main(): Promise<void> {
  await ensureSchema(pool);
  const latest = await sql(
    `SELECT a.username, c.id AS city_id FROM accounts a JOIN cities c ON c.account_id = a.id
     WHERE a.username LIKE 'f168a_%' ORDER BY a.created_at DESC LIMIT 1`,
  );
  if (!latest.rowCount) throw new Error('找不到 f168a_ 测试账号：先用 smoke-famous-elite.ts 跑一轮建号');
  const username = String(latest.rows[0].username);
  const cityId = String(latest.rows[0].city_id);
  console.log(`征兵时长探针：账号 ${username}，承载城 ${cityId.slice(0, 8)}（正常时长，未覆盖 RECRUIT_UNIT_SECONDS）`);
  await sql(`UPDATE cities SET gold=5e6, wood=5e6, food=5e6, stone=5e6, iron=5e6, population=2000 WHERE id=$1`, [cityId]);
  const client = await Client.connect();
  const login = await client.request(Op.LOGIN, { username, password, asAgent: false });
  if (!login.ok) throw new Error(`登录失败：${JSON.stringify(login.error)}`);
  const failures: string[] = [];
  for (const pair of PAIRS) {
    await sql(`UPDATE cities SET famous_name=$2 WHERE id=$1`, [cityId, HOST_TOWN_OF]); // 先复位成普通承载城标记
    await sql(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1,'barracks',$2) ON CONFLICT (city_id, kind) DO UPDATE SET level=$2`, [cityId, pair.barracks]);
    await sql(`UPDATE cities SET famous_name=$2 WHERE id=$1`, [cityId, pair.eliteCity]);
    const eliteSeconds = await recruitSeconds(client, cityId, pair.elite);
    await sql(`UPDATE cities SET famous_name=$2 WHERE id=$1`, [cityId, HOST_TOWN_OF]);
    const baseSeconds = await recruitSeconds(client, cityId, pair.base);
    const ratio = baseSeconds > 0 ? eliteSeconds / baseSeconds : 0;
    const ok = Math.abs(ratio - 1.5) <= 0.06;
    console.log(
      `  ${ok ? '✓' : '✗'} ${pair.elite} ${eliteSeconds}s / ${pair.base} ${baseSeconds}s = ${ratio.toFixed(3)}（期望 ≈1.5）`,
    );
    if (!ok) failures.push(`${pair.elite}/${pair.base}=${ratio.toFixed(3)}`);
  }
  console.log(failures.length ? `\n失败：${failures.join(', ')}` : '\n全部符合 ×1.5 的时长倍率');
  client.close();
  await pool.end().catch(() => undefined);
  if (failures.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error('执行中断：', err);
  process.exitCode = 1;
});