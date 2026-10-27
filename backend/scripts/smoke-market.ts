// 玩家交易所冒烟（v78，AISLG-196）：挂单冻结 → 部分吃单 → 双方商队送达（5% 手续费）→ 撤单退款。
// 前置：PostgreSQL、API、Worker 已启动（./dev.sh）。商队到达时间由脚本直接压到当前时刻，只压缩等待。
// 运行（在 backend/ 目录）：npx tsx --env-file=.env scripts/smoke-market.ts

import pg from 'pg';
import { Op } from '../common/src/protocol';
import { Client, check, dataOf, step } from './smoke-client';
import { seedAccount } from './smoke-account';

const PASSWORD = 'smoke-pass-123';
const names = [`mkt_${Date.now()}_a`, `mkt_${Date.now()}_b`];
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  const players: Client[] = [];
  try {
    step('预建两个账号，官府 5、解除新手保护、准备铁 / 粮');
    const cities: string[] = [];
    for (const username of names) {
      await seedAccount(username, PASSWORD);
      const account = await client.query(`SELECT id FROM accounts WHERE username = $1`, [username]);
      const city = await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [account.rows[0].id]);
      cities.push(city.rows[0].id as string);
      await client.query(`UPDATE accounts SET newbie_until = NULL WHERE id = $1`, [account.rows[0].id]);
      await client.query(`UPDATE city_buildings SET level = 5 WHERE city_id = $1 AND kind = 'government'`, [city.rows[0].id]);
      await client.query(`UPDATE cities SET iron = 20000, food = 20000, gold = 200000 WHERE id = $1`, [city.rows[0].id]);
    }
    step('两个账号登录');
    for (const username of names) {
      const player = await Client.connect();
      const login = await player.request(Op.LOGIN, { username, password: PASSWORD, asAgent: false });
      check(login.ok === true, `登录 ${username}`);
      players.push(player);
    }
    const [a, b] = players;

    step('GET_MARKET：门槛通过、初始额度');
    const market = await a.request(Op.GET_MARKET);
    check(market.ok === true, '查询成功');
    check((dataOf(market).limits as { locked: boolean }).locked === false, '未被门槛锁住');

    step('A 挂单：卖 1 万铁，每 1 铁换 1.2 粮');
    const created = await a.request(Op.CREATE_MARKET_ORDER, {
      sellResource: 'iron', buyResource: 'food', amount: 10000, unitPrice: 1.2,
    });
    check(created.ok === true, '挂单成功');
    const orderId = String((dataOf(created).order as { id: string }).id);
    const aCity = await client.query(`SELECT iron FROM cities WHERE id = $1`, [cities[0]]);
    check(Number(aCity.rows[0].iron) === 10000, '挂单立即冻结 1 万铁');

    step('B 在挂单列表看到并买 4000（付 4800 粮）');
    const list = await b.request(Op.GET_MARKET, { sellResource: 'iron', buyResource: 'food' });
    check(((dataOf(list).orders ?? []) as unknown[]).length >= 1, '看得到挂单');
    const buy = await b.request(Op.BUY_MARKET_ORDER, { orderId, quantity: 4000 });
    check(buy.ok === true, '吃单成功');
    check(Number(dataOf(buy).remaining) === 6000, '挂单剩 6000');
    const bCity = await client.query(`SELECT food FROM cities WHERE id = $1`, [cities[1]]);
    check(Number(bCity.rows[0].food) === 15200, '买家扣 4800 粮');

    step('压缩商队到达时间并等 Worker 入账');
    await client.query(`UPDATE marches SET arrive_at = now() WHERE purpose = 'caravan' AND status = 'marching'`);
    let delivered = false;
    for (let i = 0; i < 30 && !delivered; i += 1) {
      await sleep(400);
      const checkRes = await client.query(
        `SELECT (SELECT iron FROM cities WHERE id = $1) AS b_iron, (SELECT food FROM cities WHERE id = $2) AS a_food`,
        [cities[1], cities[0]],
      );
      delivered = Number(checkRes.rows[0].b_iron) === 23800 && Number(checkRes.rows[0].a_food) === 24560;
    }
    check(delivered, '买家收到 3800 铁、卖家收到 4560 粮（各扣 5%）');

    step('撤单：剩余 6000 铁退回');
    const cancel = await a.request(Op.CANCEL_MARKET_ORDER, { orderId });
    check(cancel.ok === true, '撤单成功');
    const refunded = await client.query(`SELECT iron FROM cities WHERE id = $1`, [cities[0]]);
    check(Number(refunded.rows[0].iron) === 16000, '冻结的 6000 铁已退回');

    step('单价越界：PRICE_OUT_OF_RANGE');
    const bad = await a.request(Op.CREATE_MARKET_ORDER, {
      sellResource: 'iron', buyResource: 'food', amount: 1000, unitPrice: 3,
    });
    check(bad.ok === false && bad.error?.code === 'PRICE_OUT_OF_RANGE', '越界单价被拒');

    for (const player of players) {
      player.close();
    }
    console.log('\n✅ 玩家交易所冒烟通过');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ 玩家交易所冒烟失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
