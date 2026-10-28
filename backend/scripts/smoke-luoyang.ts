// 洛阳争夺冒烟（v79，AISLG-200）：洛阳之主缓存、+5% 产量、窗口外攻打被拒、政令发布与 7 天冷却。
// 前置：PostgreSQL、API、Worker 已启动（./dev.sh）。脚本把测试账号 A 的主城直接改名为「洛阳」以模拟占领。
// 运行（在 backend/ 目录）：npx tsx --env-file=.env scripts/smoke-luoyang.ts

import pg from 'pg';
import { Op } from '../common/src/protocol';
import { Client, check, dataOf, step } from './smoke-client';
import { seedAccount } from './smoke-account';
import { refreshLuoyangHolder } from '../common/src/luoyang-db';

const PASSWORD = 'smoke-pass-123';
const names = [`ly_${Date.now()}_a`, `ly_${Date.now()}_b`];

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  const players: Client[] = [];
  try {
    step('预建两个账号：A 官府 5 + 洛阳，B 官府 5 + 兵力');
    const cityIds: string[] = [];
    for (const username of names) {
      await seedAccount(username, PASSWORD);
      const account = await client.query(`SELECT id FROM accounts WHERE username = $1`, [username]);
      const city = await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [account.rows[0].id]);
      cityIds.push(city.rows[0].id as string);
      await client.query(`UPDATE accounts SET newbie_until = NULL WHERE id = $1`, [account.rows[0].id]);
      await client.query(`UPDATE city_buildings SET level = 5 WHERE city_id = $1 AND kind = 'government'`, [city.rows[0].id]);
      await client.query(`UPDATE cities SET gold = 200000, iron = 20000 WHERE id = $1`, [city.rows[0].id]);
      await client.query(
        `INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'swordsman', 100)
         ON CONFLICT (city_id, troop) DO UPDATE SET count = 100`,
        [city.rows[0].id],
      );
    }
    // 清掉历史冒烟残留的假洛阳，保证全服只有一座
    await client.query(`UPDATE cities SET famous_name = NULL WHERE famous_name = '洛阳'`);
    await client.query(`UPDATE cities SET famous_name = '洛阳', durability = 100 WHERE id = $1`, [cityIds[0]]);

    step('两个账号登录并各建联盟');
    for (let i = 0; i < names.length; i += 1) {
      const player = await Client.connect();
      const login = await player.request(Op.LOGIN, { username: names[i], password: PASSWORD, asAgent: false });
      check(login.ok === true, `登录 ${names[i]}`);
      players.push(player);
      const created = await player.request(Op.CREATE_ALLIANCE, { name: `ly${i}${Math.floor(Math.random() * 90000 + 10000)}` });
      check(created.ok === true, '建盟成功');
    }
    const [a, b] = players;
    step('刷新洛阳之主缓存');
    await refreshLuoyangHolder(pool);
    const holder = await client.query(`SELECT id, luoyang_holder FROM alliances WHERE luoyang_holder = true`);
    check(holder.rowCount === 1, '只有一个洛阳之主联盟');

    step('A 的城池显示 +5% 洛阳之主产量加成');
    const stateA = await a.request(Op.GET_STATE);
    const cityA = dataOf(stateA).city as { luoyangBonusPercent: number; famousName: string | null };
    check(cityA.famousName === '洛阳', 'A 占着洛阳');
    check(cityA.luoyangBonusPercent === 5, '洛阳之主联盟 +5%');

    step('GET_LUOYANG：窗口关闭、下次开放时间存在');
    const status = await b.request(Op.GET_LUOYANG);
    check(status.ok === true, '查询成功');
    const ly = dataOf(status) as { windowOpen: boolean; nextOpenAt: string; owner: { username: string } | null };
    check(ly.windowOpen === false, '当前不在周六 21–23 点窗口');
    check(typeof ly.nextOpenAt === 'string' && ly.nextOpenAt.length > 0, '给出下次开放时间');
    check(ly.owner?.username === names[0], '占领者是 A');

    step('窗口外 B 攻打洛阳被拒（LUOYANG_CLOSED）');
    const target = await client.query(`SELECT x, y FROM cities WHERE id = $1`, [cityIds[0]]);
    const march = await b.request(Op.MARCH, {
      x: Number(target.rows[0].x), y: Number(target.rows[0].y), troops: { swordsman: 10 }, task: 'plunder',
    });
    check(march.ok === false && march.error?.code === 'LUOYANG_CLOSED', '窗口外被拒');
    check(typeof march.data?.nextOpenAt === 'string', '附下次开放时间');

    step('A 盟主发布政令；7 天内不能重复');
    const publish = await a.request(Op.PUBLISH_DECREE, { kind: 'recruit' });
    check(publish.ok === true, '发布成功');
    const again = await a.request(Op.PUBLISH_DECREE, { kind: 'march' });
    check(again.ok === false && again.error?.code === 'DECREE_COOLDOWN', '冷却生效');
    const after = await a.request(Op.GET_LUOYANG);
    check((dataOf(after) as { decree: { kind: string } | null }).decree?.kind === 'recruit', '政令状态为征兵');

    step('B 不是洛阳之主，不能发政令');
    const denied = await b.request(Op.PUBLISH_DECREE, { kind: 'march' });
    check(denied.ok === false && denied.error?.code === 'DECREE_NOT_HOLDER', '非洛阳之主被拒');

    for (const player of players) {
      player.close();
    }
    console.log('\n✅ 洛阳争夺冒烟通过');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ 洛阳争夺冒烟失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
