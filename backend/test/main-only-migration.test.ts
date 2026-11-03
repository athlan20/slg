// 酒馆 / 书院只在主城（v87，AISLG-217）的存量数据迁移与使用侧口径：迁移取最高等级、分城删除、
// 分城排队取消并返还；招募 / 刷新候选 / 研究一律按主城（请求里的 cityId 忽略）；换主城后建筑互换、候选清空。
// 验收口径 3–5。需 TEST_DATABASE_URL（一次性临时库，别指向开发库）。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { migrateMainOnlyBuildings } from '../common/src/main-only-db';
import { BUILDING_INFO, upgradeCost } from '../common/src/rules';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type InitiatorRole, type Resources } from '../common/src/protocol';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { runWithCity } from '../api/src/city-scope';
import { handleGetHeroes, handleRecruitHero } from '../api/src/handlers-hero';
import { handleGetTechs } from '../api/src/handlers-tech';
import { handleSetCapital } from '../api/src/handlers-capital';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('酒馆 / 书院收敛到主城（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;
  let main: string;
  let branch: string;
  let branch2: string;
  let seq = 0;

  async function resources(cityId: string): Promise<Resources> {
    const row = (await pool.query(`SELECT gold, wood, food, stone, iron FROM cities WHERE id = $1`, [cityId])).rows[0];
    return { gold: Number(row.gold), wood: Number(row.wood), food: Number(row.food), stone: Number(row.stone), iron: Number(row.iron) };
  }

  async function levelOf(cityId: string, kind: string): Promise<number | null> {
    const res = await pool.query(`SELECT level FROM city_buildings WHERE city_id = $1 AND kind = $2`, [cityId, kind]);
    return res.rowCount ? Number((res.rows[0] as { level: number }).level) : null;
  }

  async function runMigration(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await migrateMainOnlyBuildings(client);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function newCity(name: string, opts: { gold?: number; government?: number } = {}): Promise<string> {
    seq += 1;
    const id = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y) VALUES ($1, $2, $3, $3, $3, $3, $3, $4, $5) RETURNING id`,
      [accountId, name, opts.gold ?? 1000, 700 + seq, 700 + seq],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', $2)`, [id, opts.government ?? 3]);
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)`,
      [700 + seq, 700 + seq, id],
    );
    return id;
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'mainonlymig');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
    accountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`mainonlymig-${Date.now()}`])).rows[0].id as string;
    main = await newCity('主城', { gold: 1000 });
    branch = await newCity('分城P', { gold: 1000, government: 6 });
    branch2 = await newCity('分城Q', { gold: 1000 });
    // 迁移前的存量：主城 酒馆 2 / 书院 1；分城 P 酒馆 5 / 书院 4；分城 Q 书院 3
    await pool.query(
      `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'tavern', 2), ($1, 'academy', 1),
              ($2, 'tavern', 5), ($2, 'academy', 4), ($3, 'academy', 3)`,
      [main, branch, branch2],
    );
    // 分城 P 队列里还有这两项：一条排队（酒馆建造）、一条在建（书院单级升级）
    await pool.query(
      `INSERT INTO builds (account_id, city_id, kind, status, level, to_level, initiator, cost, due_at)
       VALUES ($1, $2, 'tavern', 'queued', 1, NULL, 'player', $3::jsonb, NULL),
              ($1, $2, 'academy', 'building', 2, NULL, 'player', $4::jsonb, now() + interval '1 hour')`,
      [accountId, branch, JSON.stringify(BUILDING_INFO.tavern.cost), JSON.stringify(upgradeCost('academy', 1))],
    );
    // 三座城各有候选（迁移后应只剩主城那一份）
    for (const cityId of [main, branch, branch2]) {
      await pool.query(
        `INSERT INTO tavern_candidates (city_id, name, lead, force, wit) VALUES ($1, '候选甲', 20, 21, 22), ($1, '候选乙', 23, 24, 25)`,
        [cityId],
      );
    }
  });

  after(async () => {
    setTimeScaleCache(1);
    await pool?.end();
    await tmp?.drop();
  });

  test('迁移：最高等级合并到主城、分城两项删除、分城排队取消并全额返还、分城候选清空', async () => {
    const beforeP = await resources(branch);
    const refund =
      BUILDING_INFO.tavern.cost.gold + upgradeCost('academy', 1).gold; // 排队条目的成本快照 + 在建单级升级
    await runMigration();

    assert.equal(await levelOf(main, 'tavern'), 5, '主城取全账号最高酒馆等级');
    assert.equal(await levelOf(main, 'academy'), 4, '主城取全账号最高书院等级');
    assert.equal(await levelOf(branch, 'tavern'), null, '分城酒馆记录删除');
    assert.equal(await levelOf(branch, 'academy'), null, '分城书院记录删除');
    assert.equal(await levelOf(branch2, 'academy'), null, '第二座分城同样删除');

    const cancelled = await pool.query(
      `SELECT kind, status FROM builds WHERE city_id = $1 AND kind = ANY('{tavern,academy}') ORDER BY kind`,
      [branch],
    );
    assert.deepEqual(cancelled.rows.map((row) => row.status), ['cancelled', 'cancelled'], '两条都被取消');
    const afterP = await resources(branch);
    assert.equal(afterP.gold - beforeP.gold, refund, '建造成本全额返还到该分城');

    const candidateCities = await pool.query(`SELECT DISTINCT city_id FROM tavern_candidates`);
    assert.deepEqual(candidateCities.rows.map((row) => row.city_id), [main], '候选只剩主城一份');
  });

  test('迁移幂等：再跑一次不改等级、不重复返还', async () => {
    const beforeP = await resources(branch);
    const beforeMain = await resources(main);
    await runMigration();
    assert.equal(await levelOf(main, 'tavern'), 5);
    assert.equal(await levelOf(main, 'academy'), 4);
    assert.deepEqual(await resources(branch), beforeP);
    assert.deepEqual(await resources(main), beforeMain);
  });

  test('主城原有等级更高时迁移不改它', async () => {
    const other = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`mainonlymig2-${Date.now()}`])).rows[0].id as string;
    const m = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, '主城2', 0, 0, 0, 900, 900) RETURNING id`,
      [other],
    )).rows[0].id as string;
    const b = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, '分城2', 0, 0, 0, 901, 901) RETURNING id`,
      [other],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'tavern', 9), ($2, 'tavern', 2)`, [m, b]);
    await runMigration();
    assert.equal(await levelOf(m, 'tavern'), 9, '主城更高时保持不变');
    assert.equal(await levelOf(b, 'tavern'), null);
  });

  test('GET_TECHS / GET_HEROES 传分城 cityId 与不传结果相同（均按主城）', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw) as Record<string, unknown>) } as unknown as ConnInfo['socket'];
    const registry = new ConnectionRegistry();
    const conn: ConnInfo = { socket, ip: null, host: null, accountId, username: null, role: 'player', sessionId: null, connectedAt: new Date() };
    registry.add(conn);
    const ctx = { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    const call = async (op: number, data: Record<string, unknown>) => {
      sent.length = 0;
      await handleMessage(ctx, conn, JSON.stringify({ op, seq: 1, data }));
      return sent[sent.length - 1]?.data as Record<string, unknown>;
    };
    const techsPlain = await call(Op.GET_TECHS, {});
    const techsBranch = await call(Op.GET_TECHS, { cityId: branch });
    assert.equal(techsBranch.academyLevel, 4, '书院等级取主城');
    assert.deepEqual(techsBranch, techsPlain, 'GET_TECHS：传分城与不传相同');

    const heroesPlain = await call(Op.GET_HEROES, {});
    const heroesBranch = await call(Op.GET_HEROES, { cityId: branch });
    assert.equal(heroesBranch.cityId, main, '候选归属主城');
    assert.equal(heroesBranch.tavernLevel, 5);
    assert.equal(heroesBranch.maxTavernLevel, 5, '酒馆等级只读主城');
    assert.deepEqual(heroesBranch, heroesPlain, 'GET_HEROES：传分城与不传相同');
  });

  test('研究从主城扣资源、按主城书院判定（请求里的 cityId 忽略）', async () => {
    const sent: Array<{ ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) => sent.push(frame),
      broadcast: () => 0,
    } as unknown as ConnectionRegistry;
    const ctx = { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    const conn = { accountId, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    const beforeMain = await resources(main);
    const beforeBranch = await resources(branch);
    sent.length = 0;
    // 走分发层：RESEARCH_TECH 不在 CITY_SCOPED_OPS 里，cityId 被忽略（不报 INVALID_PARAMS）
    const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw) as { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) } as unknown as ConnInfo['socket'];
    const realRegistry = new ConnectionRegistry();
    const connWithSocket: ConnInfo = { socket, ip: null, host: null, accountId, username: null, role: 'player', sessionId: null, connectedAt: new Date() };
    realRegistry.add(connWithSocket);
    const realCtx = { pool, registry: realRegistry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    await handleMessage(realCtx, connWithSocket, JSON.stringify({ op: Op.RESEARCH_TECH, seq: 1, data: { tech: 'farming', cityId: branch } }));
    assert.equal(sent[0]?.ok, true, JSON.stringify(sent[0]));
    const research = (sent[0]?.data as { research: { cityId: string; level: number; cost: Resources } }).research;
    assert.equal(research.cityId, main, '研究记录记在主城');
    assert.equal(research.level, 1, '研究农耕 Lv1（书院 4 级远超门槛）');
    const afterMain = await resources(main);
    const afterBranch = await resources(branch);
    assert.equal(beforeMain.gold - afterMain.gold, research.cost.gold, '成本从主城扣');
    assert.deepEqual(afterBranch, beforeBranch, '分城资源不变');
    // 收尾：去掉进行中的研究，后续用例不受影响
    await pool.query(`UPDATE tech_research SET status = 'cancelled' WHERE account_id = $1`, [accountId]);
    void ctx;
    void conn;
  });

  test('招募从主城扣金币（当前城是分城也一样）', async () => {
    const cand = (await pool.query(
      `INSERT INTO tavern_candidates (city_id, name, lead, force, wit) VALUES ($1, '招募甲', 20, 21, 22) RETURNING id`,
      [main],
    )).rows[0].id as string;
    const sent: Array<{ ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) => sent.push(frame),
      broadcast: () => 0,
    } as unknown as ConnectionRegistry;
    const ctx = { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    const conn = { accountId, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    const beforeBranch = await resources(branch);
    // 招募费 = 500 + 三项属性合计 × 20（从主城扣）：先把主城金币补足
    await pool.query(`UPDATE cities SET gold = 100000 WHERE id = $1`, [main]);
    const richMain = await resources(main);
    await runWithCity(branch, () => handleRecruitHero(ctx, conn, Op.RECRUIT_HERO, 1, { candidateId: cand }));
    assert.equal(sent[sent.length - 1]?.ok, true, JSON.stringify(sent[sent.length - 1]));
    const spent = richMain.gold - (await resources(main)).gold;
    assert.ok(spent > 0, '招募费从主城扣');
    assert.deepEqual(await resources(branch), beforeBranch, '分城资源不变');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM account_heroes WHERE account_id = $1`, [accountId])).rows[0].n, 1);
  });

  test('换主城：两城酒馆 / 书院记录互换（等级跟着主城身份走），候选清空', async () => {
    await pool.query(`UPDATE cities SET durability = 100, durability_settled_at = NULL WHERE id = $1`, [branch]);
    await pool.query(`DELETE FROM tavern_candidates`);
    await pool.query(`INSERT INTO tavern_candidates (city_id, name, lead, force, wit) VALUES ($1, '候选甲', 20, 21, 22)`, [main]);
    const sent: Array<{ ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) => sent.push(frame),
      broadcast: () => 0,
    } as unknown as ConnectionRegistry;
    const ctx = { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    const conn = { accountId, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await runWithCity(branch, () => handleSetCapital(ctx, conn, Op.SET_CAPITAL, 1, { confirm: true }));
    assert.equal(sent[sent.length - 1]?.ok, true, JSON.stringify(sent[sent.length - 1]));
    assert.equal(await levelOf(branch, 'tavern'), 5, '新主城拿到原主城的酒馆等级');
    assert.equal(await levelOf(branch, 'academy'), 4, '新主城拿到原主城的书院等级');
    assert.equal(await levelOf(main, 'tavern'), null, '原主城（现分城）不再有这两项');
    assert.equal(await levelOf(main, 'academy'), null);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM tavern_candidates`)).rows[0].n, 0, '两城候选清空');
  });
});
