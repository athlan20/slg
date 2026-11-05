// 遗迹（AISLG-227，v93）用例：生成与分布（验收 4）、未探索不泄露与已探索可见（验收 5、6）、
// 领取规则（验收 7～12）、随机落城跳过遗迹（验收 13）、开关关闭（验收 16）。
// 需要 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { claimCityTile, ensureWorld } from '../common/src/world-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { setFogEnabledCache, getFogEnabled } from '../common/src/fog-config';
import { chunkIndexOf, newFogBits, setChunkExplored } from '../common/src/fog';
import { readFogBits } from '../common/src/fog-db';
import { ensureRelics } from '../common/src/fog-relic-db';
import { RELIC_DEFS, RELIC_TOTAL, RELIC_MIN_SPACING, chebyshev, placeRelics, relicDef } from '../common/src/relic';
import { EventType, Op, type InitiatorRole } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { loadFogTileDetail, loadFogWindow, withFogRequest } from '../api/src/fog-view';
import { fogOverviewWithSites } from '../api/src/fog-site-overview';
import { processDueMarches } from '../worker/src/world-tick';
import { recordMarchExploration } from '../common/src/fog-record';
import { claimRelicOnArrival, type RelicClaimOutcome, type RelicMarch } from '../worker/src/fog-relic-claim';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('遗迹（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let A: string;
  let B: string;
  let cityA: string;
  let cityB: string;
  const tag = `relic-${Date.now()}`;
  // 测试用遗迹格：远离两座城，且不在任何名城 / 名将格上
  const RX = 100;
  const RY = 100;

  function makeSink() {
    const frames: Array<{ op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }> = [];
    const pushes: Array<{ accountId: string; op: number; data?: Record<string, unknown> }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }) => {
        frames.push({ op: frame.op, ok: frame.ok ?? true, data: frame.data, error: frame.error });
      },
      broadcast: (accountId: string, frame: { op: number; data?: Record<string, unknown> }) => {
        pushes.push({ accountId, op: frame.op, data: frame.data });
        return 0;
      },
    } as unknown as ConnectionRegistry;
    return { ctx: { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext, frames, pushes };
  }

  async function send(account: string, op: number, data: Record<string, unknown>) {
    const sink = makeSink();
    const conn = { accountId: account, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleMessage(sink.ctx, conn, JSON.stringify({ op, seq: 1, data }));
    return { res: sink.frames[sink.frames.length - 1] };
  }

  /** 把一格设为指定的地块（与 fog-review 的 tile 夹具一致） */
  async function tile(x: number, y: number, fields: { kind: string; owner?: string | null; level?: number }): Promise<void> {
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc, wild_hero) VALUES ($1, $2, 'plain', $3, $4, $5, NULL, NULL)
       ON CONFLICT (x, y) DO UPDATE SET terrain = 'plain', kind = EXCLUDED.kind, level = EXCLUDED.level,
         owner_city_id = EXCLUDED.owner_city_id, npc = NULL, wild_hero = NULL`,
      [x, y, fields.kind, fields.level ?? 3, fields.owner ?? null],
    );
  }

  /** 把账号的探索位图加上某格所在的区块（首次调用会先做开局初始化） */
  async function explore(account: string, x: number, y: number): Promise<void> {
    await withFogRequest(pool, account, async () => undefined);
    const bits = (await readFogBits(pool, account)) ?? newFogBits();
    setChunkExplored(bits, chunkIndexOf(x, y));
    await pool.query(
      `UPDATE fog_explored SET bits = $2 WHERE account_id = $1`,
      [account, Buffer.from(bits)],
    );
  }

  /** 把测试遗迹放到 (RX, RY)：清掉旧的，写一条普通遗迹 */
  async function placeTestRelic(tier = 'common', kind = 'granary'): Promise<void> {
    await pool.query(`DELETE FROM fog_relics WHERE x = $1 AND y = $2`, [RX, RY]);
    await tile(RX, RY, { kind: 'wilderness', level: 3 });
    await pool.query(`INSERT INTO fog_relics (x, y, tier, kind) VALUES ($1, $2, $3, $4)`, [RX, RY, tier, kind]);
  }

  async function resetRelicState(): Promise<void> {
    await pool.query(`UPDATE fog_relics SET claimed_by = NULL, claimed_at = NULL WHERE claimed_by = ANY($1::uuid[])`, [[A, B]]);
    await pool.query(`DELETE FROM events WHERE account_id = ANY($1::uuid[]) AND type = $2`, [[A, B], EventType.RELIC_CLAIMED]);
    await pool.query(`DELETE FROM marches WHERE account_id = ANY($1::uuid[])`, [[A, B]]);
    await pool.query(`UPDATE cities SET gold = 1000, wood = 1000, food = 1000, stone = 1000, iron = 1000 WHERE id = ANY($1::uuid[])`, [[cityA, cityB]]);
    // 每个用例开始时，两账号都没有探索测试遗迹格所在的区块（用例自己再加）
    for (const account of [A, B]) {
      const bits = await readFogBits(pool, account);
      if (bits) {
        const index = chunkIndexOf(RX, RY);
        bits[index >> 3] &= ~(1 << (index & 7));
        await pool.query(`UPDATE fog_explored SET bits = $2 WHERE account_id = $1`, [account, Buffer.from(bits)]);
      }
    }
  }

  /** 构造一趟行军的遗迹领取身份（直接调用 claimRelicOnArrival 时用） */
  function marchAt(account: string, city: string, purpose = 'plunder', x = RX, y = RY): RelicMarch {
    return { id: randomUUID(), account_id: account, from_city_id: city, x, y, purpose };
  }

  /** 一趟领取放在独立事务里（失败回滚，连接不留在出错的事务中） */
  async function claimTx(march: RelicMarch): Promise<RelicClaimOutcome> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await claimRelicOnArrival(client, march);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  /** ensureWorld 开服生成的遗迹（before 里在放测试遗迹之前记下） */
  let generated: Array<{ x: number; y: number; tier: string; kind: string }> = [];

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'fog_relic');
    pool = new pg.Pool({ connectionString: tmp.url, max: 8 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    generated = (await pool.query(`SELECT x, y, tier, kind FROM fog_relics`)).rows;
    const mk = async (name: string) => (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-${name}`])).rows[0].id as string;
    A = await mk('a');
    B = await mk('b');
    cityA = (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y) VALUES ($1, 'A主城', 1000, 1000, 1000, 1000, 1000, 700, 700) RETURNING id`, [A])).rows[0].id;
    cityB = (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y) VALUES ($1, 'B主城', 1000, 1000, 1000, 1000, 1000, 900, 900) RETURNING id`, [B])).rows[0].id;
    await tile(700, 700, { kind: 'city', owner: cityA, level: 0 });
    await tile(900, 900, { kind: 'city', owner: cityB, level: 0 });
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 500), ($1, 'scout', 20)`, [cityA]);
    await placeTestRelic();
  });

  after(async () => {
    setFogEnabledCache(null);
    await pool?.end();
    await tmp?.drop();
  });

  beforeEach(async () => {
    setFogEnabledCache(true);
    await resetRelicState();
  });

  // ---- 纯函数 ----

  test('遗迹配置：总数 200，各品质数量与价值（同品质总价值相同）', () => {
    assert.equal(RELIC_TOTAL, 200);
    const byTier = new Map<string, { count: number; value: number[] }>();
    for (const def of RELIC_DEFS) {
      const entry = byTier.get(def.tier) ?? { count: 0, value: [] };
      entry.count += def.count;
      entry.value.push(Object.values(def.reward).reduce((sum, n) => sum + n, 0));
      byTier.set(def.tier, entry);
    }
    assert.equal(byTier.get('common')?.count, 160);
    assert.equal(byTier.get('rare')?.count, 35);
    assert.equal(byTier.get('legendary')?.count, 5);
    assert.ok(byTier.get('common')!.value.every((v) => v === 5000));
    assert.ok(byTier.get('rare')!.value.every((v) => v === 10000));
    assert.ok(byTier.get('legendary')!.value.every((v) => v === 25000));
    assert.equal(relicDef('mausoleum')?.items.city_order, 1, '传说遗迹附迁城令');
  });

  test('挑点纯函数：200 处、种类数量正确、间距不小于 30、合规判定生效、同种子同结果', async () => {
    const eligible = async (batch: Array<{ x: number; y: number }>) => batch.map((p) => (p.x + p.y) % 7 !== 0);
    const first = await placeRelics(20260927, eligible, 1000);
    assert.equal(first.length, RELIC_TOTAL);
    const count = new Map<string, number>();
    for (const p of first) {
      count.set(p.kind, (count.get(p.kind) ?? 0) + 1);
    }
    for (const def of RELIC_DEFS) {
      assert.equal(count.get(def.kind), def.count, `种类 ${def.kind}`);
    }
    for (let i = 0; i < first.length; i += 1) {
      assert.notEqual((first[i].x + first[i].y) % 7, 0, '只落在合规格上');
      for (let j = i + 1; j < first.length; j += 1) {
        assert.ok(chebyshev(first[i].x, first[i].y, first[j].x, first[j].y) >= RELIC_MIN_SPACING, '间距');
      }
    }
    const again = await placeRelics(20260927, eligible, 1000);
    assert.deepEqual(again, first, '同一种子结果相同');
  });

  // ---- 生成（ensureWorld 启动时补生成，验收 4）----

  test('开服生成：200 处遗迹，分布与间距正确，全部在合规地块上', async () => {
    const rows = generated;
    assert.equal(rows.length, RELIC_TOTAL);
    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
    }
    for (const def of RELIC_DEFS) {
      assert.equal(counts.get(def.kind), def.count, `种类 ${def.kind}`);
    }
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        assert.ok(chebyshev(rows[i].x, rows[i].y, rows[j].x, rows[j].y) >= RELIC_MIN_SPACING);
      }
    }
    const bad = await pool.query(
      `SELECT count(*)::int AS n FROM fog_relics fr JOIN world_tiles wt ON wt.x = fr.x AND wt.y = fr.y
       WHERE fr.x <> $1 AND fr.y <> $2 AND NOT (wt.kind = 'wilderness' AND wt.owner_city_id IS NULL AND wt.npc IS NULL
                  AND wt.wild_hero IS NULL AND wt.terrain NOT IN ('lake', 'gold_mine'))`,
      [RX, RY],
    );
    assert.equal(bad.rows[0].n, 0, '遗迹都落在合规野地');
  });

  test('ensureRelics 幂等：已有遗迹时不再生成', async () => {
    const before = (await pool.query(`SELECT count(*)::int AS n FROM fog_relics`)).rows[0].n;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      assert.equal(await ensureRelics(client, 999, 1000), 0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM fog_relics`)).rows[0].n, before);
  });

  // ---- 未探索不泄露，已探索可见（验收 5、6）----

  test('未探索的遗迹格：地图窗口、GET_TILE、小地图都拿不到遗迹信息', async () => {
    const window = await loadFogWindow(pool, A, RX - 5, RY - 5, 11, 11);
    assert.equal(window.some((t) => t.x === RX && t.y === RY), false, '未探索的格不返回');
    const detail = await loadFogTileDetail(pool, A, RX, RY);
    assert.deepEqual(detail, { kind: 'unexplored' });
    const points = await withFogRequest(pool, A, (req) => fogOverviewWithSites(req, []));
    assert.equal(points.cities.some(([x, y, side]) => x === RX && y === RY && side === 'relic'), false);
  });

  test('已探索的遗迹格：显示品质与种类；领取后不再返回', async () => {
    await explore(A, RX, RY);
    const [tileView] = await loadFogWindow(pool, A, RX, RY, 1, 1);
    assert.equal(tileView.fog, 'explored');
    assert.deepEqual(tileView.relic, { tier: 'common', kind: 'granary' });
    const detail = await loadFogTileDetail(pool, A, RX, RY);
    assert.equal(detail.kind, 'ok');
    if (detail.kind === 'ok') {
      assert.deepEqual(detail.detail.relic, { tier: 'common', kind: 'granary' });
    }
    const points = await withFogRequest(pool, A, (req) => fogOverviewWithSites(req, []));
    assert.equal(points.cities.some(([x, y, side]) => x === RX && y === RY && side === 'relic'), true, '小地图记录未领取的遗迹');
    // 另一账号 B 也探索过这一格：A 领取后，B 的地图立刻没有这处遗迹（不走快照）
    await explore(B, RX, RY);
    const [before] = await loadFogWindow(pool, B, RX, RY, 1, 1);
    assert.ok(before.relic);
    assert.equal(await claimTx(marchAt(A, cityA)), 'claimed');
    const [after] = await loadFogWindow(pool, B, RX, RY, 1, 1);
    assert.equal(after.relic, null, '领取后所有人的地图上消失');
    const [mine] = await loadFogWindow(pool, A, RX, RY, 1, 1);
    assert.equal(mine.relic, null);
  });

  // ---- 领取规则（验收 7～12）----

  test('斥候 / 掠夺到达遗迹格：领取成功，奖励与种类表一致，事件记录；战斗失败也领取', async () => {
    await explore(A, RX, RY);
    await pool.query(`DELETE FROM marches WHERE account_id = $1`, [A]);
    const { res } = await send(A, Op.MARCH, { x: RX, y: RY, troops: { militia: 1 } });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    await pool.query(`UPDATE marches SET arrive_at = now() - interval '1 second', started_at = now() - interval '2 seconds' WHERE account_id = $1 AND x = $2 AND y = $3`, [A, RX, RY]);
    await processDueMarches(pool);
    const relic = (await pool.query(`SELECT claimed_by FROM fog_relics WHERE x = $1 AND y = $2`, [RX, RY])).rows[0];
    assert.equal(relic.claimed_by, A, '到达即领取（兵力少、打不过守军也一样）');
    const event = (await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1`, [A, EventType.RELIC_CLAIMED])).rows[0];
    assert.equal(event.detail.outcome, 'claimed');
    assert.deepEqual(event.detail.reward, relicDef('granary')?.reward);
    const city = (await pool.query(`SELECT food, gold FROM cities WHERE id = $1`, [cityA])).rows[0];
    // 粮约 +3000（扣除少量耗粮）、金币 +500：奖励发到主城，可超过仓库上限
    assert.ok(Number(city.food) >= 1000 + 3000 - 10, `粮约 +3000：${JSON.stringify(city)}`);
    assert.equal(Number(city.gold), 1000 + 500, '金币 +500');
  });

  test('两支部队同时到达：只有一方领取，奖励只发一次（并发事务）', async () => {
    const results = await Promise.all(
      [A, B].map(async (account, index) => {
        const city = index === 0 ? cityA : cityB;
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const out = await claimRelicOnArrival(client, marchAt(account, city));
          await client.query('COMMIT');
          return out;
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw err;
        } finally {
          client.release();
        }
      }),
    );
    assert.equal(results.filter((r) => r === 'claimed').length, 1, '只有一方成功');
    assert.equal(results.filter((r) => r === 'taken').length, 1, '另一方得到已被发掘');
    const owner = (await pool.query(`SELECT claimed_by FROM fog_relics WHERE x = $1 AND y = $2`, [RX, RY])).rows[0].claimed_by;
    const winner = results[0] === 'claimed' ? A : B;
    assert.equal(owner, winner);
  });

  test('每账号每北京日最多领 2 处：超过的不领取、遗迹保留、事件 limit；次日可以领', async () => {
    await placeTestRelic('common', 'granary');
    // 今天已领两处（直接写入两条今日登记）
    const picks = (await pool.query(`SELECT id FROM fog_relics WHERE NOT (x = $1 AND y = $2) LIMIT 2`, [RX, RY])).rows as Array<{ id: string }>;
    await pool.query(`UPDATE fog_relics SET claimed_by = $1, claimed_at = now() WHERE id = ANY($2::bigint[])`, [A, picks.map((p) => p.id)]);
    assert.equal(await claimTx(marchAt(A, cityA)), 'limit');
    const kept = (await pool.query(`SELECT claimed_by FROM fog_relics WHERE x = $1 AND y = $2`, [RX, RY])).rows[0];
    assert.equal(kept.claimed_by, null, '遗迹留在原地');
    const event = (await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1`, [A, EventType.RELIC_CLAIMED])).rows[0];
    assert.equal(event.detail.outcome, 'limit');
    // 次日：把今日登记改到昨天
    await pool.query(`UPDATE fog_relics SET claimed_at = now() - interval '1 day 2 hours' WHERE claimed_by = $1`, [A]);
    assert.equal(await claimTx(marchAt(A, cityA)), 'claimed');
    await pool.query(`UPDATE fog_relics SET claimed_by = NULL, claimed_at = NULL WHERE claimed_by = $1`, [A]);
  });

  test('已被别人领走：事件 taken，部队照常（不领取）', async () => {
    await pool.query(`UPDATE fog_relics SET claimed_by = $1, claimed_at = now() WHERE x = $2 AND y = $3`, [B, RX, RY]);
    assert.equal(await claimTx(marchAt(A, cityA)), 'taken');
    const event = (await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1`, [A, EventType.RELIC_CLAIMED])).rows[0];
    assert.equal(event.detail.outcome, 'taken');
  });

  test('盲打被拒（fog_denied）到达遗迹格：不领取，原路返回', async () => {
    // fog_denied 只由 MARCH / SCOUT 的校验拒绝写入；这里直接写一条被拒的行军，检验到达的分支
    await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at, fog_denied)
       VALUES ($1, $2, $3, $4, '{"militia": 5}'::jsonb, 'plunder', 'marching', 'player', now() - interval '1 second', true)`,
      [A, cityA, RX, RY],
    );
    await processDueMarches(pool);
    const relic = (await pool.query(`SELECT claimed_by FROM fog_relics WHERE x = $1 AND y = $2`, [RX, RY])).rows[0];
    assert.equal(relic.claimed_by, null);
    const denied = (await pool.query(`SELECT count(*)::int AS n FROM events WHERE account_id = $1 AND type = $2`, [A, EventType.RELIC_CLAIMED])).rows[0];
    assert.equal(denied.n, 0, '不写领取事件');
  });

  test('传说遗迹全服播报且不带坐标；普通遗迹不播报', async () => {
    await pool.query(`DELETE FROM server_broadcasts WHERE type = 'legendary_relic_claimed'`);
    await pool.query(`UPDATE fog_relics SET tier = 'legendary', kind = 'mausoleum' WHERE x = $1 AND y = $2`, [RX, RY]);
    assert.equal(await claimTx(marchAt(A, cityA)), 'claimed');
    const rows = (await pool.query(`SELECT detail FROM server_broadcasts WHERE type = 'legendary_relic_claimed'`)).rows as Array<{ detail: Record<string, unknown> }>;
    assert.equal(rows.length, 1);
    assert.equal('x' in rows[0].detail || 'y' in rows[0].detail, false, '播报不带坐标');
    await placeTestRelic('common', 'granary');
    await pool.query(`DELETE FROM server_broadcasts WHERE type = 'legendary_relic_claimed'`);
    assert.equal(await claimTx(marchAt(B, cityB)), 'claimed');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM server_broadcasts WHERE type = 'legendary_relic_claimed'`)).rows[0].n, 0);
  });

  test('探索简报：走过未探索区块里的遗迹，简报按种类计数并把遗迹列入坐标', async () => {
    await pool.query(`DELETE FROM events WHERE account_id = $1 AND type = $2`, [A, EventType.EXPLORATION_REPORT]);
    // 路线从 (96,100) 到 (104,100)，视野 3 格：覆盖遗迹格所在的新区块
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await recordMarchExploration(client, { marchId: randomUUID(), accountId: A, fromCityId: cityA, homeX: 96, homeY: RY, targetX: 104, targetY: RY, troops: { militia: 1 } }, 1, new Date());
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const event = (await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1`, [A, EventType.EXPLORATION_REPORT])).rows[0];
    const relics = event.detail.relics as { total: number; byKind: Record<string, number> };
    assert.ok(relics.total >= 1, '简报里有遗迹计数');
    assert.ok((relics.byKind.granary ?? 0) >= 1, '按种类计数');
    assert.ok((event.detail.cells as Array<{ kind: string }>).some((cell) => cell.kind === 'relic'), '坐标里列出遗迹');
  });

  test('高级迁城令指定未领取的遗迹格：MOVE_CITY_TILE_INVALID；指定未探索的遗迹格：MOVE_CITY_TILE_UNEXPLORED（不泄露）', async () => {
    const pointing = { cityId: cityA, mode: 'pointing', x: RX, y: RY, confirm: true };
    await explore(A, RX, RY);
    const invalid = await send(A, Op.MOVE_CITY, pointing);
    assert.equal(invalid.res.ok, false);
    assert.equal(invalid.res.error?.code, 'MOVE_CITY_TILE_INVALID', '未领取的遗迹格不能迁入');
    // 未探索的遗迹格：先报未探索，不返回任何地块信息
    await resetRelicState(); // 清掉两账号测试区块的探索位
    const unexplored = await send(A, Op.MOVE_CITY, pointing);
    assert.equal(unexplored.res.ok, false);
    assert.equal(unexplored.res.error?.code, 'MOVE_CITY_TILE_UNEXPLORED', '未探索的格返回未探索，不区分是否有遗迹');
    assert.equal(unexplored.res.data, undefined, '报错不带地块内容');
  });

  // ---- 开关关闭（验收 16）----

  test('fog_enabled 关闭：不领取、不写事件，地图不显示遗迹', async () => {
    setFogEnabledCache(false);
    assert.equal(getFogEnabled(), false);
    await explore(A, RX, RY);
    assert.equal(await claimTx(marchAt(A, cityA)), 'none');
    const relic = (await pool.query(`SELECT claimed_by FROM fog_relics WHERE x = $1 AND y = $2`, [RX, RY])).rows[0];
    assert.equal(relic.claimed_by, null);
    const [tileView] = await loadFogWindow(pool, A, RX, RY, 1, 1);
    assert.equal(tileView.relic, null);
    assert.equal(tileView.heroSite, null);
  });

  test('随机落城跳过未领取的遗迹格（开启时）：唯一可选的空地是遗迹格时，落城返回 null', async () => {
    // 把所有野地设为不可用，只留中心格 (500, 500) 作为遗迹格；中心格必然被抽到
    await pool.query(`UPDATE world_tiles SET npc = '{}'::jsonb WHERE kind = 'wilderness' AND NOT (x = 500 AND y = 500)`);
    await tile(500, 500, { kind: 'wilderness', level: 3 });
    await pool.query(`DELETE FROM fog_relics WHERE x = 500 AND y = 500`);
    await pool.query(`INSERT INTO fog_relics (x, y, tier, kind) VALUES (500, 500, 'common', 'granary')`);
    const orphan = (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, stone, iron) VALUES ($1, 'Z', 0, 0, 0, 0, 0) RETURNING id`, [B])).rows[0].id as string;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      assert.equal(await claimCityTile(client, orphan), null, '开启时跳过遗迹格');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    await pool.query(`UPDATE fog_relics SET claimed_by = $1, claimed_at = now() WHERE x = 500 AND y = 500`, [B]);
    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');
      const picked = await claimCityTile(client2, orphan);
      await client2.query('ROLLBACK');
      assert.deepEqual(picked, { x: 500, y: 500 }, '遗迹已领取后该格可以落城');
    } finally {
      client2.release();
    }
    await pool.query(`DELETE FROM cities WHERE id = $1`, [orphan]);
  });
});
