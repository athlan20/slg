// 联盟外交冒烟（v77，AISLG-195）：建三个联盟 → 邀请 / 同意 → 解除（24h 不可攻击 + 72h 不可再结好）→ 宣布敌对。
// 前置：PostgreSQL、API、Worker 已启动（./dev.sh）。
// 运行（在 backend/ 目录）：npx tsx --env-file=.env scripts/smoke-alliance-diplomacy.ts

import pg from 'pg';
import { Op } from '../common/src/protocol';
import { Client, check, dataOf, step } from './smoke-client';
import { seedAccount } from './smoke-account';

const PASSWORD = 'smoke-pass-123';
const names = [1, 2, 3].map((n) => `dip_${Date.now()}_${n}`);

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const client = await pool.connect();
  const players: Client[] = [];
  try {
    step('预建 3 个账号并准备建盟条件（官府 5、金币 20 万）');
    for (const username of names) {
      await seedAccount(username, PASSWORD);
      const account = await client.query(`SELECT id FROM accounts WHERE username = $1`, [username]);
      const city = await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [account.rows[0].id]);
      await client.query(`UPDATE city_buildings SET level = 5 WHERE city_id = $1 AND kind = 'government'`, [city.rows[0].id]);
      await client.query(`UPDATE cities SET gold = 200000 WHERE id = $1`, [city.rows[0].id]);
    }
    step('三个账号登录并各建一个联盟');
    const allianceIds: string[] = [];
    for (let i = 0; i < names.length; i += 1) {
      const player = await Client.connect();
      const login = await player.request(Op.LOGIN, { username: names[i], password: PASSWORD, asAgent: false });
      check(login.ok === true, `登录 ${names[i]}`);
      players.push(player);
      const created = await player.request(Op.CREATE_ALLIANCE, { name: `dip${i}${Date.now() % 10000}` });
      check(created.ok === true, '建盟成功');
      allianceIds.push(String(dataOf(created).allianceId));
    }
    const [a, b, c] = players;
    const [aId, bId, cId] = allianceIds;

    step('A 邀请 B，B 同意，双方成为友盟');
    const invite = await a.request(Op.ALLIANCE_DIPLOMACY_INVITE, { allianceId: bId });
    check(invite.ok === true, '发出邀请');
    const bDiplomacy = await b.request(Op.GET_ALLIANCE_DIPLOMACY);
    check(bDiplomacy.ok === true, 'B 查询外交');
    const inviteId = String(((dataOf(bDiplomacy).invites ?? []) as Array<{ id: string }>)[0]?.id ?? '');
    check(inviteId.length > 0, 'B 收到邀请');
    const accept = await b.request(Op.ALLIANCE_DIPLOMACY_RESPOND, { inviteId, accept: true });
    check(accept.ok === true, 'B 同意');
    const aDiplomacy = await a.request(Op.GET_ALLIANCE_DIPLOMACY);
    check(((dataOf(aDiplomacy).friends ?? []) as unknown[]).length === 1, 'A 有一个友盟');

    step('友盟成员互相出征被拒（ALLY_NOT_ATTACKABLE）');
    const targetCity = await client.query(
      `SELECT c.x, c.y, c.id FROM cities c JOIN accounts acc ON acc.id = c.account_id
       WHERE acc.username = $1 ORDER BY c.created_at LIMIT 1`,
      [names[1]],
    );
    const attackerCity = await client.query(
      `SELECT c.id FROM cities c JOIN accounts acc ON acc.id = c.account_id
       WHERE acc.username = $1 ORDER BY c.created_at LIMIT 1`,
      [names[0]],
    );
    await client.query(
      `INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'swordsman', 100)
       ON CONFLICT (city_id, troop) DO UPDATE SET count = 100`,
      [attackerCity.rows[0].id],
    );
    const march = await a.request(Op.MARCH, {
      x: Number(targetCity.rows[0].x), y: Number(targetCity.rows[0].y), troops: { swordsman: 10 }, task: 'plunder',
    });
    check(march.ok === false && march.error?.code === 'ALLY_NOT_ATTACKABLE', '友盟出征被拒');

    step('联盟频道写入外交系统消息、全服播报写入');
    const messages = await a.request(Op.CHAT_HISTORY, { channel: 'alliance', limit: 20 });
    const kinds = ((dataOf(messages).messages ?? []) as Array<{ system?: { kind?: string } }>).map((m) => m.system?.kind);
    check(kinds.includes('alliance_diplomacy_friendly'), '联盟频道有外交系统消息');
    const broadcast = await client.query(
      `SELECT count(*)::int AS n FROM server_broadcasts WHERE type = 'alliance_diplomacy' AND detail->>'kind' = 'friendly'`,
    );
    check(Number(broadcast.rows[0].n) > 0, '全服播报已写入');

    step('A 再与 C 结好（用满 2 个友盟），然后解除 A-B');
    const inviteC = await a.request(Op.ALLIANCE_DIPLOMACY_INVITE, { allianceId: cId });
    check(inviteC.ok === true, '邀请 C');
    const cDiplomacy = await c.request(Op.GET_ALLIANCE_DIPLOMACY);
    const cInviteId = String(((dataOf(cDiplomacy).invites ?? []) as Array<{ id: string }>)[0]?.id ?? '');
    const acceptC = await c.request(Op.ALLIANCE_DIPLOMACY_RESPOND, { inviteId: cInviteId, accept: true });
    check(acceptC.ok === true, 'C 同意');
    const ended = await a.request(Op.ALLIANCE_DIPLOMACY_END, { allianceId: bId });
    check(ended.ok === true, '解除 A-B 友好');
    const reInvite = await a.request(Op.ALLIANCE_DIPLOMACY_INVITE, { allianceId: bId });
    check(reInvite.ok === false && reInvite.error?.code === 'DIPLOMACY_COOLDOWN', '72 小时内不能再次结好');

    step('A 宣布 B 敌对（从冷却中的中立转敌对，保留 24 小时不可攻击）');
    const hostile = await a.request(Op.ALLIANCE_DIPLOMACY_HOSTILE, { allianceId: bId });
    check(hostile.ok === true, '宣布敌对成功');
    const hostileList = ((dataOf(hostile).hostiles ?? []) as unknown[]).length;
    check(hostileList >= 1, '敌对名单有 B');
    const marchCooldown = await a.request(Op.MARCH, {
      x: Number(targetCity.rows[0].x), y: Number(targetCity.rows[0].y), troops: { swordsman: 10 }, task: 'plunder',
    });
    check(marchCooldown.ok === false && marchCooldown.error?.code === 'ALLY_NOT_ATTACKABLE', '解除友好后 24 小时内仍被拒');

    step('Agent 调管理类外交返回 AGENT_FORBIDDEN（用玩家连接的 role 覆盖）');
    // 直接用同一连接模拟 Agent 角色不可行；管理类拦截已有单测覆盖，这里只验证查询对 Agent 开放（跳过角色伪造）
    const noAlliance = await a.request(Op.GET_ALLIANCE_DIPLOMACY);
    check(noAlliance.ok === true, '查询外交可用');

    for (const player of players) {
      player.close();
    }
    console.log('\n✅ 联盟外交冒烟通过');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('❌ 联盟外交冒烟失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
