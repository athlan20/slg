// 联盟（v66，AISLG-181）：建盟 / 入盟 / 职位 / 踢人 / 退出 / 冷却 / 盟主自动转让 / Agent 拦截。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL 才会跑（在其所指服务器上另建一次性数据库，别指向开发库）。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { Op } from '../common/src/protocol';
import {
  ALLIANCE_COOLDOWN_MS,
  ALLIANCE_CREATE_COST_GOLD,
  ALLIANCE_LEADER_INACTIVE_MS,
  ALLIANCE_MAX_MEMBERS,
} from '../common/src/protocol-alliance';
import {
  areAllies,
  cannotAttack,
  getMembership,
  hostileAllianceFor,
  loadDiplomacy,
  purgeExpired,
  transferInactiveLeaders,
} from '../common/src/alliance-db';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleAllianceOp } from '../api/src/handlers-alliance';
import { handleAllianceDiplomacyOp } from '../api/src/handlers-alliance-diplomacy';
import { normalizeAllianceName } from '../api/src/handlers-alliance-manage';
import { initBannedWordFilter } from '../api/src/chat-words';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const baseUrl = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;

test('联盟名校验：2–8 字、不含空白、不含屏蔽词', () => {
  const dir = mkdtempSync(join(tmpdir(), 'slg-alliance-words-'));
  try {
    writeFileSync(join(dir, 'words.txt'), '禁词\n');
    initBannedWordFilter({ CHAT_BANNED_WORDS_FILE: join(dir, 'words.txt') } as NodeJS.ProcessEnv);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(normalizeAllianceName('禁词盟'), null);
  assert.equal(normalizeAllianceName('禁 词盟'), null);
  assert.equal(normalizeAllianceName(' 卧龙盟 '), '卧龙盟');
  assert.equal(normalizeAllianceName('龙'), null);
  assert.equal(normalizeAllianceName('一二三四五六七八九'), null);
  assert.equal(normalizeAllianceName('卧 龙'), null);
  assert.ok(normalizeAllianceName('一二三四五六七八') !== null);
});

describe('联盟（需 TEST_DATABASE_URL）', { skip: baseUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let tmp: TempDatabase;
  let pool: pg.Pool;
  let seq = 0;

  interface Frame { ok: boolean; data?: Record<string, unknown>; error?: { code: string; [k: string]: unknown } }
  let last: Frame | undefined;
  const pushes: Array<{ accountId: string; data: Record<string, unknown> }> = [];
  const registry = {
    send: (_conn: ConnInfo, frame: Frame) => {
      last = { ok: frame.ok ?? true, data: frame.data, error: frame.error };
    },
    broadcast: (accountId: string, frame: { op: number; data: Record<string, unknown> }) => {
      if (frame.op === Op.PUSH_ALLIANCE_STATE) {
        pushes.push({ accountId, data: frame.data });
      }
      return 1;
    },
    onlineAccountIds: () => [] as string[],
    connectionsOf: () => [] as ConnInfo[],
  } as unknown as ConnectionRegistry;
  const ctx = { pool: undefined as unknown as pg.Pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;

  const conn = (accountId: string, role: 'player' | 'agent' = 'player'): ConnInfo =>
    ({ accountId, host: null, role }) as unknown as ConnInfo;

  async function call(accountId: string, op: number, data?: Record<string, unknown>, role: 'player' | 'agent' = 'player'): Promise<Frame> {
    last = undefined;
    await handleAllianceOp(ctx, conn(accountId, role), op, (seq += 1), data);
    assert.ok(last, `op ${op} 没有回包`);
    return last as Frame;
  }
  async function callDiplomacy(accountId: string, op: number, data?: Record<string, unknown>, role: 'player' | 'agent' = 'player'): Promise<Frame> {
    last = undefined;
    await handleAllianceDiplomacyOp(ctx, conn(accountId, role), op, (seq += 1), data);
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

  /** 建账号；government > 0 时配一座主城（官府等级 + 金币） */
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
  const goldOf = async (accountId: string): Promise<number> =>
    (await pool.query(`SELECT gold FROM cities WHERE account_id = $1`, [accountId])).rows[0].gold as number;
  const clearCooldown = (accountId: string): Promise<unknown> =>
    pool.query(`UPDATE accounts SET alliance_cooldown_until = NULL WHERE id = $1`, [accountId]);

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

  before(async () => {
    tmp = await createTempDatabase(baseUrl as string, 'alliance');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    (ctx as { pool: pg.Pool }).pool = pool;
  });
  after(async () => {
    await pool.end();
    await tmp.drop();
  });

  test('建盟：官府不够 / 金币不够 / 名字不合法 / 重名（忽略大小写）', async () => {
    const low = await makeAccount('low', { government: 4, gold: 500000 });
    const err = await call(low, Op.CREATE_ALLIANCE, { name: '低官府盟' });
    expectErr(err, 'ALLIANCE_GOVERNMENT_TOO_LOW');
    assert.equal(err.data?.required, 5);
    assert.equal(err.data?.current, 4);

    const poor = await makeAccount('poor', { government: 5, gold: 99_000 });
    expectErr(await call(poor, Op.CREATE_ALLIANCE, { name: '穷人盟' }), 'INSUFFICIENT_RESOURCES');
    assert.equal(await goldOf(poor), 99_000);

    const rich = await makeAccount('rich', { government: 5, gold: ALLIANCE_CREATE_COST_GOLD + 123 });
    expectErr(await call(rich, Op.CREATE_ALLIANCE, { name: '龙' }), 'ALLIANCE_NAME_INVALID');
    expectErr(await call(rich, Op.CREATE_ALLIANCE, { name: '带 空格' }), 'ALLIANCE_NAME_INVALID');
    expectErr(await call(rich, Op.CREATE_ALLIANCE, {}), 'ALLIANCE_NAME_INVALID');
    const created = expectOk(await call(rich, Op.CREATE_ALLIANCE, { name: 'AbcDef' }));
    assert.equal(created.cost, ALLIANCE_CREATE_COST_GOLD);
    assert.equal(await goldOf(rich), 123);
    assert.deepEqual(await getMembership(pool, rich), { allianceId: created.allianceId as string, role: 'leader' });

    const other = await makeAccount('other', { government: 5, gold: 500000 });
    expectErr(await call(other, Op.CREATE_ALLIANCE, { name: 'abcdef' }), 'ALLIANCE_NAME_TAKEN');
    assert.equal(await goldOf(other), 500000, '重名不扣金币');
    expectErr(await call(rich, Op.CREATE_ALLIANCE, { name: '又一个盟' }), 'ALLIANCE_ALREADY_IN');
  });

  test('申请 → 审批：一人一条申请，撤回后可改投；拒绝不入盟', async () => {
    const a = await makeAlliance('甲申请盟');
    const b = await makeAlliance('乙申请盟');
    const p = await makeAccount('applicant');
    expectOk(await call(p, Op.ALLIANCE_APPLY, { allianceId: a.id }));
    expectErr(await call(p, Op.ALLIANCE_APPLY, { allianceId: b.id }), 'ALLIANCE_REQUEST_EXISTS');
    expectErr(await call(p, Op.ALLIANCE_APPLY, { allianceId: '00000000-0000-4000-8000-000000000000' }), 'ALLIANCE_NOT_FOUND');
    // 盟主视角能看到待审批的申请
    const view = expectOk(await call(a.leader, Op.GET_ALLIANCE, {}));
    assert.equal((view.requests as unknown[]).length, 1);
    // 撤回后改投乙
    expectOk(await call(p, Op.ALLIANCE_APPLY, { allianceId: a.id, cancel: true }));
    expectErr(await call(p, Op.ALLIANCE_APPLY, { allianceId: a.id, cancel: true }), 'ALLIANCE_NOT_FOUND');
    expectOk(await call(p, Op.ALLIANCE_APPLY, { allianceId: b.id }));
    // 乙盟主拒绝 → 仍无联盟
    expectOk(await call(b.leader, Op.ALLIANCE_RESPOND, { kind: 'request', accountId: p, accept: false }));
    assert.equal(await getMembership(pool, p), null);
    // 再申请乙并通过 → 成为普通成员，并清掉其余申请
    expectOk(await call(p, Op.ALLIANCE_APPLY, { allianceId: b.id }));
    expectOk(await call(b.leader, Op.ALLIANCE_RESPOND, { kind: 'request', accountId: p, accept: true }));
    assert.equal((await getMembership(pool, p))?.role, 'member');
    // 非管理者不能审批
    const q = await makeAccount('applicant2');
    expectOk(await call(q, Op.ALLIANCE_APPLY, { allianceId: b.id }));
    expectErr(await call(p, Op.ALLIANCE_RESPOND, { kind: 'request', accountId: q, accept: true }), 'ALLIANCE_FORBIDDEN');
  });

  test('邀请：被邀请人接受 / 拒绝；邀请占名额；重复邀请覆盖；撤回', async () => {
    const a = await makeAlliance('邀请盟');
    const guest = await makeAccount('guest');
    const guestName = (await pool.query(`SELECT username FROM accounts WHERE id = $1`, [guest])).rows[0].username as string;
    expectOk(await call(a.leader, Op.ALLIANCE_INVITE, { username: guestName }));
    expectOk(await call(a.leader, Op.ALLIANCE_INVITE, { username: guestName })); // 覆盖，不会多占名额
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM alliance_invites WHERE alliance_id = $1`, [a.id])).rows[0].n, 1);
    expectErr(await call(a.leader, Op.ALLIANCE_INVITE, { username: 'nobody-here' }), 'ALLIANCE_NOT_FOUND');
    const mine = expectOk(await call(guest, Op.GET_ALLIANCE, {}));
    assert.equal((mine.myInvites as unknown[]).length, 1);
    // 撤回再邀
    expectOk(await call(a.leader, Op.ALLIANCE_INVITE, { username: guestName, cancel: true }));
    expectErr(await call(guest, Op.ALLIANCE_RESPOND, { kind: 'invite', allianceId: a.id, accept: true }), 'ALLIANCE_NOT_FOUND');
    expectOk(await call(a.leader, Op.ALLIANCE_INVITE, { username: guestName }));
    // 拒绝后邀请消失
    expectOk(await call(guest, Op.ALLIANCE_RESPOND, { kind: 'invite', allianceId: a.id, accept: false }));
    assert.equal(await getMembership(pool, guest), null);
    // 再邀，接受
    expectOk(await call(a.leader, Op.ALLIANCE_INVITE, { username: guestName }));
    expectOk(await call(guest, Op.ALLIANCE_RESPOND, { kind: 'invite', allianceId: a.id, accept: true }));
    assert.equal((await getMembership(pool, guest))?.role, 'member');
    // 普通成员不能邀请
    expectErr(await call(guest, Op.ALLIANCE_INVITE, { username: 'whoever' }), 'ALLIANCE_FORBIDDEN');
  });

  test('成员上限：待处理邀请也占名额', async () => {
    const a = await makeAlliance('满员盟');
    // 直接灌 28 个成员（加盟主共 29）
    for (let i = 0; i < ALLIANCE_MAX_MEMBERS - 2; i += 1) {
      const m = await makeAccount(`fill-${i}`);
      await pool.query(`INSERT INTO alliance_members (account_id, alliance_id, role) VALUES ($1, $2, 'member')`, [m, a.id]);
    }
    const x = await makeAccount('inv-x');
    const y = await makeAccount('inv-y');
    const nameOf = async (id: string): Promise<string> => (await pool.query(`SELECT username FROM accounts WHERE id = $1`, [id])).rows[0].username as string;
    expectOk(await call(a.leader, Op.ALLIANCE_INVITE, { username: await nameOf(x) })); // 29 + 1 = 30
    expectErr(await call(a.leader, Op.ALLIANCE_INVITE, { username: await nameOf(y) }), 'ALLIANCE_FULL');
    // 满了也不能再申请
    expectErr(await call(y, Op.ALLIANCE_APPLY, { allianceId: a.id }), 'ALLIANCE_FULL');
    // 被邀请人接受自己那条邀请不被名额挡住
    expectOk(await call(x, Op.ALLIANCE_RESPOND, { kind: 'invite', allianceId: a.id, accept: true }));
    assert.equal((await getMembership(pool, x))?.allianceId, a.id);
  });

  test('退出 / 被踢进入 24 小时冷却：不能申请、不能创建', async () => {
    const a = await makeAlliance('冷却盟');
    const m = await join(a.id, a.leader, 'cd-member');
    expectOk(await call(m, Op.ALLIANCE_LEAVE));
    assert.equal(await getMembership(pool, m), null);
    const apply = await call(m, Op.ALLIANCE_APPLY, { allianceId: a.id });
    expectErr(apply, 'ALLIANCE_COOLDOWN');
    assert.ok(typeof apply.data?.until === 'string');
    const secs = Number(apply.data?.retryAfterSeconds);
    assert.ok(secs > ALLIANCE_COOLDOWN_MS / 1000 - 60 && secs <= ALLIANCE_COOLDOWN_MS / 1000, `retryAfterSeconds=${secs}`);
    // 有主城、够条件的人冷却中也不能创建
    await pool.query(`UPDATE accounts SET alliance_cooldown_until = now() + interval '1 hour' WHERE id = $1`, [a.leader]);
    // 盟主在联盟里：先看被踢
    const k = await join(a.id, a.leader, 'cd-kicked');
    expectOk(await call(a.leader, Op.ALLIANCE_KICK, { accountId: k }));
    expectErr(await call(k, Op.ALLIANCE_APPLY, { allianceId: a.id }), 'ALLIANCE_COOLDOWN');
    // 邀请接受同样受冷却限制
    const kName = (await pool.query(`SELECT username FROM accounts WHERE id = $1`, [k])).rows[0].username as string;
    expectOk(await call(a.leader, Op.ALLIANCE_INVITE, { username: kName }));
    expectErr(await call(k, Op.ALLIANCE_RESPOND, { kind: 'invite', allianceId: a.id, accept: true }), 'ALLIANCE_COOLDOWN');
    // 冷却过后可以加入
    await clearCooldown(k);
    expectOk(await call(k, Op.ALLIANCE_RESPOND, { kind: 'invite', allianceId: a.id, accept: true }));
    assert.equal((await getMembership(pool, k))?.allianceId, a.id);
    // 创建者冷却中不能再建（解散后）
    const founder = await makeAccount('founder', { government: 5, gold: 3 * ALLIANCE_CREATE_COST_GOLD });
    expectOk(await call(founder, Op.CREATE_ALLIANCE, { name: '建了就散' }));
    expectOk(await call(founder, Op.ALLIANCE_DISBAND));
    expectErr(await call(founder, Op.CREATE_ALLIANCE, { name: '再建一个' }), 'ALLIANCE_COOLDOWN');
  });

  test('职位：副盟主上限 2，踢人权限，不能踢盟主', async () => {
    const a = await makeAlliance('职位盟');
    const v1 = await join(a.id, a.leader, 'vice-1');
    const v2 = await join(a.id, a.leader, 'vice-2');
    const v3 = await join(a.id, a.leader, 'vice-3');
    const m1 = await join(a.id, a.leader, 'plain-1');
    expectOk(await call(a.leader, Op.ALLIANCE_SET_ROLE, { accountId: v1, role: 'vice' }));
    expectOk(await call(a.leader, Op.ALLIANCE_SET_ROLE, { accountId: v2, role: 'vice' }));
    expectErr(await call(a.leader, Op.ALLIANCE_SET_ROLE, { accountId: v3, role: 'vice' }), 'ALLIANCE_ROLE_FULL');
    // 只有盟主能任免
    expectErr(await call(v1, Op.ALLIANCE_SET_ROLE, { accountId: v3, role: 'vice' }), 'ALLIANCE_FORBIDDEN');
    // 副盟主不能踢副盟主，也不能踢盟主；能踢普通成员
    expectErr(await call(v1, Op.ALLIANCE_KICK, { accountId: v2 }), 'ALLIANCE_FORBIDDEN');
    expectErr(await call(v1, Op.ALLIANCE_KICK, { accountId: a.leader }), 'ALLIANCE_FORBIDDEN');
    expectOk(await call(v1, Op.ALLIANCE_KICK, { accountId: m1 }));
    // 普通成员不能踢人
    expectErr(await call(v3, Op.ALLIANCE_KICK, { accountId: v2 }), 'ALLIANCE_FORBIDDEN');
    // 不能踢自己（参数非法）、不能踢外人
    expectErr(await call(a.leader, Op.ALLIANCE_KICK, { accountId: a.leader }), 'INVALID_PARAMS');
    expectErr(await call(a.leader, Op.ALLIANCE_KICK, { accountId: m1 }), 'ALLIANCE_NOT_FOUND');
    // 盟主可以踢副盟主；撤销副盟主后可再任命
    expectOk(await call(a.leader, Op.ALLIANCE_SET_ROLE, { accountId: v2, role: 'member' }));
    expectOk(await call(a.leader, Op.ALLIANCE_SET_ROLE, { accountId: v3, role: 'vice' }));
    expectOk(await call(a.leader, Op.ALLIANCE_KICK, { accountId: v1 }));
    // 副盟主能改公告，普通成员不能
    expectOk(await call(v3, Op.ALLIANCE_SET_NOTICE, { notice: '集结令' }));
    expectErr(await call(v2, Op.ALLIANCE_SET_NOTICE, { notice: '捣乱' }), 'ALLIANCE_FORBIDDEN');
    expectErr(await call(a.leader, Op.ALLIANCE_SET_NOTICE, { notice: '字'.repeat(201) }), 'INVALID_PARAMS');
    const detail = expectOk(await call(v2, Op.GET_ALLIANCE, {}));
    assert.equal((detail.alliance as { notice: string }).notice, '集结令');
  });

  test('盟主退出 / 转让 / 解散', async () => {
    const a = await makeAlliance('转让盟');
    const m = await join(a.id, a.leader, 'heir');
    expectErr(await call(a.leader, Op.ALLIANCE_LEAVE), 'ALLIANCE_LEADER_MUST_TRANSFER');
    expectErr(await call(m, Op.ALLIANCE_DISBAND), 'ALLIANCE_FORBIDDEN');
    expectErr(await call(a.leader, Op.ALLIANCE_SET_ROLE, { accountId: a.leader, role: 'leader' }), 'INVALID_PARAMS');
    // 转让给普通成员（不必先是副盟主）：原盟主降为成员
    expectOk(await call(a.leader, Op.ALLIANCE_SET_ROLE, { accountId: m, role: 'leader' }));
    assert.equal((await getMembership(pool, m))?.role, 'leader');
    assert.equal((await getMembership(pool, a.leader))?.role, 'member');
    assert.equal((await pool.query(`SELECT leader_id FROM alliances WHERE id = $1`, [a.id])).rows[0].leader_id, m);
    // 新盟主解散：全员离盟；只有解散者吃冷却
    expectOk(await call(m, Op.ALLIANCE_DISBAND));
    assert.equal(await getMembership(pool, a.leader), null);
    assert.equal((await pool.query(`SELECT alliance_cooldown_until FROM accounts WHERE id = $1`, [a.leader])).rows[0].alliance_cooldown_until, null);
    assert.notEqual((await pool.query(`SELECT alliance_cooldown_until FROM accounts WHERE id = $1`, [m])).rows[0].alliance_cooldown_until, null);
    // 只剩盟主一人时退出等于解散
    const solo = await makeAlliance('独行盟');
    const left = expectOk(await call(solo.leader, Op.ALLIANCE_LEAVE));
    assert.equal(left.disbanded, true);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM alliances WHERE id = $1`, [solo.id])).rows[0].n, 0);
  });

  test('Agent：管理类一律 AGENT_FORBIDDEN，查询类正常', async () => {
    const a = await makeAlliance('防代理盟');
    const guest = await makeAccount('agent-target');
    const managed: Array<[number, Record<string, unknown> | undefined]> = [
      [Op.CREATE_ALLIANCE, { name: '代理盟' }],
      [Op.ALLIANCE_APPLY, { allianceId: a.id }],
      [Op.ALLIANCE_INVITE, { username: 'x' }],
      [Op.ALLIANCE_RESPOND, { kind: 'invite', allianceId: a.id, accept: true }],
      [Op.ALLIANCE_LEAVE, undefined],
      [Op.ALLIANCE_DISBAND, undefined],
      [Op.ALLIANCE_KICK, { accountId: guest }],
      [Op.ALLIANCE_SET_ROLE, { accountId: guest, role: 'vice' }],
      [Op.ALLIANCE_SET_NOTICE, { notice: 'x' }],
    ];
    for (const [op, data] of managed) {
      expectErr(await call(a.leader, op, data, 'agent'), 'AGENT_FORBIDDEN');
    }
    assert.ok(await getMembership(pool, a.leader), 'Agent 调用不改变任何状态');
    const mine = expectOk(await call(a.leader, Op.GET_ALLIANCE, {}, 'agent'));
    assert.equal((mine.alliance as { id: string }).id, a.id);
    const list = expectOk(await call(a.leader, Op.LIST_ALLIANCES, {}, 'agent'));
    assert.ok((list.total as number) >= 1);
    const pub = expectOk(await call(guest, Op.GET_ALLIANCE, { allianceId: a.id }, 'agent'));
    assert.equal((pub.myRole as unknown), null);
    assert.equal((pub.requests as unknown[]).length, 0);
    expectErr(await call(guest, Op.GET_ALLIANCE, { allianceId: '00000000-0000-4000-8000-000000000000' }, 'agent'), 'ALLIANCE_NOT_FOUND');
    expectErr(await call(guest, Op.GET_ALLIANCE, { allianceId: 'bad' }, 'agent'), 'INVALID_PARAMS');
  });

  test('盟主 7 天不活跃自动转让：副盟主优先（取最近活跃），否则最早入盟；活跃的盟主不动', async () => {
    const stale = new Date(Date.now() - ALLIANCE_LEADER_INACTIVE_MS - DAY);
    const setActive = (id: string, at: Date): Promise<unknown> => pool.query(`UPDATE accounts SET last_active_at = $2 WHERE id = $1`, [id, at]);

    // 有两个副盟主：转给最近活跃的那个
    const a = await makeAlliance('自动转让甲');
    const first = await join(a.id, a.leader, 'auto-first');
    const vA = await join(a.id, a.leader, 'auto-vice-a');
    const vB = await join(a.id, a.leader, 'auto-vice-b');
    expectOk(await call(a.leader, Op.ALLIANCE_SET_ROLE, { accountId: vA, role: 'vice' }));
    expectOk(await call(a.leader, Op.ALLIANCE_SET_ROLE, { accountId: vB, role: 'vice' }));
    await setActive(a.leader, stale);
    await setActive(vA, new Date(Date.now() - 3 * DAY));
    await setActive(vB, new Date(Date.now() - 1 * DAY));
    const moves = await transferInactiveLeaders(pool, ALLIANCE_LEADER_INACTIVE_MS);
    const mine = moves.filter((m) => m.allianceId === a.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].to, vB);
    assert.equal((await getMembership(pool, vB))?.role, 'leader');
    assert.equal((await getMembership(pool, a.leader))?.role, 'member');
    assert.equal((await getMembership(pool, first))?.role, 'member');

    // 没有副盟主：转给最早入盟的成员
    const b = await makeAlliance('自动转让乙');
    const early = await join(b.id, b.leader, 'auto-early');
    await join(b.id, b.leader, 'auto-late');
    await pool.query(`UPDATE alliance_members SET joined_at = now() - interval '5 days' WHERE account_id = $1`, [early]);
    await setActive(b.leader, stale);
    await transferInactiveLeaders(pool, ALLIANCE_LEADER_INACTIVE_MS);
    assert.equal((await getMembership(pool, early))?.role, 'leader');

    // 盟主刚活跃过：不动；盟里只有盟主一人：不动
    const c = await makeAlliance('自动转让丙');
    await join(c.id, c.leader, 'auto-c-member');
    await setActive(c.leader, new Date());
    const d = await makeAlliance('自动转让丁');
    await setActive(d.leader, stale);
    const again = await transferInactiveLeaders(pool, ALLIANCE_LEADER_INACTIVE_MS);
    assert.ok(!again.some((m) => m.allianceId === c.id || m.allianceId === d.id));
    assert.equal((await getMembership(pool, c.leader))?.role, 'leader');
    assert.equal((await getMembership(pool, d.leader))?.role, 'leader');
  });

  test('过期的申请 / 邀请不返回且会被回收；areAllies 只认同联盟', async () => {
    const a = await makeAlliance('过期盟');
    const p = await makeAccount('expiring');
    expectOk(await call(p, Op.ALLIANCE_APPLY, { allianceId: a.id }));
    await pool.query(`UPDATE alliance_requests SET expires_at = now() - interval '1 minute' WHERE account_id = $1`, [p]);
    assert.equal((expectOk(await call(a.leader, Op.GET_ALLIANCE, {})).requests as unknown[]).length, 0);
    expectErr(await call(a.leader, Op.ALLIANCE_RESPOND, { kind: 'request', accountId: p, accept: true }), 'ALLIANCE_NOT_FOUND');
    // 过期的旧申请不挡路：可以重新申请
    expectOk(await call(p, Op.ALLIANCE_APPLY, { allianceId: a.id }));
    await pool.query(`UPDATE alliance_requests SET expires_at = now() - interval '1 minute'`);
    await purgeExpired(pool);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM alliance_requests`)).rows[0].n, 0);

    const m = await join(a.id, a.leader, 'ally-member');
    const outsider = await makeAccount('outsider');
    assert.equal(await areAllies(pool, a.leader, m), true);
    assert.equal(await areAllies(pool, a.leader, outsider), false);
    assert.equal(await areAllies(pool, a.leader, a.leader), false);
  });

  test('外交：友盟互不攻击、敌对只标记、解除友好后冷却期仍不可攻击', async () => {
    const a = await makeAlliance('外交甲');
    const b = await makeAlliance('外交乙');
    const m = await join(b.id, b.leader, 'diplo-member');
    assert.equal(await cannotAttack(pool, a.leader, m), false, '中立可以攻击');

    const [x, y] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await pool.query(
      `INSERT INTO alliance_relations (a_id, b_id, relation, established_at) VALUES ($1, $2, 'friendly', now())`,
      [x, y],
    );
    assert.equal(await cannotAttack(pool, a.leader, m), true, '友盟不能攻击');
    const diplo = await loadDiplomacy(pool, a.id);
    assert.equal(diplo.friends.length, 1);
    assert.equal(diplo.friends[0].alliance.id, b.id);
    assert.equal(await hostileAllianceFor(pool, a.leader, m), null, '友盟不是敌对');

    await pool.query(`UPDATE alliance_relations SET relation = 'hostile' WHERE a_id = $1 AND b_id = $2`, [x, y]);
    assert.equal(await cannotAttack(pool, a.leader, m), false, '敌对不禁止攻击');
    assert.deepEqual(await hostileAllianceFor(pool, a.leader, m), { id: a.id, name: '外交甲' });

    await pool.query(
      `UPDATE alliance_relations SET relation = 'neutral', no_attack_until = now() + interval '24 hours',
              refriend_after = now() + interval '72 hours' WHERE a_id = $1 AND b_id = $2`,
      [x, y],
    );
    assert.equal(await cannotAttack(pool, a.leader, m), true, '解除友好 24 小时内仍不能攻击');
    assert.equal((await loadDiplomacy(pool, a.id)).friends.length, 0);
    await pool.query(`UPDATE alliance_relations SET no_attack_until = now() - interval '1 second' WHERE a_id = $1 AND b_id = $2`, [x, y]);
    assert.equal(await cannotAttack(pool, a.leader, m), false, '冷却结束恢复');
  });

  test('外交协议：邀请 / 同意 / 解除冷却 / 上限 / Agent 拦截', async () => {
    const a = await makeAlliance('外交协议甲');
    const b = await makeAlliance('外交协议乙');
    const c = await makeAlliance('外交协议丙');
    const d = await makeAlliance('外交协议丁');

    // Agent 不能发起
    expectErr(await callDiplomacy(a.leader, Op.ALLIANCE_DIPLOMACY_INVITE, { allianceId: b.id }, 'agent'), 'AGENT_FORBIDDEN');

    // a → b 邀请，b 同意
    expectOk(await callDiplomacy(a.leader, Op.ALLIANCE_DIPLOMACY_INVITE, { allianceId: b.id }));
    const bView = expectOk(await callDiplomacy(b.leader, Op.GET_ALLIANCE_DIPLOMACY));
    const inviteId = (bView.invites as Array<{ id: string }>)[0]?.id;
    assert.ok(inviteId, 'b 收到邀请');
    expectOk(await callDiplomacy(b.leader, Op.ALLIANCE_DIPLOMACY_RESPOND, { inviteId, accept: true }));
    assert.equal(await cannotAttack(pool, a.leader, b.leader), true);

    // 联盟频道各写一条系统消息
    const sys = await pool.query(
      `SELECT alliance_id, system_event->>'kind' AS kind FROM chat_messages
       WHERE alliance_id = ANY($1::uuid[]) AND system_event->>'kind' = 'alliance_diplomacy_friendly'`,
      [[a.id, b.id]],
    );
    assert.equal(sys.rowCount, 2, '双方联盟频道各一条系统消息');

    // 再结一个友盟后用满 2 个；第三个邀请被拒
    expectOk(await callDiplomacy(a.leader, Op.ALLIANCE_DIPLOMACY_INVITE, { allianceId: c.id }));
    const cView = expectOk(await callDiplomacy(c.leader, Op.GET_ALLIANCE_DIPLOMACY));
    const cInvite = (cView.invites as Array<{ id: string }>)[0]?.id;
    expectOk(await callDiplomacy(c.leader, Op.ALLIANCE_DIPLOMACY_RESPOND, { inviteId: cInvite, accept: true }));
    const limit = await callDiplomacy(a.leader, Op.ALLIANCE_DIPLOMACY_INVITE, { allianceId: d.id });
    expectErr(limit, 'DIPLOMACY_LIMIT');

    // 解除 a-b：24 小时内仍不能攻击，72 小时内不能再次结好
    expectOk(await callDiplomacy(a.leader, Op.ALLIANCE_DIPLOMACY_END, { allianceId: b.id }));
    assert.equal(await cannotAttack(pool, a.leader, b.leader), true);
    expectErr(await callDiplomacy(a.leader, Op.ALLIANCE_DIPLOMACY_INVITE, { allianceId: b.id }), 'DIPLOMACY_COOLDOWN');

    // 宣布敌对：只标记，不禁止攻击
    expectOk(await callDiplomacy(a.leader, Op.ALLIANCE_DIPLOMACY_HOSTILE, { allianceId: b.id }));
    assert.equal(await cannotAttack(pool, a.leader, b.leader), true, '从友好转敌对仍保留 24 小时冷却');
    const dView = expectOk(await callDiplomacy(a.leader, Op.GET_ALLIANCE_DIPLOMACY));
    assert.equal((dView.hostiles as unknown[]).length, 1);
  });

  test('推送：入盟、踢人给相关账号推 PUSH_ALLIANCE_STATE', async () => {
    const a = await makeAlliance('推送盟');
    pushes.length = 0;
    const m = await join(a.id, a.leader, 'push-member');
    assert.ok(pushes.some((p) => p.accountId === m && p.data.reason === 'joined'));
    assert.ok(pushes.some((p) => p.accountId === a.leader && p.data.reason === 'request_received'), '申请到达时盟主收到推送');
    pushes.length = 0;
    expectOk(await call(a.leader, Op.ALLIANCE_KICK, { accountId: m }));
    assert.ok(pushes.some((p) => p.accountId === m && p.data.reason === 'kicked' && p.data.allianceName === '推送盟'));
  });
});
