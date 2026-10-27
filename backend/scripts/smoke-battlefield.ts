// 剧本战场冒烟（v75，AISLG-198）：真实 WebSocket 走一遍报名 → 入场 → 拆队 → 开战 → 攻打据点 → 商店 → 结束发奖。
// 前置：PostgreSQL、API、Worker 已启动（./dev.sh）。行军每格 60 秒现实时间，本脚本在发起行军后
// 直接把 arrive_at 改到当前时刻，交给 Worker 下个 tick 结算——只压缩等待，不改结算逻辑。
//
// 运行（在 backend/ 目录）：npx tsx --env-file=.env scripts/smoke-battlefield.ts

import pg from 'pg';
import { Op } from '../common/src/protocol';
import { Client, check, dataOf, step } from './smoke-client';
import { seedAccount } from './smoke-account';

const username = `bf_${Date.now()}`;
const password = 'smoke-pass-123';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  let eventId = '';
  let accountId = '';
  try {
    step('预建账号并准备官府 5 级与驻军');
    await seedAccount(username, password);
    const account = await client.query(`SELECT id FROM accounts WHERE username = $1`, [username]);
    accountId = account.rows[0].id as string;
    const city = await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [accountId]);
    const cityId = city.rows[0].id as string;
    await client.query(`UPDATE city_buildings SET level = 5 WHERE city_id = $1 AND kind = 'government'`, [cityId]);
    await client.query(
      `INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'swordsman', 500), ($1, 'archer', 300)
       ON CONFLICT (city_id, troop) DO UPDATE SET count = EXCLUDED.count`,
      [cityId],
    );
    step('把战场切到报名期');
    await client.query(`DELETE FROM battlefield_events`);
    const inserted = await client.query(
      `INSERT INTO battlefield_events (script, signup_start, start_at, end_at, status)
       VALUES ('guandu', now() - interval '1 minute', now() + interval '1 hour', now() + interval '25 hours', 'signup')
       RETURNING id`,
    );
    eventId = inserted.rows[0].id as string;
    // 据点由 Worker 在生命周期 tick 里补建（人工插入的战场也一样）；等它建完再查
    for (let i = 0; i < 20; i += 1) {
      const count = await client.query(`SELECT count(*)::int AS n FROM battlefield_strongholds WHERE event_id = $1`, [eventId]);
      if (Number(count.rows[0].n) >= 9) {
        break;
      }
      await sleep(300);
    }

    const player = await Client.connect();
    const login = await player.request(Op.LOGIN, { username, password, asAgent: false });
    check(login.ok === true, '登录成功');

    step('GET_BATTLEFIELD：报名期有 9 个据点');
    const initial = await player.request(Op.GET_BATTLEFIELD);
    check(initial.ok === true, '查询成功');
    const initialData = dataOf(initial);
    check((initialData.strongholds as unknown[]).length === 9, '9 个据点');

    step('报名袁绍军');
    const signup = await player.request(Op.SIGNUP_BATTLEFIELD, { camp: 'yuan' });
    check(signup.ok === true, '报名成功');
    const signupMe = (dataOf(signup).me ?? {}) as Record<string, unknown>;
    check(signupMe.camp === 'yuan', '阵营为袁绍军');
    check(signupMe.entered === false, '尚未入场');

    step('带 800 兵入场（刀盾 500 + 弓箭 300）');
    const enter = await player.request(Op.ENTER_BATTLEFIELD, { troops: { swordsman: 500, archer: 300 } });
    check(enter.ok === true, '入场成功');
    const enterMe = (dataOf(enter).me ?? {}) as { entered?: boolean; squads?: Array<{ id: string; troops: { swordsman: number; archer: number } }> };
    check(enterMe.entered === true && (enterMe.squads?.length ?? 0) === 1, '入场后有 1 支队伍');
    const squadId = String(enterMe.squads?.[0]?.id ?? '');
    check(squadId.length > 0, '拿到队伍 id');

    step('拆队：分出 100 弓箭兵');
    const split = await player.request(Op.SPLIT_BATTLEFIELD_SQUAD, { squadId, troops: { archer: 100 } });
    check(split.ok === true, '拆队成功');
    const splitMe = (dataOf(split).me ?? {}) as { squads?: unknown[] };
    check((splitMe.squads?.length ?? 0) === 2, '拆成 2 支队伍');

    step('开战（把开战时间改到过去，等 Worker 激活）');
    await client.query(`UPDATE battlefield_events SET start_at = now() - interval '1 second' WHERE id = $1`, [eventId]);
    let status = 'signup';
    for (let i = 0; i < 20 && status !== 'active'; i += 1) {
      await sleep(300);
      const res = await player.request(Op.GET_BATTLEFIELD);
      status = String((dataOf(res).event as { status?: string } | null)?.status ?? 'signup');
    }
    check(status === 'active', '战场已开战');

    step('行军攻打延津渡口（直达后压缩到达时间）');
    const march = await player.request(Op.MARCH_BATTLEFIELD_SQUAD, { squadId, strongholdId: 'ford_yanjin' });
    check(march.ok === true, '下达行军成功');
    await client.query(`UPDATE battlefield_squads SET arrive_at = now() WHERE id = $1`, [squadId]);

    step('等 Worker 结算据点战斗');
    let captured = false;
    let merit = 0;
    for (let i = 0; i < 30 && !captured; i += 1) {
      await sleep(400);
      const res = await player.request(Op.GET_BATTLEFIELD);
      const data = dataOf(res);
      const strongholds = (data.strongholds ?? []) as Array<{ id: string; ownerCamp: string | null }>;
      captured = strongholds.find((item) => item.id === 'ford_yanjin')?.ownerCamp === 'yuan';
      merit = Number((data.me as { merit?: number } | null)?.merit ?? 0);
    }
    check(captured, '延津渡口归属袁绍军');
    check(merit > 0, `拿到军功（${merit}）`);

    step('战场商店兑换资源包');
    const buy = await player.request(Op.BUY_BATTLEFIELD_ITEM, { item: 'resources' });
    check(buy.ok === true, '兑换成功');
    check(Number(dataOf(buy).cost) === 200, '扣除 200 军功');

    step('结束战场（把结束时间改到过去，等 Worker 发奖）');
    const before = await player.request(Op.GET_STATE);
    const beforeGold = Number(((dataOf(before).city as { resources?: { gold?: number } })?.resources?.gold ?? 0));
    await client.query(`UPDATE battlefield_events SET end_at = now() - interval '1 second' WHERE id = $1`, [eventId]);
    let finished = false;
    for (let i = 0; i < 30 && !finished; i += 1) {
      await sleep(400);
      const res = await player.request(Op.GET_BATTLEFIELD);
      finished = (dataOf(res).event as { status?: string } | null)?.status === 'finished';
    }
    check(finished, '战场已结束');
    const after = await player.request(Op.GET_STATE);
    const afterCity = dataOf(after).city as { resources?: { gold?: number }; army?: Record<string, number> };
    check(Number(afterCity.resources?.gold ?? 0) > beforeGold, '奖励金币已到账');
    check(Number(afterCity.army?.swordsman ?? 0) > 0 || Number(afterCity.army?.archer ?? 0) > 0, '幸存部队回到主城');
    player.close();
    console.log('\n✅ 剧本战场冒烟通过');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ 剧本战场冒烟失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});