// 换季重置端到端（AISLG-134，docs/season-system.md §2.5 / §3 / §9 验收 1–4）：临时库里造 3 个账号（主城、驻军、
// 武将、行军、建造、将星塔、竞技场、令牌、会话），把赛季到点，跑一次 Worker 换季 tick，断言：
// 游戏态全部清空并按新种子重建世界 / 名城 / 野外名将 / 竞技场 NPC；账号与令牌、会话保留；旧赛季 ended、新赛季 active
// 且种子不同、倍速按预设切换；名人堂存档与荣誉写入；维护态清除；通知顺序正确；之后惰性加入给全新主城与新手保护。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（临时集群，测试在其中新建独立库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { ensureSchema, NOTIFY_CHANNEL } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { seedArenaNpcs } from '../common/src/arena-db';
import { ARENA_NPC_COUNT } from '../common/src/arena';
import { FAMOUS_CITY_NAMES } from '../common/src/famous-city';
import { WILD_FAMOUS_NAMES } from '../common/src/hero-wild';
import { generateWorldTiles, WORLD_SIZE } from '../common/src/world';
import { RESET_TABLES } from '../common/src/season-tables';
import { enterCurrentSeason, getCurrentSeason, getMaintenance, getMyHonors } from '../common/src/season-db';
import { seasonLengthDays } from '../common/src/season-seed';
import { insertEvent } from '../common/src/events';
import { EventType } from '../common/src/protocol-city';
import { insertAccountWithCity, generateSessionToken, hashSessionToken } from '../api/src/auth';
import { processSeasonTick, resetSeasonTickStateForTest } from '../worker/src/season-tick';
import { isSeasonResetting } from '../worker/src/season-busy';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

/** 测试中为“到点”的赛季写入的结束时间（过去一分钟） */
async function makeSeasonDue(pool: pg.Pool): Promise<void> {
  await pool.query(`UPDATE seasons SET end_at = now() - interval '1 minute' WHERE status = 'active'`);
}

/** 每张重置表的行数（测试断言用） */
async function resetTableCounts(pool: pg.Pool): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of RESET_TABLES) {
    const res = await pool.query(`SELECT count(*)::int AS n FROM ${table}`);
    counts[table] = res.rows[0].n as number;
  }
  return counts;
}

/** 某个种子生成的世界 NPC 城位置指纹（纯函数生成，不落库，用于核对当前地图确是该种子的） */
function fingerprintFor(seed: number): string {
  const tiles = generateWorldTiles(seed).filter((tile) => tile.kind === 'npc_city');
  const text = tiles
    .sort((p, q) => p.x - q.x || p.y - q.y)
    .map((tile) => `${tile.x},${tile.y}`)
    .join(';');
  return createHash('md5').update(text).digest('hex');
}

/** 世界 NPC 城的位置指纹（判断世界是否换了一张图） */
async function npcFingerprint(pool: pg.Pool): Promise<string> {
  const res = await pool.query(
    `SELECT md5(string_agg(x || ',' || y, ';' ORDER BY x, y)) AS h FROM world_tiles WHERE kind = 'npc_city'`,
  );
  return res.rows[0].h as string;
}

