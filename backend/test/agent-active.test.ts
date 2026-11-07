// Agent 算活跃（AISLG-236）：人玩或 Agent 玩都算活跃，只有本人和 Agent 都 7 天没上线才算不活跃。
// 覆盖验收口径：Agent 令牌登录刷新 last_active_at、Agent 持续在线按心跳周期刷新、Agent 断线刷新一次；
// 只用 Agent 玩的盟主不被自动转让、本人与 Agent 都超期照常转让；离线日报起点 last_online_at 仍只由玩家断线写。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（在其所指服务器上另建一次性数据库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { Op, type ResponseFrame } from '../common/src/protocol';
import { ALLIANCE_LEADER_INACTIVE_MS } from '../common/src/protocol-alliance';
import { getMembership, transferInactiveLeaders } from '../common/src/alliance-db';
import { getCurrentSeason } from '../common/src/season-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleConnectionClosed, handleMessage, type HandlerContext } from '../api/src/handlers';
import { handleGetOfflineReport } from '../api/src/handlers-offline';
import { generateAgentToken, hashAgentToken } from '../api/src/agent-token';
import { onlineActiveAccountIds, startActiveHeartbeat } from '../api/src/active-heartbeat';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;
/** 「刚刚刷新过」的宽容窗口：fire-and-forget 的写入与测试断言之间有几毫秒延迟 */
const FRESH_MS = 60 * 1000;

