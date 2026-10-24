// 联盟榜与联盟信息（v70，AISLG-185）：联盟势力公式、成员不足 5 人不上榜、按势力降序且同分有稳定次序、
// GET_ALLIANCE 的 power / rank 与榜单一致、Agent 能读榜与联盟信息、换季存档前三进名人堂且已有榜不受影响。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（在其所指服务器上另建一次性数据库，别指向开发库），否则跳过。
// 不生成整张世界（1000 × 1000 太慢）：夹具的城池与野地直接按坐标插入，坐标互不冲突即可。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { alliancePowerOf, computeAlliancePowers } from '../common/src/alliance-db';
import { FAMOUS_CITY_NAMES } from '../common/src/famous-city';
import { Op } from '../common/src/protocol';
import { ALLIANCE_POWER_FAMOUS_WEIGHT, ALLIANCE_POWER_GOVERNMENT_WEIGHT, ALLIANCE_POWER_TERRITORY_WEIGHT, ALLIANCE_RANK_MIN_MEMBERS } from '../common/src/protocol-alliance';
import { RESET_TABLES } from '../common/src/season-tables';
import { getCurrentSeason, queryHallOfFame } from '../common/src/season-db';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleAllianceOp } from '../api/src/handlers-alliance';
import { handleGetLeaderboard } from '../api/src/handlers-leaderboard';
import { handleGetHallOfFame } from '../api/src/handlers-season';
import { refreshLeaderboards } from '../worker/src/leaderboard-tick';
import { ARCHIVE_ALLIANCE_TOP_N, archiveSeason } from '../worker/src/season-archive';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const baseUrl = process.env.TEST_DATABASE_URL;

interface SentFrame {
  op: number;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string };
}

