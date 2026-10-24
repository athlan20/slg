// 名人堂与赛季查询（AISLG-134）：queryHallOfFame 的分页与模型榜、荣誉读取、GET_SEASON / GET_HALL_OF_FAME 的参数与默认值。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { HALL_PAGE_SIZE, getCurrentSeason, getMyHonors, queryHallOfFame } from '../common/src/season-db';
import { Op, type ResponseFrame } from '../common/src/protocol';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleGetHallOfFame, handleGetSeason } from '../api/src/handlers-season';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('名人堂与赛季查询（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let seasonId: number;
  let accountId: string;
  const tag = `season-hall-${Date.now()}`;
  const sent: ResponseFrame[] = [];
  const registry = new ConnectionRegistry();
  const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw)), close: () => undefined } as never;
  const conn: ConnInfo = { socket, ip: null, host: null, accountId: null, username: null, role: null, sessionId: null, connectedAt: new Date() };

  before(async () => {
    tmp = await createTempDatabase(dbUrl as string, 'season_hall');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    // 一个已结束的测试赛季（名称带 tag，清理时按 id 删）：力量榜 25 条、模型榜 3 条
    const ins = await pool.query(
      `INSERT INTO seasons (name, status, start_at, end_at, seed, time_scale, ended_at)
       VALUES ($1, 'ended', now() - interval '30 days', now() - interval '2 days', 1, 50, now() - interval '2 days') RETURNING id`,
      [tag],
    );
    seasonId = Number(ins.rows[0].id);
    for (let rank = 1; rank <= 25; rank += 1) {
      await pool.query(
        `INSERT INTO season_archives (season_id, kind, rank, account_id, username, city_name, value, agent_model)
         VALUES ($1, 'power', $2, NULL, $3, '主城', $4, NULL)`,
        [seasonId, rank, `${tag}-p${rank}`, 1000 - rank],
      );
    }
    await pool.query(
      `INSERT INTO season_archive_models (season_id, rank, model_id, model_label, players, top_avg_value, top_player_name, top_player_value)
       VALUES ($1, 1, 'claude-opus-5-5', 'Claude Opus 5.5', 4, 900, 'alpha', 950),
              ($1, 2, 'other', '其他', 2, 300, NULL, NULL),
              ($1, 3, 'undeclared', '未声明', 1, 100, 'beta', 100)`,
      [seasonId],
    );
    const acc = await pool.query(
      `INSERT INTO accounts (username, password_hash, season_id) VALUES ($1, 'x', (SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1)) RETURNING id`,
      [`${tag}-acc`],
    );
    accountId = acc.rows[0].id as string;
    await pool.query(
      `INSERT INTO season_honors (account_id, season_id, kind, rank, title) VALUES ($1, $2, 'power', 1, '第 N 赛季·力量榜冠军')`,
      [accountId, seasonId],
    );
    (conn as { accountId: string | null }).accountId = accountId;
  });

  after(async () => {
    await pool.query(`DELETE FROM season_honors WHERE season_id = $1`, [seasonId]);
    await pool.query(`DELETE FROM season_archive_models WHERE season_id = $1`, [seasonId]);
    await pool.query(`DELETE FROM season_archives WHERE season_id = $1`, [seasonId]);
    await pool.query(`DELETE FROM seasons WHERE id = $1`, [seasonId]);
    await pool.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
    await pool.end();
    await tmp?.drop();
  });

  test('个人榜分页：每页 20 条，按名次排序，total 为总条数', async () => {
    assert.equal(HALL_PAGE_SIZE, 20);
    const first = await queryHallOfFame(pool, seasonId, 'power', 1);
    assert.equal(first.entries.length, 20);
    assert.equal(first.entries[0].rank, 1);
    assert.equal(first.entries[19].rank, 20);
    assert.equal(first.total, 25);
    assert.deepEqual(first.modelEntries, []);

    const second = await queryHallOfFame(pool, seasonId, 'power', 2);
    assert.deepEqual(second.entries.map((e) => e.rank), [21, 22, 23, 24, 25]);
    assert.equal(second.entries[0].username, `${tag}-p21`);
    assert.equal(second.entries[0].value, 979);

    const beyond = await queryHallOfFame(pool, seasonId, 'power', 9);
    assert.deepEqual(beyond.entries, []);
    assert.equal(beyond.total, 25);
  });

  test('模型榜进 modelEntries（entries 为空），字段与 ModelLeaderboardEntryView 同口径', async () => {
    const result = await queryHallOfFame(pool, seasonId, 'model', 1);
    assert.deepEqual(result.entries, []);
    assert.equal(result.total, 3);
    assert.deepEqual(result.modelEntries[0], {
      rank: 1,
      modelId: 'claude-opus-5-5',
      label: 'Claude Opus 5.5',
      players: 4,
      value: 900,
      topPlayer: { username: 'alpha', value: 950 },
    });
    assert.equal(result.modelEntries[1].topPlayer, null, '组内没有上榜玩家时为 null');
  });

  test('没有存档的榜种返回空结果（不报错）', async () => {
    const result = await queryHallOfFame(pool, seasonId, 'territory', 1);
    assert.deepEqual(result, { entries: [], modelEntries: [], total: 0 });
  });

  test('荣誉称号按赛季读取；当前赛季存在', async () => {
    const honors = await getMyHonors(pool, accountId);
    assert.deepEqual(honors, [{ seasonId, kind: 'power', rank: 1, title: '第 N 赛季·力量榜冠军' }]);
    const current = await getCurrentSeason(pool);
    assert.ok(current && current.status === 'active');
  });

  test('GET_HALL_OF_FAME 缺省取最近一个已结束赛季；非法参数返回 INVALID_PARAMS', async () => {
    const ctx = { pool, registry } as unknown as HandlerContext;
    sent.length = 0;
    await handleGetHallOfFame(ctx, conn, Op.GET_HALL_OF_FAME, 1, {});
    const ok = sent[sent.length - 1];
    assert.equal(ok.ok, true);
    const body = ok.data as { seasonId: number; kind: string; total: number; seasons: Array<{ id: number }> };
    assert.equal(body.seasonId, seasonId, '最近一个已结束赛季即本测试赛季');
    assert.equal(body.kind, 'power');
    assert.equal(body.total, 25);
    assert.ok(body.seasons.some((s) => s.id === seasonId));

    sent.length = 0;
    await handleGetHallOfFame(ctx, conn, Op.GET_HALL_OF_FAME, 2, { kind: 'bogus' });
    assert.equal(sent[sent.length - 1].error?.code, 'INVALID_PARAMS');

    sent.length = 0;
    await handleGetHallOfFame(ctx, conn, Op.GET_HALL_OF_FAME, 3, { seasonId: 999_999_999 });
    assert.equal(sent[sent.length - 1].error?.code, 'INVALID_PARAMS');

    sent.length = 0;
    await handleGetHallOfFame(ctx, conn, Op.GET_HALL_OF_FAME, 4, { seasonId: 'x' });
    assert.equal(sent[sent.length - 1].error?.code, 'INVALID_PARAMS');
  });

  test('GET_SEASON 返回当前赛季、维护态、荣誉与 joined', async () => {
    const ctx = { pool, registry } as unknown as HandlerContext;
    sent.length = 0;
    await handleGetSeason(ctx, conn, Op.GET_SEASON, 9);
    const frame = sent[sent.length - 1];
    assert.equal(frame.ok, true);
    const data = frame.data as {
      season: { id: number; remainingSec: number; timeScale: number; status: string };
      maintenance: boolean;
      myHonors: Array<{ seasonId: number; rank: number }>;
      joined: boolean;
    };
    const current = await getCurrentSeason(pool);
    assert.equal(data.season.id, current?.id);
    assert.equal(data.season.status, 'active');
    assert.ok(data.season.remainingSec > 0);
    assert.equal(data.maintenance, false);
    assert.equal(data.joined, true, '账号创建时即归入当前赛季');
    assert.deepEqual(data.myHonors.map((h) => [h.seasonId, h.rank]), [[seasonId, 1]]);
  });

});