describe('Agent 算活跃（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let tmp: TempDatabase | undefined;
  let pool: pg.Pool;
  /** 当前赛季 id：账号直接挂在赛季里，登录时的偷懒加入才不会重置 last_online_at（否则离线日报用例量不到） */
  let seasonId: number;
  let seq = 0;

  interface Row { last_active_at: Date; last_online_at: Date }
  interface LoginResult { registry: ConnectionRegistry; conn: ConnInfo; frames: ResponseFrame[] }

  /** 建账号：last_active_at / last_online_at 都给 ageMs 之前（默认 10 天前，即已超过 7 天阈值） */
  async function makeAccount(label: string, ageMs = 10 * DAY): Promise<string> {
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash, last_active_at, last_online_at, season_id)
       VALUES ($1, 'x', now() - ($2::bigint * interval '1 millisecond'), now() - ($2::bigint * interval '1 millisecond'), $3)
       RETURNING id`,
      [`agent-active-${label}-${(seq += 1)}`, ageMs, seasonId],
    );
    return res.rows[0].id as string;
  }

  const timesOf = async (accountId: string): Promise<Row> =>
    (await pool.query(`SELECT last_active_at, last_online_at FROM accounts WHERE id = $1`, [accountId])).rows[0] as Row;
  const setActiveAt = (accountId: string, ms: number): Promise<unknown> =>
    pool.query(`UPDATE accounts SET last_active_at = now() - ($2::bigint * interval '1 millisecond') WHERE id = $1`, [accountId, ms]);

  /** 给账号配一个永久 Agent 令牌，返回令牌原文 */
  async function agentToken(accountId: string): Promise<string> {
    const token = generateAgentToken();
    await pool.query(`INSERT INTO agent_tokens (account_id, token_hash, token) VALUES ($1, $2, $3)`, [
      accountId,
      hashAgentToken(token),
      token,
    ]);
    return token;
  }

  /** 走真实的 LOGIN 协议登录（Agent 令牌 / 会话令牌都可用）；返回绑定后的连接与收到的帧 */
  async function login(data: Record<string, unknown>): Promise<LoginResult> {
    const frames: ResponseFrame[] = [];
    const socket = {
      readyState: 1,
      OPEN: 1,
      send: (raw: string) => frames.push(JSON.parse(raw) as ResponseFrame),
      close: () => undefined,
    } as never;
    const registry = new ConnectionRegistry();
    const conn: ConnInfo = {
      socket, ip: null, host: null, accountId: null, username: null, role: null, sessionId: null, connectedAt: new Date(),
    };
    registry.add(conn);
    const ctx: HandlerContext = { pool, registry, passwordDisabledHosts: new Set() };
    await handleMessage(ctx, conn, JSON.stringify({ op: Op.LOGIN, seq: 1, data }));
    const frame = frames.find((f) => f.op === Op.LOGIN);
    assert.ok(frame?.ok, `登录失败：${JSON.stringify(frames)}`);
    return { registry, conn, frames };
  }

  /** 等 last_active_at 晚于 floor（登录 / 断线的活跃刷新是异步落库）；超时报错 */
  async function waitActiveAfter(accountId: string, floor: Date): Promise<Date> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const row = await timesOf(accountId);
      if (row.last_active_at && row.last_active_at.getTime() > floor.getTime()) {
        return row.last_active_at;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('last_active_at 没有被刷新');
  }

  /** 等登录路径的异步刷新落库：轮询到 last_active_at 是「刚刚」 */
  async function waitFreshActive(accountId: string): Promise<Date> {
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const row = await timesOf(accountId);
      if (row.last_active_at && Date.now() - row.last_active_at.getTime() < FRESH_MS) {
        return row.last_active_at;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error('last_active_at 没有被刷新到刚刚');
  }

  const expectFresh = (at: Date): void => {
    assert.ok(Date.now() - at.getTime() < FRESH_MS, `活跃时刻不够新：${at.toISOString()}`);
  };

  /** 建一个联盟：盟主 + 一名副盟主（成员关系直接落库，避免走建盟的官府 / 金币夹具） */
  async function makeAlliance(leaderId: string, label: string): Promise<{ id: string; vice: string }> {
    const res = await pool.query(`INSERT INTO alliances (name, leader_id) VALUES ($1, $2) RETURNING id`, [
      `agent活跃-${label}-${(seq += 1)}`,
      leaderId,
    ]);
    const id = res.rows[0].id as string;
    await pool.query(`INSERT INTO alliance_members (account_id, alliance_id, role) VALUES ($1, $2, 'leader')`, [leaderId, id]);
    const vice = await makeAccount(`vice-${label}`, 2 * DAY);
    await pool.query(`INSERT INTO alliance_members (account_id, alliance_id, role) VALUES ($1, $2, 'vice')`, [vice, id]);
    return { id, vice };
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'agent_active');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    const season = await getCurrentSeason(pool);
    assert.ok(season, '播种后应有进行中的赛季');
    seasonId = season.id;
  });
  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  test('口径 1：只用 Agent 令牌登录也刷新 last_active_at，last_online_at 不动', async () => {
    const id = await makeAccount('agent-login');
    const token = await agentToken(id);
    const before = await timesOf(id);
    const { conn } = await login({ token, asAgent: true });
    assert.equal(conn.role, 'agent');
    expectFresh(await waitActiveAfter(id, before.last_active_at));
    const afterRow = await timesOf(id);
    assert.equal(afterRow.last_online_at.getTime(), before.last_online_at.getTime(), '登录不写 last_online_at');
  });

  test('口径 2：Agent 一直在线不断开，在线心跳按周期刷新 last_active_at', async () => {
    const id = await makeAccount('agent-heartbeat');
    const token = await agentToken(id);
    const { registry } = await login({ token, asAgent: true });
    // 登录那一次刷新先落库，再把活跃时刻退回 2 小时前，只留心跳这条路
    await waitFreshActive(id);
    await setActiveAt(id, 2 * 3600 * 1000);
    const before = await timesOf(id);
    assert.deepEqual(onlineActiveAccountIds({ registry }), [id], '只有 Agent 连接的账号也算在线');
    const timer = startActiveHeartbeat({ pool, registry }, 25);
    try {
      expectFresh(await waitActiveAfter(id, before.last_active_at));
    } finally {
      clearInterval(timer);
    }
    assert.equal(registry.connectionsOf(id).length, 1, '全程没有断线');
  });

  test('口径 3：Agent 断线刷新一次 last_active_at，且不写 last_online_at', async () => {
    const id = await makeAccount('agent-close');
    const token = await agentToken(id);
    const { registry, conn } = await login({ token, asAgent: true });
    await waitFreshActive(id);
    await setActiveAt(id, 3 * DAY);
    const before = await timesOf(id);
    const ctx = { pool, registry } as HandlerContext;
    await handleConnectionClosed(ctx, conn);
    expectFresh(await waitActiveAfter(id, before.last_active_at));
    const afterRow = await timesOf(id);
    assert.equal(afterRow.last_online_at.getTime(), before.last_online_at.getTime(), 'Agent 断线不写 last_online_at');
    assert.equal(registry.connectionsOf(id).length, 0);
  });

  test('口径 4：盟主只用 Agent 玩且 Agent 7 天内上线过，盟主位不被转走', async () => {
    const leader = await makeAccount('agent-leader');
    const { id, vice } = await makeAlliance(leader, 'Agent玩');
    // 本人（网页）已经 8 天没上线，只有 Agent 刚刚登录（7 天内活跃）
    await pool.query(`UPDATE accounts SET last_online_at = now() - interval '8 days' WHERE id = $1`, [leader]);
    const token = await agentToken(leader);
    const { registry, conn } = await login({ token, asAgent: true });
    expectFresh(await waitFreshActive(leader));
    // Agent 登录只刷 last_active_at：本人的离线时刻仍是 8 天前（离线日报起点不变）
    assert.ok(Date.now() - (await timesOf(leader)).last_online_at.getTime() >= 8 * DAY - 60_000);

    const moves = await transferInactiveLeaders(pool, ALLIANCE_LEADER_INACTIVE_MS);
    assert.ok(!moves.some((m) => m.allianceId === id), '只用 Agent 玩的盟主不应被转让');
    assert.equal((await getMembership(pool, leader))?.role, 'leader');
    assert.equal((await getMembership(pool, vice))?.role, 'vice');
    await handleConnectionClosed({ pool, registry } as HandlerContext, conn);
  });

  test('口径 5：玩家本人和 Agent 都超过 7 天没上线，盟主位照常转让', async () => {
    const leader = await makeAccount('stale-leader');
    const { id, vice } = await makeAlliance(leader, '都不活跃');
    // 最后活跃（含 Agent 登录）已是 8 天前，离线也是 9 天前：两边都超期
    await pool.query(
      `UPDATE accounts SET last_active_at = now() - interval '8 days', last_online_at = now() - interval '9 days' WHERE id = $1`,
      [leader],
    );
    const moves = await transferInactiveLeaders(pool, ALLIANCE_LEADER_INACTIVE_MS);
    const mine = moves.filter((m) => m.allianceId === id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].to, vice);
    assert.equal((await getMembership(pool, vice))?.role, 'leader');
    assert.equal((await getMembership(pool, leader))?.role, 'member');
  });

  test('口径 6：只有 Agent 上线时，离线日报的时间起点仍是玩家本人上次离线', async () => {
    const id = await makeAccount('report-owner');
    // 玩家本人 3 天前离线并关掉网页，Agent 刚刚登录且一直在线
    await pool.query(
      `UPDATE accounts SET last_online_at = now() - interval '3 days', last_active_at = now() - interval '3 days' WHERE id = $1`,
      [id],
    );
    const token = await agentToken(id);
    const { registry, conn, frames } = await login({ token, asAgent: true });
    expectFresh(await waitFreshActive(id));

    await handleGetOfflineReport({ pool, registry } as HandlerContext, conn, Op.GET_OFFLINE_REPORT, 99);
    const frame = frames.find((f) => f.op === Op.GET_OFFLINE_REPORT);
    assert.ok(frame?.ok, `GET_OFFLINE_REPORT 失败：${JSON.stringify(frames)}`);
    const offline = (frame.data as { offline: { seconds: number } }).offline;
    // 起点是 last_online_at（3 天前），不是 Agent 刚刷新的活跃时刻
    assert.ok(offline.seconds >= 3 * 86400 - 60, `离线时长应约 3 天，实际 ${offline.seconds} 秒`);
    assert.ok(offline.seconds <= 3 * 86400 + 300, `离线时长应约 3 天，实际 ${offline.seconds} 秒`);
  });
});