describe('换季重置端到端（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  let listener: pg.Client;
  const notes: Array<{ reason: string; data?: Record<string, unknown> }> = [];
  let accountA: string;
  let accountB: string;
  let accountC: string;
  let cityA: string;
  let oldSeasonId: number;
  let oldSeasonName: string;
  let oldSeed: number;
  let oldFingerprint: string;
  let oldMaxEventId: number;
  let newSeasonId: number;

  before(async () => {
    db = await createTempDatabase(dbUrl as string, 'reset');
    pool = new pg.Pool({ connectionString: db.url, max: 6 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    await seedArenaNpcs(pool);
    listener = new pg.Client({ connectionString: db.url });
    await listener.connect();
    listener.on('notification', (msg) => {
      if (msg.channel === NOTIFY_CHANNEL && msg.payload) {
        notes.push(JSON.parse(msg.payload));
      }
    });
    await listener.query(`LISTEN ${NOTIFY_CHANNEL}`);

    // 三个账号：A 驻军多、有行军 / 建造 / 武将 / 将星塔 / 竞技场 / 令牌 / 会话；B 只有驻军；C 只有城
    const ids: string[] = [];
    for (const name of ['season-a', 'season-b', 'season-c']) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const created = await insertAccountWithCity(client, { username: `${name}-${Date.now()}`, passwordHash: 'x', signupIp: null });
        await client.query('COMMIT');
        ids.push(created.id);
      } finally {
        client.release();
      }
    }
    [accountA, accountB, accountC] = ids;
    cityA = (await pool.query(`SELECT id FROM cities WHERE account_id = $1`, [accountA])).rows[0].id;
    const cityB = (await pool.query(`SELECT id FROM cities WHERE account_id = $1`, [accountB])).rows[0].id;
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 500)`, [cityA]);
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 100)`, [cityB]);
    await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, 500, 500, '{"militia": 100}', 'attack', 'marching', 'player', now() + interval '1 hour')`,
      [accountA, cityA],
    );
    await pool.query(
      `INSERT INTO builds (account_id, city_id, kind, status, initiator, due_at) VALUES ($1, $2, 'farm', 'building', 'player', now() + interval '1 hour')`,
      [accountA, cityA],
    );
    await pool.query(
      `INSERT INTO account_heroes (account_id, name, lead, force, wit) VALUES ($1, '关羽', 80, 90, 60)`,
      [accountA],
    );
    await pool.query(`INSERT INTO star_tower_progress (account_id, best_floor) VALUES ($1, 7)`, [accountA]);
    await pool.query(`INSERT INTO arena_entries (account_id, rank, best_rank) VALUES ($1, 21, 21)`, [accountA]);
    await pool.query(
      `UPDATE accounts SET plunder_total = 500, agent_model = 'claude-opus-5-5', agent_last_seen_at = now() WHERE id = $1`,
      [accountA],
    );
    // 注册时已为每个账号发了 Agent 令牌（agent_tokens.account_id 唯一），此处不再另建
    assert.ok((await pool.query(`SELECT 1 FROM agent_tokens WHERE account_id = $1`, [accountA])).rowCount === 1);
    await pool.query(
      `INSERT INTO sessions (account_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
      [accountA, hashSessionToken(generateSessionToken())],
    );
    await pool.query(`INSERT INTO chat_messages (channel, sender_id, text) VALUES ('world', $1, '你好')`, [accountA]);
    const ev = await insertEvent(pool, { accountId: accountA, type: EventType.BUILD_STARTED, detail: {} });
    oldMaxEventId = ev;
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('time_scale', '{"scale": 5}', now()), ('next_time_scale', '{"scale": 20}', now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );

    const season = await getCurrentSeason(pool);
    assert.ok(season);
    oldSeasonId = season.id;
    oldSeasonName = season.name;
    oldSeed = season.seed;
    oldFingerprint = await npcFingerprint(pool);
  });

  after(async () => {
    await listener?.end().catch(() => undefined);
    await pool?.end();
    await db?.drop();
  });

  test('换季前：各重置表都有数据（测试夹具就位）', async () => {
    const counts = await resetTableCounts(pool);
    assert.equal(counts.cities, 3);
    assert.equal(counts.city_army, 2);
    assert.equal(counts.marches, 1);
    assert.equal(counts.account_heroes, 1);
    assert.equal(counts.star_tower_progress, 1);
    assert.equal(counts.world_tiles, WORLD_SIZE * WORLD_SIZE);
  });

  test('到点后 Worker 的一次 tick 完成换季', async () => {
    await makeSeasonDue(pool);
    resetSeasonTickStateForTest();
    const outcome = await processSeasonTick(pool);
    assert.equal(outcome, 'reset');
    assert.equal(isSeasonResetting(), false, '换季结束后进程内标记已清除');
  });

  test('旧赛季收尾、新赛季开局：状态、种子不同、倍速按预设切换，预设用后即删', async () => {
    const old = (await pool.query(`SELECT status, ended_at FROM seasons WHERE id = $1`, [oldSeasonId])).rows[0];
    assert.equal(old.status, 'ended');
    assert.ok(old.ended_at);
    const season = await getCurrentSeason(pool);
    assert.ok(season);
    newSeasonId = season.id;
    assert.ok(newSeasonId > oldSeasonId);
    assert.equal(season.name, `第 ${newSeasonId} 赛季`);
    assert.notEqual(season.seed, oldSeed, '新赛季用新种子');
    assert.equal(season.timeScale, 20, '倍速取预设');
    const span = season.endAt.getTime() - season.startAt.getTime();
    assert.ok(Math.abs(span - seasonLengthDays() * 24 * 3600 * 1000) < 2000, '赛季长度按 SEASON_LENGTH_DAYS');
    const settings = (await pool.query(`SELECT key, value FROM settings WHERE key IN ('time_scale', 'next_time_scale')`)).rows;
    assert.deepEqual(settings, [{ key: 'time_scale', value: { scale: 20 } }], '预设写入 time_scale 并删除');
    assert.equal(await getMaintenance(pool), null, '维护态已清除');
  });

  test('重置表全部清空，仅世界、名城、野外名将、竞技场 NPC 按新种子重建', async () => {
    const counts = await resetTableCounts(pool);
    const expected: Record<string, number> = {
      world_tiles: WORLD_SIZE * WORLD_SIZE,
      famous_cities: FAMOUS_CITY_NAMES.length,
      arena_entries: ARENA_NPC_COUNT,
    };
    for (const table of RESET_TABLES) {
      assert.equal(counts[table], expected[table] ?? 0, `${table} 行数`);
    }
    const npcs = await pool.query(`SELECT count(*)::int AS n FROM arena_entries WHERE account_id IS NULL`);
    assert.equal(npcs.rows[0].n, ARENA_NPC_COUNT, '守擂 NPC 重建');
    const famous = await pool.query(`SELECT count(*)::int AS n FROM world_tiles WHERE wild_hero IS NOT NULL`);
    assert.equal(famous.rows[0].n, WILD_FAMOUS_NAMES.length, '野外名将重新落位');
    assert.notEqual(await npcFingerprint(pool), oldFingerprint, '地图已换（NPC 城位置随新种子变化）');
  });

  test('进程重启（API / Worker 启动时的 ensureWorld）不换图：按当前赛季种子，地块数已齐则不重建', async () => {
    await ensureWorld(pool);
    assert.notEqual(await npcFingerprint(pool), oldFingerprint, '仍是新图');
    const season = await getCurrentSeason(pool);
    assert.ok(season);
    assert.equal(await npcFingerprint(pool), fingerprintFor(season.seed), '地图即新赛季种子生成的那张');
  });

  test('账号、令牌、会话保留；账号赛季字段重置', async () => {
    const accounts = (await pool.query(`SELECT id, username, agent_model, season_id, plunder_total, newbie_until FROM accounts ORDER BY username`)).rows;
    assert.equal(accounts.length, 3);
    for (const row of accounts) {
      assert.equal(row.season_id, null, '账号待惰性加入');
      assert.equal(Number(row.plunder_total), 0);
      assert.equal(row.newbie_until, null);
    }
    const a = accounts.find((row) => row.id === accountA);
    assert.equal(a.agent_model, 'claude-opus-5-5', '自报模型保留');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM agent_tokens WHERE account_id = $1`, [accountA])).rows[0].n, 1);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM sessions WHERE account_id = $1`, [accountA])).rows[0].n, 1);
  });

  test('名人堂：个人榜 / 模型榜 / 竞技场 / 将星塔存档，前三名获得荣誉称号', async () => {
    const power = (await pool.query(
      `SELECT account_id, rank FROM season_archives WHERE season_id = $1 AND kind = 'power' ORDER BY rank`,
      [oldSeasonId],
    )).rows;
    assert.equal(power[0].account_id, accountA, '力量榜第 1 为 A');
    assert.equal(power[1].account_id, accountB, '力量榜第 2 为 B');
    assert.equal(power.length, 2, 'C 没有驻军不上榜');
    const plunder = (await pool.query(`SELECT account_id FROM season_archives WHERE season_id = $1 AND kind = 'plunder' AND rank = 1`, [oldSeasonId])).rows[0];
    assert.equal(plunder.account_id, accountA);
    const arena = (await pool.query(`SELECT account_id, username FROM season_archives WHERE season_id = $1 AND kind = 'arena'`, [oldSeasonId])).rows;
    assert.equal(arena.length, 1, '竞技场只存玩家，不存 NPC');
    assert.equal(arena[0].account_id, accountA);
    const tower = (await pool.query(`SELECT account_id, value FROM season_archives WHERE season_id = $1 AND kind = 'starTower' AND rank = 1`, [oldSeasonId])).rows[0];
    assert.equal(tower.account_id, accountA);
    assert.equal(Number(tower.value), 7);
    const models = await pool.query(`SELECT count(*)::int AS n FROM season_archive_models WHERE season_id = $1`, [oldSeasonId]);
    assert.ok(models.rows[0].n >= 1, '模型榜存档');
    const modelTop = (await pool.query(
      `SELECT m.top_player_name, acc.id FROM season_archive_models m JOIN accounts acc ON acc.username = m.top_player_name
       WHERE m.season_id = $1 AND m.rank = 1`,
      [oldSeasonId],
    )).rows[0];

    const honorsA = await getMyHonors(pool, accountA);
    assert.ok(honorsA.some((h) => h.kind === 'power' && h.rank === 1 && h.title === `${oldSeasonName}·力量榜冠军`), JSON.stringify(honorsA));
    assert.ok(honorsA.some((h) => h.kind === 'plunder' && h.title === `${oldSeasonName}·掠夺榜冠军`));
    assert.ok(honorsA.some((h) => h.kind === 'starTower' && h.title === `${oldSeasonName}·将星塔冠军`));
    assert.ok(honorsA.some((h) => h.kind === 'arena' && h.title === `${oldSeasonName}·竞技场冠军`));
    const honorsB = await getMyHonors(pool, accountB);
    assert.ok(honorsB.some((h) => h.kind === 'power' && h.rank === 2 && h.title === `${oldSeasonName}·力量榜亚军`), JSON.stringify(honorsB));
    assert.ok(modelTop, '模型榜第 1 的模型的最高分玩家可对应到账号');
    const model = (await pool.query(`SELECT title FROM season_honors WHERE account_id = $1 AND season_id = $2 AND kind = 'model'`, [modelTop.id, oldSeasonId])).rows[0];
    assert.equal(model?.title, `${oldSeasonName}·模型冠军`, '模型榜第 1 的模型中得分最高的玩家获模型冠军');
    const cHonors = await getMyHonors(pool, accountC);
    assert.equal(cHonors.length, 0, '没有上榜的账号无称号');
  });

  test('通知顺序：维护开始 → 换季中 → 新赛季开始 → 维护结束（推送携带新赛季）', async () => {
    for (let i = 0; i < 50 && !notes.some((n) => n.reason === 'maintenance_off'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const reasons = notes.map((n) => n.reason).filter((r) => ['maintenance_on', 'season_resetting', 'season_started', 'maintenance_off'].includes(r));
    assert.deepEqual(reasons, ['maintenance_on', 'season_resetting', 'season_started', 'maintenance_off']);
    const started = notes.find((n) => n.reason === 'season_started');
    assert.equal(started?.data?.seasonId, newSeasonId);
  });

  test('换季后惰性加入：新主城 + 新手保护，旧城池与驻军不复现', async () => {
    const result = await enterCurrentSeason(pool, accountA);
    assert.equal(result.joined, true);
    assert.equal(result.season.id, newSeasonId);
    const cities = (await pool.query(`SELECT name FROM cities WHERE account_id = $1`, [accountA])).rows;
    assert.deepEqual(cities.map((row) => row.name), ['主城']);
    const acc = (await pool.query(`SELECT season_id, newbie_until FROM accounts WHERE id = $1`, [accountA])).rows[0];
    assert.equal(acc.season_id, newSeasonId);
    assert.ok(new Date(acc.newbie_until).getTime() > Date.now(), '新手保护重新授予');
    const armies = (await pool.query(`SELECT count(*)::int AS n FROM city_army`)).rows[0].n;
    assert.equal(armies, 0, '旧驻军没有带过来');
  });

  test('事件 id 序列不回退：换季后新事件的 id 大于换季前的最大值', async () => {
    const accountIdRow = (await pool.query(`SELECT id FROM accounts WHERE username LIKE 'season-b%' LIMIT 1`)).rows[0];
    const id = await insertEvent(pool, { accountId: accountIdRow.id, type: EventType.BUILD_STARTED, detail: {} });
    assert.ok(id > oldMaxEventId, `${id} > ${oldMaxEventId}`);
  });
});
