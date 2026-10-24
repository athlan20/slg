// 赛季惰性加入（AISLG-134，docs/season-system.md §2.2）的事务规则：joinCurrentSeason 的重置字段与建主城、
// 幂等（已在本赛季为空操作）、有残留城池不另建、注册即归入当前赛季，以及三条登录路径（令牌 / Agent 令牌）
// 真正走到惰性加入。需要真实 PostgreSQL：设置 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { insertAccountWithCity } from '../api/src/auth';
import { getCurrentSeason, enterCurrentSeason, joinCurrentSeason } from '../common/src/season-db';
import { INITIAL_BUILDINGS } from '../common/src/rules';
import { Op, type ResponseFrame } from '../common/src/protocol';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { generateSessionToken, hashSessionToken } from '../api/src/auth';
import { generateAgentToken, hashAgentToken } from '../api/src/agent-token';
import { setTimeScaleCache } from '../common/src/time-scale';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;
/** 不属于任何现存赛季的编号（账号 season_id 无外键，可以直接写一个旧值） */
const OLD_SEASON_ID = -7;

describe('赛季惰性加入（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let seasonId: number;
  const tag = `season-join-${Date.now()}`;
  const accountIds: string[] = [];

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'season_join');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    const season = await getCurrentSeason(pool);
    assert.ok(season, '播种后应有进行中的赛季');
    seasonId = season.id;
  });

  after(async () => {
    if (accountIds.length > 0) {
      await pool.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[])`, [accountIds]);
    }
    await pool?.end();
    await tmp?.drop();
  });

  /** 造一个“上一赛季”的老账号：有旧的掠夺台账、免战与最后在线时刻，但没有城池（沉睡号） */
  async function oldSeasonAccount(name: string, options: { withCity?: boolean } = {}): Promise<string> {
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash, plunder_total, self_truce_until, self_truce_used_at, last_online_at, newbie_until, season_id, agent_model)
       VALUES ($1, 'x', 500, now() + interval '1 hour', now() - interval '1 day', now() - interval '2 days', NULL, $2, 'claude-opus-5-5')
       RETURNING id`,
      [`${tag}-${name}`, OLD_SEASON_ID],
    );
    const id = res.rows[0].id as string;
    accountIds.push(id);
    if (options.withCity) {
      await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food) VALUES ($1, '残留城', 0, 0, 0)`, [id]);
    }
    return id;
  }

  test('老账号第一次加入：重置赛季字段、建主城（含自带建筑）、season_id 置为当前赛季', async () => {
    const id = await oldSeasonAccount('first');
    const before = Date.now();
    const client = await pool.connect();
    let result: Awaited<ReturnType<typeof joinCurrentSeason>>;
    try {
      await client.query('BEGIN');
      result = await joinCurrentSeason(client, id);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    assert.equal(result.joined, true);
    assert.equal(result.season.id, seasonId);

    const acc = (await pool.query(
      `SELECT season_id, plunder_total, newbie_until, self_truce_until, self_truce_used_at, last_online_at, agent_model
       FROM accounts WHERE id = $1`,
      [id],
    )).rows[0];
    assert.equal(acc.season_id, seasonId);
    assert.equal(Number(acc.plunder_total), 0);
    assert.ok(acc.newbie_until && new Date(acc.newbie_until).getTime() > before, '新手保护重新授予（未来时刻）');
    assert.equal(acc.self_truce_until, null);
    assert.equal(acc.self_truce_used_at, null);
    assert.equal(acc.last_online_at, null);
    assert.equal(acc.agent_model, 'claude-opus-5-5', '昵称 / Agent 自报模型等保留');

    const cities = (await pool.query(`SELECT id, name FROM cities WHERE account_id = $1`, [id])).rows;
    assert.equal(cities.length, 1, '建了且仅建了一座主城');
    assert.equal(cities[0].name, '主城');
    const buildings = (await pool.query(`SELECT kind, level FROM city_buildings WHERE city_id = $1`, [cities[0].id])).rows;
    assert.deepEqual(
      buildings.map((row) => [row.kind, row.level]),
      Object.entries(INITIAL_BUILDINGS),
      '自带建筑与开号一致',
    );
  });

  test('幂等：已在当前赛季的账号再次加入是空操作（不新建城、不重置字段）', async () => {
    const id = await oldSeasonAccount('idem');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await joinCurrentSeason(client, id);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await pool.query(`UPDATE accounts SET plunder_total = 42 WHERE id = $1`, [id]);
    const again = await enterCurrentSeason(pool, id);
    assert.equal(again.joined, false);
    const row = (await pool.query(`SELECT plunder_total, (SELECT count(*)::int FROM cities WHERE account_id = $1) AS cities FROM accounts WHERE id = $1`, [id])).rows[0];
    assert.equal(Number(row.plunder_total), 42, '已加入的账号不再被重置');
    assert.equal(row.cities, 1);
  });

  test('残留城池时不另建第二座主城（只重置赛季字段并置 season_id）', async () => {
    const id = await oldSeasonAccount('leftover', { withCity: true });
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      const result = await enterCurrentSeason(pool, id);
      assert.equal(result.joined, true);
    } finally {
      console.warn = warn;
    }
    const cities = (await pool.query(`SELECT name FROM cities WHERE account_id = $1`, [id])).rows;
    assert.deepEqual(cities.map((row) => row.name), ['残留城']);
    const season = (await pool.query(`SELECT season_id FROM accounts WHERE id = $1`, [id])).rows[0];
    assert.equal(season.season_id, seasonId);
  });

  test('注册（insertAccountWithCity）直接归入当前赛季，登录时不会再建第二座城', async () => {
    const client = await pool.connect();
    let id: string;
    try {
      await client.query('BEGIN');
      const created = await insertAccountWithCity(client, { username: `${tag}-signup`, passwordHash: null, signupIp: null });
      id = created.id;
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    accountIds.push(id);
    const acc = (await pool.query(`SELECT season_id FROM accounts WHERE id = $1`, [id])).rows[0];
    assert.equal(acc.season_id, seasonId);
    const result = await enterCurrentSeason(pool, id);
    assert.equal(result.joined, false);
    const cities = (await pool.query(`SELECT count(*)::int AS n FROM cities WHERE account_id = $1`, [id])).rows[0];
    assert.equal(cities.n, 1);
  });

  /** 以指定连接身份走 handleMessage（LOGIN），收集响应帧；账号登录后不做其他协议 */
  async function login(data: Record<string, unknown>): Promise<ResponseFrame> {
    const sent: ResponseFrame[] = [];
    const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw)), close: () => undefined } as never;
    const registry = new ConnectionRegistry();
    const conn: ConnInfo = { socket, ip: null, host: null, accountId: null, username: null, role: null, sessionId: null, connectedAt: new Date() };
    registry.add(conn);
    const ctx: HandlerContext = { pool, registry, passwordDisabledHosts: new Set() };
    await handleMessage(ctx, conn, JSON.stringify({ op: Op.LOGIN, seq: 1, data }));
    const frame = sent.find((f) => f.op === Op.LOGIN);
    assert.ok(frame?.ok, JSON.stringify(sent));
    return frame;
  }

  test('会话令牌登录（含第三方登录后的 LOGIN 令牌）：老账号登录即惰性加入，响应带 season', async () => {
    const id = await oldSeasonAccount('token');
    const token = generateSessionToken();
    await pool.query(
      `INSERT INTO sessions (account_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
      [id, hashSessionToken(token)],
    );
    const frame = await login({ token, asAgent: false });
    const data = frame.data as { accountId: string; season: { id: number; endsAt: string } };
    assert.equal(data.accountId, id);
    assert.equal(data.season.id, seasonId);
    const cities = (await pool.query(`SELECT count(*)::int AS n FROM cities WHERE account_id = $1`, [id])).rows[0];
    assert.equal(cities.n, 1, '登录路径上完成了建主城');
    const acc = (await pool.query(`SELECT season_id FROM accounts WHERE id = $1`, [id])).rows[0];
    assert.equal(acc.season_id, seasonId);
  });

  test('Agent 永久令牌登录同样惰性加入', async () => {
    const id = await oldSeasonAccount('agent');
    const token = generateAgentToken();
    await pool.query(`INSERT INTO agent_tokens (account_id, token_hash, token) VALUES ($1, $2, $3)`, [id, hashAgentToken(token), token]);
    const frame = await login({ token, asAgent: true });
    const data = frame.data as { role: string; season: { id: number } };
    assert.equal(data.role, 'agent');
    assert.equal(data.season.id, seasonId);
    const cities = (await pool.query(`SELECT count(*)::int AS n FROM cities WHERE account_id = $1`, [id])).rows[0];
    assert.equal(cities.n, 1);
  });
});