describe('联盟榜与联盟信息（需 TEST_DATABASE_URL）', { skip: baseUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let tmp: TempDatabase;
  let pool: pg.Pool;
  let counter = 0;
  const tag = `lb${Date.now()}`;

  const sent: SentFrame[] = [];
  const registry = new ConnectionRegistry();
  const ctx = { pool: undefined as unknown as pg.Pool, registry } as unknown as HandlerContext;
  /** 构造连接（玩家或 Agent）；socket 把回包收进 sent */
  function connOf(accountId: string | null, role: 'player' | 'agent'): ConnInfo {
    const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw)), close: () => undefined } as never;
    return { socket, ip: null, host: null, accountId, username: null, role, sessionId: null, connectedAt: new Date() } as unknown as ConnInfo;
  }
  const last = (): SentFrame => sent[sent.length - 1];

  /** 一个账号（只有用户名与密码哈希，城池另建） */
  async function account(): Promise<string> {
    counter += 1;
    const res = await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-${counter}`]);
    return res.rows[0].id as string;
  }

  /**
   * 一座城（主城或分城）：驻军 10 个民兵；agoMin 越大越早建（决定谁是主城）；
   * famous 给出名城名即为名城分城；gov 给出官府等级才建官府（不给则没有官府）。
   */
  async function city(accountId: string, opts: { agoMin: number; famous?: string; gov?: number }): Promise<string> {
    counter += 1;
    const x = 100 + counter;
    const res = await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y, famous_name, created_at)
       VALUES ($1, $2, 5000, 5000, 5000, 5000, 5000, $3, 100, $4, now() - ($5::int * interval '1 minute')) RETURNING id`,
      [accountId, `${tag}城${counter}`, x, opts.famous ?? null, opts.agoMin],
    );
    const cityId = res.rows[0].id as string;
    await pool.query(`INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id) VALUES ($1, 100, 'plain', 'city', 0, $2)`, [x, cityId]);
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 10)`, [cityId]);
    if (opts.gov !== undefined) {
      await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', $2)`, [cityId, opts.gov]);
    }
    return cityId;
  }

  /** 给城添 n 块占领野地（坐标在 5000 以外，与城池互不冲突） */
  async function wild(cityId: string, n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      counter += 1;
      await pool.query(
        `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id) VALUES ($1, 200, 'forest', 'wilderness', 2, $2)`,
        [5000 + counter, cityId],
      );
    }
  }

  /** 建联盟并把账号按顺序加入（第一位为盟主） */
  async function alliance(name: string, members: string[]): Promise<string> {
    const res = await pool.query(`INSERT INTO alliances (name, leader_id) VALUES ($1, $2) RETURNING id`, [name, members[0]]);
    const id = res.rows[0].id as string;
    for (const [i, accountId] of members.entries()) {
      await pool.query(`INSERT INTO alliance_members (account_id, alliance_id, role) VALUES ($1, $2, $3)`, [accountId, id, i === 0 ? 'leader' : 'member']);
    }
    return id;
  }

  // 账号与联盟的夹具（跨用例复用）
  let dragonId: string;
  let dragonMember: string;
  let tigerId: string;
  let phoenixId: string;
  let ghostId: string;
  let ghostMember: string;
  let outsider: string;

  let dragonLeaderId = '';
  let dragonLeaderName = '';
  let tigerLeader = { leader_id: '', username: '' };

  before(async () => {
    tmp = await createTempDatabase(baseUrl as string, 'alliance_lb');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    (ctx as { pool: pg.Pool }).pool = pool;

    // Dragon（5 人，势力 = 野地 6 + 名城 1 × 10 + 官府 10 = 26）
    const m1 = await account();
    const m2 = await account();
    const m3 = await account();
    const m4 = await account(); // 没有主城
    const m5 = await account();
    dragonMember = m2;
    const c1 = await city(m1, { agoMin: 10, gov: 5 });
    await wild(c1, 2);
    const c2 = await city(m2, { agoMin: 9, gov: 3 }); // 主城（最早建）
    await city(m2, { agoMin: 1, famous: '洛阳' }); // 分城：名城，不是主城
    await wild(c2, 1);
    await city(m3, { agoMin: 8 }); // 主城没有官府
    const c5 = await city(m5, { agoMin: 7, gov: 2 });
    await wild(c5, 3);
    dragonId = await alliance('Dragon', [m1, m2, m3, m4, m5]);
    dragonLeaderId = m1;
    dragonLeaderName = (await pool.query(`SELECT username FROM accounts WHERE id = $1`, [m1])).rows[0].username as string;

    // Tiger（5 人，势力 = 野地 40）
    const t = [await account(), await account(), await account(), await account(), await account()];
    const tc = await city(t[0], { agoMin: 10 });
    await wild(tc, 40);
    for (const accountId of t.slice(1)) {
      await city(accountId, { agoMin: 5 });
    }
    tigerId = await alliance('Tiger', t);
    tigerLeader = (await pool.query(`SELECT al.leader_id, a.username FROM alliances al JOIN accounts a ON a.id = al.leader_id WHERE al.id = $1`, [tigerId])).rows[0] as typeof tigerLeader;

    // Phoenix（5 人，势力 = 野地 8 + 名城 1 × 10 + 官府 8 = 26，与 Dragon 同分，按名字排在 Dragon 之后）
    const p = [await account(), await account(), await account(), await account(), await account()];
    await city(p[0], { agoMin: 10, famous: '长安' });
    const pc = await city(p[1], { agoMin: 9, gov: 8 });
    await wild(pc, 8);
    for (const accountId of p.slice(2)) {
      await city(accountId, { agoMin: 5 });
    }
    phoenixId = await alliance('Phoenix', p);

    // Ghost（只有 4 人：势力 60 但不上榜，名次为 null）
    const g = [await account(), await account(), await account(), await account()];
    ghostMember = g[0];
    const gc = await city(g[0], { agoMin: 10 });
    await wild(gc, 60);
    for (const accountId of g.slice(1)) {
      await city(accountId, { agoMin: 5 });
    }
    ghostId = await alliance('Ghost', g);

    // 不在任何联盟的账号
    outsider = await account();
    await city(outsider, { agoMin: 5 });
  });

  after(async () => {
    await pool.end();
    await tmp.drop();
  });

  test('势力公式：野地数 × 1 + 名城数 × 10 + 成员主城官府等级之和 × 1，没有主城的成员按 0', async () => {
    assert.equal(ALLIANCE_POWER_TERRITORY_WEIGHT, 1);
    assert.equal(ALLIANCE_POWER_FAMOUS_WEIGHT, 10);
    assert.equal(ALLIANCE_POWER_GOVERNMENT_WEIGHT, 1);
    assert.equal(alliancePowerOf({ territory: 6, famous: 1, government: 10 }), 26);

    const powers = await computeAlliancePowers(pool, [dragonId]);
    // 野地：m1 2 + m2 1 + m5 3；名城：m2 的洛阳（不是主城，但算名城）；官府：主城 5 + 3 + 0（m3 没有官府）+ 0（m4 无城）+ 2
    assert.deepEqual(powers.get(dragonId), { territory: 6, famous: 1, government: 10, power: 26 });

    const all = await computeAlliancePowers(pool, null);
    assert.equal(all.get(tigerId)?.power, 40);
    assert.equal(all.get(ghostId)?.power, 60);
    assert.equal(all.size, 4, '只有四个联盟（不在联盟里的账号不构成联盟）');
    assert.equal((await computeAlliancePowers(pool, [])).size, 0);
  });

  test('榜单：成员不足 5 人不上榜；按势力降序，同势力按联盟名稳定排序；快照里有名次', async () => {
    await refreshLeaderboards(pool);
    sent.length = 0;
    await handleGetLeaderboard(ctx, connOf(dragonMember, 'player'), Op.GET_LEADERBOARD, 1, { kind: 'alliance' });
    const data = last().data as { entries: unknown[]; me: unknown; allianceEntries: Array<Record<string, unknown>> };
    assert.equal(last().ok, true);
    assert.deepEqual(data.entries, [], '联盟榜的条目不走玩家 entries');
    assert.deepEqual(
      data.allianceEntries.map((e) => e.name),
      ['Tiger', 'Dragon', 'Phoenix'],
      'Ghost 只有 4 人，即使势力更高也不上榜',
    );
    assert.deepEqual(data.allianceEntries[1], {
      rank: 2,
      allianceId: dragonId,
      name: 'Dragon',
      leader: { accountId: dragonLeaderId, username: dragonLeaderName },
      memberCount: 5,
      value: 26,
    });
    assert.deepEqual(data.allianceEntries[2].value, 26);
    assert.equal(ALLIANCE_RANK_MIN_MEMBERS, 5);
    assert.deepEqual(data.me, { rank: 2, value: 26 }, '我所在的 Dragon 为第 2 名');
  });

  test('榜单：没有联盟的账号 me 为 null；玩家三榜照常有数据', async () => {
    sent.length = 0;
    await handleGetLeaderboard(ctx, connOf(outsider, 'player'), Op.GET_LEADERBOARD, 2, { kind: 'alliance' });
    assert.equal((last().data as { me: unknown }).me, null);

    sent.length = 0;
    await handleGetLeaderboard(ctx, connOf(dragonMember, 'player'), Op.GET_LEADERBOARD, 3, { kind: 'power' });
    const power = last().data as { entries: unknown[]; allianceEntries?: unknown };
    assert.equal(last().ok, true);
    assert.ok(power.entries.length > 0, '玩家战力榜仍有条目');
    assert.equal(power.allianceEntries, undefined, '非联盟榜不带 allianceEntries');
  });

  test('GET_ALLIANCE：power 与榜单同口径，rank 取快照名次；未上榜为 null；查自己的联盟同样带出', async () => {
    sent.length = 0;
    await handleAllianceOp(ctx, connOf(dragonMember, 'player'), Op.GET_ALLIANCE, 10, { allianceId: dragonId });
    const dragon = (last().data as { alliance: { power: number; rank: number | null; memberCount: number } }).alliance;
    assert.equal(last().ok, true);
    assert.equal(dragon.power, 26);
    assert.equal(dragon.rank, 2);
    assert.equal(dragon.memberCount, 5);

    sent.length = 0;
    await handleAllianceOp(ctx, connOf(dragonMember, 'player'), Op.GET_ALLIANCE, 11, {});
    const mine = (last().data as { alliance: { id: string; power: number; rank: number | null } }).alliance;
    assert.equal(mine.id, dragonId);
    assert.equal(mine.power, 26);
    assert.equal(mine.rank, 2);

    sent.length = 0;
    await handleAllianceOp(ctx, connOf(ghostMember, 'player'), Op.GET_ALLIANCE, 12, { allianceId: ghostId });
    const ghost = (last().data as { alliance: { power: number; rank: number | null } }).alliance;
    assert.equal(ghost.power, 60, '势力现算，不因人数不足而为 0');
    assert.equal(ghost.rank, null, '成员不足 5 人没有名次');
  });

  test('Agent 能读联盟榜与联盟信息（查询类协议不拦 Agent）', async () => {
    sent.length = 0;
    await handleGetLeaderboard(ctx, connOf(null, 'agent'), Op.GET_LEADERBOARD, 20, { kind: 'alliance' });
    assert.equal(last().ok, true);
    assert.deepEqual(
      ((last().data as { allianceEntries: Array<{ name: string }> }).allianceEntries).map((e) => e.name),
      ['Tiger', 'Dragon', 'Phoenix'],
    );

    sent.length = 0;
    await handleAllianceOp(ctx, connOf(null, 'agent'), Op.GET_ALLIANCE, 21, { allianceId: phoenixId });
    assert.equal(last().ok, true, `Agent 查询联盟信息应成功，实际 ${JSON.stringify(last().error)}`);
    const phoenix = (last().data as { alliance: { power: number; rank: number | null } }).alliance;
    assert.equal(phoenix.power, 26);
    assert.equal(phoenix.rank, 3);
  });

  test('换季存档：联盟榜前三进名人堂（盟主、势力、成员数、联盟名）；个人榜不受影响；联盟不发称号', async () => {
    assert.ok(RESET_TABLES.includes('alliance_leaderboard_snapshots'), '联盟榜快照换季清空');
    assert.equal(ARCHIVE_ALLIANCE_TOP_N, 3);

    // 换季前的个人战力榜前三（存档应与之完全一致）
    await refreshLeaderboards(pool);
    const before = await pool.query(`SELECT rank, username, value FROM leaderboard_snapshots WHERE kind = 'power' ORDER BY rank LIMIT 50`);
    assert.ok(before.rowCount && before.rowCount > 0, '个人战力榜有快照');

    // 一个已结束的赛季作为存档的归属（不动当前赛季）
    const season = await pool.query(
      `INSERT INTO seasons (name, status, start_at, end_at, seed, time_scale, ended_at)
       VALUES ($1, 'ended', now() - interval '30 days', now() - interval '1 day', 1, 50, now() - interval '1 day') RETURNING id`,
      [`${tag}-season`],
    );
    const seasonId = Number(season.rows[0].id);
    const active = await getCurrentSeason(pool);
    assert.ok(active, '播种后应有当前赛季');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await archiveSeason(client, seasonId, `${tag}赛季`);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const page = await queryHallOfFame(pool, seasonId, 'alliance', 1);
    assert.equal(page.total, 3, '只存前三');
    assert.deepEqual(page.entries.map((e) => e.allianceName), ['Tiger', 'Dragon', 'Phoenix']);
    assert.deepEqual(page.entries[0], {
      rank: 1,
      accountId: tigerLeader.leader_id,
      username: tigerLeader.username,
      cityName: null,
      value: 40,
      agentModel: null,
      allianceId: tigerId,
      allianceName: 'Tiger',
      memberCount: 5,
    });
    assert.equal(page.entries[1].allianceId, dragonId);
    assert.equal(page.entries[1].value, 26);
    assert.equal(page.entries[2].memberCount, 5);

    // 个人榜存档与换季前的快照逐行一致
    const archivedPower = await queryHallOfFame(pool, seasonId, 'power', 1);
    const expected = before.rows.slice(0, 20).map((row) => ({ rank: Number(row.rank), username: row.username, value: Number(row.value) }));
    assert.deepEqual(
      archivedPower.entries.map((e) => ({ rank: e.rank, username: e.username, value: e.value })),
      expected,
      '个人战力榜存档不受联盟榜影响',
    );
    assert.ok(archivedPower.entries.every((e) => e.allianceId === null && e.allianceName === null && e.memberCount === null));

    // 联盟不发称号：荣誉表里没有 alliance 种类
    const honors = await pool.query(`SELECT count(*)::int AS n FROM season_honors WHERE season_id = $1 AND kind = 'alliance'`, [seasonId]);
    assert.equal(honors.rows[0].n, 0);
    const powerHonor = await pool.query(`SELECT count(*)::int AS n FROM season_honors WHERE season_id = $1 AND kind = 'power'`, [seasonId]);
    assert.equal(powerHonor.rows[0].n, Math.min(3, before.rowCount ?? 0), '个人榜前三照常得称号');

    // GET_HALL_OF_FAME 能查 alliance 榜（缺省取最近一个已结束赛季）
    sent.length = 0;
    await handleGetHallOfFame(ctx, connOf(null, 'agent'), Op.GET_HALL_OF_FAME, 30, { kind: 'alliance' });
    assert.equal(last().ok, true);
    const hall = last().data as { seasonId: number; kind: string; entries: Array<{ allianceName: string }>; total: number };
    assert.equal(hall.seasonId, seasonId);
    assert.equal(hall.kind, 'alliance');
    assert.equal(hall.total, 3);
    assert.deepEqual(hall.entries.map((e) => e.allianceName), ['Tiger', 'Dragon', 'Phoenix']);

    // 重复存档是幂等的（先删后写）
    const again = await pool.connect();
    try {
      await again.query('BEGIN');
      await archiveSeason(again, seasonId, `${tag}赛季`);
      await again.query('COMMIT');
    } finally {
      again.release();
    }
    assert.equal((await queryHallOfFame(pool, seasonId, 'alliance', 1)).total, 3);
  });
});
