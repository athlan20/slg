// QA 黑盒测试数据准备（AISLG-209 遣散士兵）：一次性脚本，不进回归。
// 建号（含初始主城）→ 给主城塞一份城内驻军（长枪兵 100 + 义兵 20）并把资源抬到固定值，
// 打印账号、密码与城内驻军，供浏览器 GUI 登录后点「军队 → 遣散」验证。
// 前置：数据库可达（backend/.env 的 DATABASE_URL）。API / Worker 未启动也能先建好数据。
//   npx tsx --env-file=.env scripts/qa-disband-setup.ts

import { createPool } from '../common/src/db';
import { hashPassword } from '../api/src/password';
import { insertAccountWithCity } from '../api/src/auth';

const password = 'qa-pass-209';
const army: Record<string, number> = { pikeman: 100, militia: 20 };
const resources = { gold: 5000, wood: 5000, food: 5000, stone: 5000, iron: 5000 };

async function main(): Promise<void> {
  const suffix = Date.now();
  const username = `qa_disband_${suffix}`;
  const pool = createPool('qa-disband-setup', 1);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const account = await insertAccountWithCity(client, {
      username,
      passwordHash: await hashPassword(password),
      signupIp: null,
    });
    const cityRes = await client.query(
      `SELECT id, name FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`,
      [account.id],
    );
    const city = cityRes.rows[0] as { id: string; name: string };
    for (const [troop, count] of Object.entries(army)) {
      await client.query(
        `INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)
         ON CONFLICT (city_id, troop) DO UPDATE SET count = EXCLUDED.count, updated_at = now()`,
        [city.id, troop, count],
      );
    }
    await client.query(
      `UPDATE cities SET gold = $2, wood = $3, food = $4, stone = $5, iron = $6 WHERE id = $1`,
      [city.id, resources.gold, resources.wood, resources.food, resources.stone, resources.iron],
    );
    await client.query('COMMIT');
    console.log('账号    :', username);
    console.log('密码    :', password);
    console.log('主城    :', city.name, city.id);
    console.log('城内驻军:', JSON.stringify(army));
    console.log('资源    :', JSON.stringify(resources));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('准备失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
