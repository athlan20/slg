// 赛季预告的数据库行为（AISLG-134，docs/season-system.md §4）：每个阶段只发一次（重复 tick / 并发 tick /
// 重启都不重发）、晚部署只发最近的一个阶段、公告与全服播报入库、PUSH 通知按阶段发出。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（一次性临时集群，测试在其中新建独立库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema, NOTIFY_CHANNEL } from '../common/src/db';
import { getCurrentSeason } from '../common/src/season-db';
import { sendDueNotice } from '../worker/src/season-notice';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;
const DAY = 24 * 3600 * 1000;
const MIN = 60 * 1000;

describe('赛季预告发送（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  let listener: pg.Client;
  const payloads: Array<Record<string, unknown>> = [];

  before(async () => {
    db = await createTempDatabase(dbUrl as string, 'notice');
    pool = new pg.Pool({ connectionString: db.url, max: 4 });
    await ensureSchema(pool);
    listener = new pg.Client({ connectionString: db.url });
    await listener.connect();
    listener.on('notification', (msg) => {
      if (msg.channel === NOTIFY_CHANNEL && msg.payload) {
        payloads.push(JSON.parse(msg.payload));
      }
    });
    await listener.query(`LISTEN ${NOTIFY_CHANNEL}`);
  });

  after(async () => {
    await listener?.end().catch(() => undefined);
    await pool?.end();
    await db?.drop();
  });

  /** 把当前赛季的结束时间设为“现在 + 偏移”，并清空已发阶段（测试间独立） */
  async function setEndIn(offsetMs: number, notified: string[] = []): Promise<void> {
    await pool.query(`UPDATE seasons SET end_at = $1, notified_stages = $2::text[] WHERE status = 'active'`, [
      new Date(Date.now() + offsetMs),
      notified,
    ]);
  }

  /** 发一次预告（取当前赛季的最新状态，与 Worker tick 同口径） */
  async function tick(): Promise<string | null> {
    const season = await getCurrentSeason(pool);
    assert.ok(season);
    return sendDueNotice(pool, season);
  }

  async function notifiedStages(): Promise<string[]> {
    const res = await pool.query(`SELECT notified_stages FROM seasons WHERE status = 'active'`);
    return [...(res.rows[0].notified_stages as string[])].sort();
  }

  /** 等待 LISTEN 收到的 season_warning 条数达到 n（通知异步到达） */
  async function waitForWarnings(n: number): Promise<string[]> {
    for (let i = 0; i < 50; i += 1) {
      const stages = payloads.filter((p) => p.reason === 'season_warning').map((p) => (p.data as { stage: string }).stage);
      if (stages.length >= n) {
        return stages;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return payloads.filter((p) => p.reason === 'season_warning').map((p) => (p.data as { stage: string }).stage);
  }

  test('正常节奏：每个阶段恰好发一次；并发 tick 只发一次；重复 tick 不重发', async () => {
    await setEndIn(2.5 * DAY);
    // 两个 tick 同时到达 T-3d：条件更新保证只有一方拿到发送权
    const [a, b] = await Promise.all([tick(), tick()]);
    assert.equal([a, b].filter((x) => x !== null).length, 1, '并发时只发一次');
    assert.equal(a ?? b, 'T-3d');
    assert.equal(await tick(), null, '同一阶段再次 tick 不重发');

    await setEndIn(0.9 * DAY);
    assert.equal(await tick(), 'T-1d');
    await setEndIn(30 * MIN);
    assert.equal(await tick(), 'T-1h');
    await setEndIn(5 * MIN);
    assert.equal(await tick(), 'T-10m');
    assert.equal(await tick(), null);

    assert.deepEqual(await notifiedStages(), ['T-10m', 'T-1d', 'T-1h', 'T-3d']);
    assert.deepEqual(await waitForWarnings(4), ['T-3d', 'T-1d', 'T-1h', 'T-10m'], 'PUSH 通知按阶段各一次');
    const warn = payloads.find((p) => p.reason === 'season_warning') as { data: Record<string, unknown> };
    assert.ok(typeof warn.data.seasonId === 'number');
    assert.ok(typeof warn.data.endsAt === 'string');
    assert.ok(Number(warn.data.remainingSec) > 0);
  });

  test('公告与全服播报入库（强制播报，不受限频）', async () => {
    const ann = await pool.query(`SELECT count(*)::int AS n FROM announcements WHERE category = 'system' AND title_zh LIKE '%即将结束%'`);
    assert.equal(ann.rows[0].n, 4, '四个阶段各一条系统公告');
    const strong = await pool.query(
      `SELECT count(*)::int AS n FROM announcements WHERE strong_remind AND title_zh LIKE '%即将结束%'`,
    );
    assert.equal(strong.rows[0].n, 2, 'T-1h 与 T-10m 为强提醒');
    const broadcasts = await pool.query(`SELECT count(*)::int AS n FROM server_broadcasts WHERE type = 'announcement'`);
    assert.equal(broadcasts.rows[0].n, 4, '每个阶段一条全服播报');
  });

  test('晚部署（直接进入 T-1h 之内）只发最近的一个阶段，更早的阶段记为已发、不连发', async () => {
    await pool.query(`UPDATE seasons SET notified_stages = '{}' WHERE status = 'active'`);
    const before = payloads.length;
    await setEndIn(30 * MIN, []);
    assert.equal(await tick(), 'T-1h');
    assert.deepEqual(await notifiedStages(), ['T-1d', 'T-1h', 'T-3d']);
    assert.equal(await tick(), null);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const sent = payloads.slice(before).filter((p) => p.reason === 'season_warning');
    assert.deepEqual(
      sent.map((p) => (p.data as { stage: string }).stage),
      ['T-1h'],
      '晚部署只推送最近的一个阶段',
    );
    // 之后到 T-10m 才再发
    await setEndIn(5 * MIN, ['T-1d', 'T-1h', 'T-3d']);
    assert.equal(await tick(), 'T-10m');
  });

  test('重启（新连接池、新进程视角）不重发已发阶段', async () => {
    const restarted = new pg.Pool({ connectionString: db.url, max: 2 });
    try {
      const season = await getCurrentSeason(restarted);
      assert.ok(season);
      assert.equal(await sendDueNotice(restarted, season), null);
    } finally {
      await restarted.end();
    }
  });
});
