// 联盟地图标记（v69，AISLG-184）：放置 / 删除 / 查询、上限与到期、同格不重复、权限（含 Agent）、离盟与解散、推送与系统消息。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL 才会跑（在其所指服务器上另建一次性数据库，别指向开发库）。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { Op } from '../common/src/protocol';
import { ALLIANCE_CREATE_COST_GOLD, ALLIANCE_MARK_MAX, ALLIANCE_MARK_TTL_MS } from '../common/src/protocol-alliance';
import { getMembership, purgeExpired } from '../common/src/alliance-db';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleAllianceOp } from '../api/src/handlers-alliance';
import { handleAllianceMarkOp } from '../api/src/handlers-alliance-mark';
import { initBannedWordFilter } from '../api/src/chat-words';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const baseUrl = process.env.TEST_DATABASE_URL;

// 屏蔽词：用临时词表覆盖默认词表（与 alliance.test.ts 同口径）
{
  const dir = mkdtempSync(join(tmpdir(), 'slg-alliance-mark-words-'));
  try {
    writeFileSync(join(dir, 'words.txt'), '禁词\n');
    initBannedWordFilter({ CHAT_BANNED_WORDS_FILE: join(dir, 'words.txt') } as NodeJS.ProcessEnv);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('联盟地图标记（需 TEST_DATABASE_URL）', { skip: baseUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let tmp: TempDatabase;
  let pool: pg.Pool;
  let seq = 0;

  interface Frame { ok: boolean; data?: Record<string, unknown>; error?: { code: string; [k: string]: unknown } }
  let last: Frame | undefined;
  const pushes: Array<{ accountId: string; op: number; data: Record<string, unknown> }> = [];
  const registry = {
    send: (_conn: ConnInfo, frame: Frame) => {
      last = { ok: frame.ok ?? true, data: frame.data, error: frame.error };
    },
    broadcast: (accountId: string, frame: { op: number; data: Record<string, unknown> }) => {
      if (frame.op === Op.PUSH_ALLIANCE_MARK) {
        pushes.push({ accountId, op: frame.op, data: frame.data });
      }
      return 1;
    },
    onlineAccountIds: () => [] as string[],
    connectionsOf: () => [] as ConnInfo[],
  } as unknown as ConnectionRegistry;
  const ctx = { pool: undefined as unknown as pg.Pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;

  const conn = (accountId: string, role: 'player' | 'agent' = 'player'): ConnInfo =>
    ({ accountId, host: null, role }) as unknown as ConnInfo;

  /** 标记协议走 handleAllianceMarkOp；建盟 / 入盟等仍走 handleAllianceOp */
  async function call(accountId: string, op: number, data?: Record<string, unknown>, role: 'player' | 'agent' = 'player'): Promise<Frame> {
    last = undefined;
    seq += 1;
    if (op === Op.ALLIANCE_MARK_ADD || op === Op.ALLIANCE_MARK_REMOVE || op === Op.GET_ALLIANCE_MARKS) {
      await handleAllianceMarkOp(ctx, conn(accountId, role), op, seq, data);
    } else {
      await handleAllianceOp(ctx, conn(accountId, role), op, seq, data);
    }
    assert.ok(last, `op ${op} 没有回包`);
    return last as Frame;
  }
  const expectOk = (f: Frame): Record<string, unknown> => {
    assert.ok(f.ok, `期望成功，实际 ${JSON.stringify(f.error)}`);
    return f.data ?? {};
  };
  const expectErr = (f: Frame, code: string): void => {
    assert.equal(f.ok, false, `期望失败 ${code}，实际成功 ${JSON.stringify(f.data)}`);
    assert.equal(f.error?.code, code);
  };

  /** 建账号；government > 0 时配一座主城（官府等级 + 金币），建盟需要 */
  async function makeAccount(label: string, opts: { government?: number; gold?: number } = {}): Promise<string> {
    const res = await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${label}-${(seq += 1)}`]);
    const id = res.rows[0].id as string;
    if (opts.government !== undefined) {
      const city = await pool.query(
        `INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, '主城', $2, 0, 0, $3, $3) RETURNING id`,
        [id, opts.gold ?? 0, seq],
      );
      await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', $2)`, [city.rows[0].id, opts.government]);
    }
    return id;
  }
  const nameOf = async (id: string): Promise<string> =>
    (await pool.query(`SELECT username FROM accounts WHERE id = $1`, [id])).rows[0].username as string;

  /** 建一个联盟：返回盟主与联盟 id */
  async function makeAlliance(name: string): Promise<{ leader: string; id: string }> {
    const leader = await makeAccount(`lead-${name}`, { government: 5, gold: ALLIANCE_CREATE_COST_GOLD + 5000 });
    const data = expectOk(await call(leader, Op.CREATE_ALLIANCE, { name }));
    return { leader, id: data.allianceId as string };
  }
  /** 让某账号经申请 + 审批进入联盟（成为普通成员） */
  async function join(allianceId: string, leader: string, label: string): Promise<string> {
    const member = await makeAccount(label);
    expectOk(await call(member, Op.ALLIANCE_APPLY, { allianceId }));
    expectOk(await call(leader, Op.ALLIANCE_RESPOND, { kind: 'request', accountId: member, accept: true }));
    return member;
  }
  /** 打一个标记，返回标记 id */
  async function mark(accountId: string, x: number, y: number, extra: Record<string, unknown> = {}, role: 'player' | 'agent' = 'player'): Promise<number> {
    const data = expectOk(await call(accountId, Op.ALLIANCE_MARK_ADD, { x, y, kind: 'enemy', ...extra }, role));
    return (data.mark as { id: number }).id;
  }
  const markRows = async (allianceId: string): Promise<number> =>
    (await pool.query(`SELECT count(*)::int AS n FROM alliance_marks WHERE alliance_id = $1`, [allianceId])).rows[0].n as number;
  const expireMark = (markId: number): Promise<unknown> =>
    pool.query(`UPDATE alliance_marks SET expires_at = now() - interval '1 minute' WHERE id = $1`, [markId]);

  before(async () => {
    tmp = await createTempDatabase(baseUrl as string, 'alliance-marks');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    (ctx as { pool: pg.Pool }).pool = pool;
  });
  after(async () => {
    await pool.end();
    await tmp.drop();
  });

  test('放置与查询：同盟成员可见，外人与无联盟者看不到也不能删', async () => {
    const a = await makeAlliance('标记甲');
    const m = await join(a.id, a.leader, 'mk-member');
    const outsider = await makeAccount('mk-outsider');

    const id = await mark(a.leader, 10, 20, { kind: 'rally', text: '集合' });
    const view = expectOk(await call(m, Op.GET_ALLIANCE_MARKS));
    const marks = view.marks as Array<Record<string, unknown>>;
    assert.equal(marks.length, 1);
    assert.equal(marks[0].id, id);
    assert.equal(marks[0].kind, 'rally');
    assert.equal(marks[0].text, '集合');
    assert.deepEqual(marks[0].creator, { accountId: a.leader, username: await nameOf(a.leader) });
    assert.equal(view.canRemoveAny, false, '普通成员不能删别人的');

    expectErr(await call(outsider, Op.GET_ALLIANCE_MARKS), 'ALLIANCE_NOT_IN');
    expectErr(await call(outsider, Op.ALLIANCE_MARK_ADD, { x: 1, y: 1, kind: 'enemy' }), 'ALLIANCE_NOT_IN');
    expectErr(await call(outsider, Op.ALLIANCE_MARK_REMOVE, { id }), 'ALLIANCE_NOT_IN');
    // 外人删不到同盟的标记：不泄露存在与否
    const other = await makeAlliance('标记乙');
    const otherMember = await join(other.id, other.leader, 'mk-other');
    expectErr(await call(otherMember, Op.ALLIANCE_MARK_REMOVE, { id }), 'ALLIANCE_NOT_FOUND');
    assert.equal(await markRows(a.id), 1);
  });

  test('附言：超 20 字、含屏蔽词、类型或坐标不合法都整条拒绝；空附言可以', async () => {
    const a = await makeAlliance('附言甲');
    const m = a.leader;
    expectErr(await call(m, Op.ALLIANCE_MARK_ADD, { x: 1, y: 1, kind: 'enemy', text: '字'.repeat(21) }), 'INVALID_PARAMS');
    expectErr(await call(m, Op.ALLIANCE_MARK_ADD, { x: 1, y: 1, kind: 'enemy', text: '这里有禁词' }), 'INVALID_PARAMS');
    expectErr(await call(m, Op.ALLIANCE_MARK_ADD, { x: 1, y: 1, kind: 'enemy', text: 42 }), 'INVALID_PARAMS');
    expectErr(await call(m, Op.ALLIANCE_MARK_ADD, { x: 1, y: 1, kind: 'boss' }), 'INVALID_PARAMS');
    expectErr(await call(m, Op.ALLIANCE_MARK_ADD, { x: 1, y: 1 }), 'INVALID_PARAMS');
    assert.equal(await markRows(a.id), 0, '被拒的标记不落库');

    // 恰好 20 字（按字形计）可以；空白会被去掉；缺省附言为空串
    const edge = expectOk(await call(m, Op.ALLIANCE_MARK_ADD, { x: 2, y: 2, kind: 'danger', text: `  ${'字'.repeat(20)}  ` }));
    assert.equal((edge.mark as { text: string }).text, '字'.repeat(20));
    const plain = expectOk(await call(m, Op.ALLIANCE_MARK_ADD, { x: 3, y: 3, kind: 'resource' }));
    assert.equal((plain.mark as { text: string }).text, '');
  });

  test('坐标必须在世界范围内', async () => {
    const a = await makeAlliance('坐标甲');
    for (const [x, y] of [[-1, 0], [0, -1], [1000, 0], [0, 1000], [1.5, 2], [NaN, 2]]) {
      expectErr(await call(a.leader, Op.ALLIANCE_MARK_ADD, { x, y, kind: 'enemy' }), 'INVALID_PARAMS');
    }
    expectOk(await call(a.leader, Op.ALLIANCE_MARK_ADD, { x: 0, y: 999, kind: 'enemy' }));
  });

  test('同一格子不能重复标记（ALLIANCE_MARK_EXISTS）；删掉后可以再打', async () => {
    const a = await makeAlliance('同格甲');
    const first = await mark(a.leader, 50, 60);
    expectErr(await call(a.leader, Op.ALLIANCE_MARK_ADD, { x: 50, y: 60, kind: 'danger' }), 'ALLIANCE_MARK_EXISTS');
    // 别的联盟同一格子不受影响
    const b = await makeAlliance('同格乙');
    await mark(b.leader, 50, 60);
    expectOk(await call(a.leader, Op.ALLIANCE_MARK_REMOVE, { id: first }));
    await mark(a.leader, 50, 60);
  });

  test('同盟最多 20 个：第 21 个被拒，并附最早一个的到期时刻', async () => {
    const a = await makeAlliance('上限甲');
    const ids: number[] = [];
    for (let i = 0; i < ALLIANCE_MARK_MAX; i += 1) {
      ids.push(await mark(a.leader, 100 + i, 100));
    }
    const full = await call(a.leader, Op.ALLIANCE_MARK_ADD, { x: 200, y: 200, kind: 'enemy' });
    expectErr(full, 'ALLIANCE_MARK_LIMIT');
    assert.equal(full.data?.limit, ALLIANCE_MARK_MAX);
    assert.ok(typeof full.data?.until === 'string');
    const secs = Number(full.data?.retryAfterSeconds);
    assert.ok(secs > ALLIANCE_MARK_TTL_MS / 1000 - 120 && secs <= ALLIANCE_MARK_TTL_MS / 1000, `retryAfterSeconds=${secs}`);

    // 让最早的一个提前到期，名额随即释放（过期的不计）
    await expireMark(ids[0]);
    await mark(a.leader, 200, 200);
    expectErr(await call(a.leader, Op.ALLIANCE_MARK_ADD, { x: 300, y: 300, kind: 'enemy' }), 'ALLIANCE_MARK_LIMIT');
  });

  test('过期的标记不返回、被回收；过期格子可以重新标记', async () => {
    const a = await makeAlliance('过期甲');
    const id = await mark(a.leader, 70, 70);
    await mark(a.leader, 71, 70);
    await expireMark(id);
    const view = expectOk(await call(a.leader, Op.GET_ALLIANCE_MARKS));
    assert.equal((view.marks as unknown[]).length, 1, '过期的不返回');
    // 过期但还没回收的行，同格重新标记时先回收，不报重复
    await mark(a.leader, 70, 70);
    assert.equal(await markRows(a.id), 2);
    // Worker 的定时回收会删掉过期行（只删过期的，有效的留着）
    const stale = await mark(a.leader, 72, 70);
    await expireMark(stale);
    assert.equal(await markRows(a.id), 3);
    await purgeExpired(pool);
    assert.equal(await markRows(a.id), 2, '回收只删过期的行');
    expectErr(await call(a.leader, Op.ALLIANCE_MARK_REMOVE, { id: stale }), 'ALLIANCE_NOT_FOUND');
  });

  test('权限：成员只能删自己的；盟主 / 副盟主能删任何人的', async () => {
    const a = await makeAlliance('权限甲');
    const v = await join(a.id, a.leader, 'perm-vice');
    const m1 = await join(a.id, a.leader, 'perm-m1');
    const m2 = await join(a.id, a.leader, 'perm-m2');
    expectOk(await call(a.leader, Op.ALLIANCE_SET_ROLE, { accountId: v, role: 'vice' }));

    const byM1 = await mark(m1, 80, 80);
    const byM2 = await mark(m2, 81, 80);
    expectErr(await call(m1, Op.ALLIANCE_MARK_REMOVE, { id: byM2 }), 'ALLIANCE_FORBIDDEN');
    expectOk(await call(m1, Op.ALLIANCE_MARK_REMOVE, { id: byM1 }));
    assert.equal((expectOk(await call(m1, Op.GET_ALLIANCE_MARKS)).marks as unknown[]).length, 1);

    expectOk(await call(v, Op.ALLIANCE_MARK_REMOVE, { id: byM2 }));
    const byVice = await mark(v, 82, 80);
    expectOk(await call(a.leader, Op.ALLIANCE_MARK_REMOVE, { id: byVice }));
    expectErr(await call(a.leader, Op.ALLIANCE_MARK_REMOVE, { id: byVice }), 'ALLIANCE_NOT_FOUND');
    expectErr(await call(a.leader, Op.ALLIANCE_MARK_REMOVE, { id: 0 }), 'INVALID_PARAMS');
    assert.equal(await markRows(a.id), 0);

    const view = expectOk(await call(a.leader, Op.GET_ALLIANCE_MARKS));
    assert.equal(view.canRemoveAny, true);
  });

  test('Agent：可以查看与新增；只能删自己打的，即使身份是盟主', async () => {
    const a = await makeAlliance('代理甲');
    const m = await join(a.id, a.leader, 'agent-m');
    // Agent 连接用的仍是账号本人：盟主账号的 Agent 也只能删自己的
    const leaderMark = await mark(a.leader, 90, 90, { kind: 'resource' }, 'agent');
    const memberMark = await mark(m, 91, 90, {}, 'agent');
    expectErr(await call(a.leader, Op.ALLIANCE_MARK_REMOVE, { id: memberMark }, 'agent'), 'ALLIANCE_FORBIDDEN');
    expectOk(await call(m, Op.ALLIANCE_MARK_REMOVE, { id: memberMark }, 'agent'));
    expectOk(await call(a.leader, Op.ALLIANCE_MARK_REMOVE, { id: leaderMark }, 'agent'));

    await mark(m, 92, 90, {}, 'agent');
    const view = expectOk(await call(a.leader, Op.GET_ALLIANCE_MARKS, undefined, 'agent'));
    assert.equal((view.marks as unknown[]).length, 1);
    assert.equal(view.canRemoveAny, false, 'Agent 连接恒不能删别人的');
  });

  test('离盟后看不到旧联盟的标记；入新盟只看到新盟的', async () => {
    const a = await makeAlliance('离盟甲');
    const m = await join(a.id, a.leader, 'leave-m');
    await mark(m, 110, 110);
    await mark(a.leader, 111, 110);
    expectOk(await call(m, Op.ALLIANCE_LEAVE));
    expectErr(await call(m, Op.GET_ALLIANCE_MARKS), 'ALLIANCE_NOT_IN');
    expectErr(await call(m, Op.ALLIANCE_MARK_REMOVE, { id: 1 }), 'ALLIANCE_NOT_IN');

    const b = await makeAlliance('离盟乙');
    await clearCooldownFor(m);
    expectOk(await call(b.leader, Op.ALLIANCE_INVITE, { username: await nameOf(m) }));
    expectOk(await call(m, Op.ALLIANCE_RESPOND, { kind: 'invite', allianceId: b.id, accept: true }));
    assert.equal((await getMembership(pool, m))?.allianceId, b.id);
    assert.equal((expectOk(await call(m, Op.GET_ALLIANCE_MARKS)).marks as unknown[]).length, 0, '旧联盟的标记不带过来');
  });

  test('解散后标记随外键级联删除', async () => {
    const a = await makeAlliance('解散甲');
    const m = await join(a.id, a.leader, 'disband-m');
    await mark(a.leader, 120, 120);
    await mark(m, 121, 120);
    assert.equal(await markRows(a.id), 2);
    expectOk(await call(a.leader, Op.ALLIANCE_DISBAND));
    assert.equal(await markRows(a.id), 0, '解散后标记清空');
  });

  test('推送：增删都推给本盟成员（含 Agent 连接），外人不收', async () => {
    const a = await makeAlliance('推送甲');
    const m = await join(a.id, a.leader, 'push-m');
    const outsider = await makeAccount('push-outsider');
    pushes.length = 0;

    const id = await mark(m, 130, 130, { kind: 'danger' });
    const added = pushes.filter((p) => p.data.reason === 'added');
    assert.deepEqual(new Set(added.map((p) => p.accountId)), new Set([a.leader, m]));
    assert.equal(added[0].data.markId, id);
    assert.equal(added[0].data.allianceId, a.id);
    assert.equal((added[0].data.mark as { x: number }).x, 130);
    assert.ok(!pushes.some((p) => p.accountId === outsider));

    pushes.length = 0;
    expectOk(await call(m, Op.ALLIANCE_MARK_REMOVE, { id }));
    assert.deepEqual(new Set(pushes.map((p) => p.accountId)), new Set([a.leader, m]));
    assert.equal(pushes[0].data.reason, 'removed');
    assert.equal(pushes[0].data.mark, null);
    assert.equal(pushes[0].data.markId, id);
  });

  test('放置标记在联盟频道写一条系统消息（alliance_mark_created）', async () => {
    const a = await makeAlliance('频道甲');
    const m = await join(a.id, a.leader, 'chan-m');
    const before = (await pool.query(`SELECT count(*)::int AS n FROM chat_messages WHERE alliance_id = $1`, [a.id])).rows[0].n as number;
    const id = await mark(m, 140, 141, { kind: 'rally', text: '集合' });
    const rows = await pool.query(
      `SELECT system_event FROM chat_messages WHERE alliance_id = $1 AND system_event->>'kind' = 'alliance_mark_created'`,
      [a.id],
    );
    assert.equal(rows.rowCount, 1);
    const system = rows.rows[0].system_event as Record<string, unknown>;
    assert.deepEqual(system, {
      kind: 'alliance_mark_created',
      player: { accountId: m, username: await nameOf(m) },
      markKind: 'rally',
      x: 140,
      y: 141,
    });
    // 附言不进系统消息；删除不写系统消息
    assert.ok(!JSON.stringify(system).includes('集合'));
    expectOk(await call(m, Op.ALLIANCE_MARK_REMOVE, { id }));
    const after = await pool.query(`SELECT count(*)::int AS n FROM chat_messages WHERE alliance_id = $1`, [a.id]);
    assert.equal(after.rows[0].n, before + 1, '放置多一条，删除不写');
  });

  /** 测试辅助：清掉某账号的冷却，便于它马上入新盟 */
  async function clearCooldownFor(accountId: string): Promise<void> {
    await pool.query(`UPDATE accounts SET alliance_cooldown_until = NULL WHERE id = $1`, [accountId]);
  }
});
