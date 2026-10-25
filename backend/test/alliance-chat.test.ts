// 联盟频道与系统消息（v68，AISLG-183）：成员收发、非成员 / 无联盟被拒、Agent 被拒、限频与屏蔽词、
// 盟间互不可见、入盟之后才可见、加入 / 退出 / 被踢 / 转让 / 不活跃自动转让产生系统消息、解散级联删除、保留期。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL 才会跑（在其所指服务器上另建一次性数据库，别指向开发库）。
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { Op } from '../common/src/protocol';
import { ALLIANCE_CREATE_COST_GOLD, ALLIANCE_LEADER_INACTIVE_MS } from '../common/src/protocol-alliance';
import { transferInactiveLeaders } from '../common/src/alliance-db';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleAllianceOp } from '../api/src/handlers-alliance';
import { handleChatOp } from '../api/src/handlers-chat';
import { pushAllianceMessage } from '../api/src/handlers-chat-send';
import * as chatDb from '../api/src/chat-db';
import { initBannedWordFilter } from '../api/src/chat-words';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const baseUrl = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;

describe('联盟频道与系统消息（需 TEST_DATABASE_URL）', { skip: baseUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let tmp: TempDatabase;
  let pool: pg.Pool;
  let wordsDir: string;
  let seq = 0;

  interface Frame { ok: boolean; data?: Record<string, any>; error?: { code: string; [k: string]: unknown } }
  interface Msg { id: number; channel: string; type: string; sender: { accountId: string; username: string } | null; text: string | null; system: Record<string, any> | null }
  let last: Frame | undefined;
  let online: string[] = [];
  const chatPushes: Array<{ accountId: string; message: Msg }> = [];
  const registry = {
    send: (_conn: ConnInfo, frame: Frame) => {
      last = { ok: frame.ok ?? true, data: frame.data, error: frame.error };
    },
    broadcast: () => 1,
    broadcastToPlayers: (accountId: string, frame: { op: number; data: { message: Msg } }) => {
      if (frame.op === Op.PUSH_CHAT_MESSAGE) {
        chatPushes.push({ accountId, message: frame.data.message });
      }
      return 1;
    },
    onlineAccountIds: () => online,
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
  async function chat(accountId: string, op: number, data?: Record<string, unknown>, role: 'player' | 'agent' = 'player'): Promise<Frame> {
    last = undefined;
    await handleChatOp(ctx, conn(accountId, role), op, (seq += 1), data);
    assert.ok(last, `chat op ${op} 没有回包`);
    return last as Frame;
  }
  const expectOk = (f: Frame): Record<string, any> => {
    assert.ok(f.ok, `期望成功，实际 ${JSON.stringify(f.error)}`);
    return f.data ?? {};
  };
  const expectErr = (f: Frame, code: string): void => {
    assert.equal(f.ok, false, `期望失败 ${code}，实际成功 ${JSON.stringify(f.data)}`);
    assert.equal(f.error?.code, code);
  };
  const say = (accountId: string, text: string): Promise<Frame> => chat(accountId, Op.CHAT_SEND, { channel: 'alliance', text });
  /** CHAT_SEND 的推送在回包之后异步发出，断言推送前先让出事件循环 */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30));
  const history = async (accountId: string, limit = 50): Promise<Msg[]> =>
    (expectOk(await chat(accountId, Op.CHAT_HISTORY, { channel: 'alliance', limit })).messages ?? []) as Msg[];

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
  const clearCooldown = (accountId: string): Promise<unknown> =>
    pool.query(`UPDATE accounts SET alliance_cooldown_until = NULL WHERE id = $1`, [accountId]);

  /** 建一个联盟（盟主官府 5 级、金币足够）：返回盟主与联盟 id */
  async function makeAlliance(name: string): Promise<{ leader: string; id: string }> {
    const leader = await makeAccount(`lead-${name}`, { government: 5, gold: ALLIANCE_CREATE_COST_GOLD + 5000 });
    const data = expectOk(await call(leader, Op.CREATE_ALLIANCE, { name }));
    return { leader, id: data.allianceId as string };
  }
  /** 经申请 + 审批入盟（普通成员）；成员本身不建主城，验证联盟频道没有官府门槛 */
  async function enlist(allianceId: string, leader: string, label: string): Promise<string> {
    const member = await makeAccount(label);
    expectOk(await call(member, Op.ALLIANCE_APPLY, { allianceId }));
    expectOk(await call(leader, Op.ALLIANCE_RESPOND, { kind: 'request', accountId: member, accept: true }));
    return member;
  }

  before(async () => {
    wordsDir = mkdtempSync(join(tmpdir(), 'slg-alliance-chat-'));
    writeFileSync(join(wordsDir, 'words.txt'), '敏感词\n');
    initBannedWordFilter({ CHAT_BANNED_WORDS_FILE: join(wordsDir, 'words.txt') } as NodeJS.ProcessEnv);
    tmp = await createTempDatabase(baseUrl as string, 'alliance_chat');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    (ctx as { pool: pg.Pool }).pool = pool;
  });
  after(async () => {
    await pool.end();
    await tmp.drop();
    rmSync(wordsDir, { recursive: true, force: true });
  });

  test('成员能收发；入盟之后的消息可见；无官府门槛', async () => {
    const { leader, id } = await makeAlliance('联甲');
    // 建盟时盟主自己入盟的系统消息：成员入盟之前发生，成员看不到
    const member = await enlist(id, leader, 'mem-a');
    const sent = expectOk(await say(leader, '  大家好  '));
    assert.equal(sent.message.channel, 'alliance');
    assert.equal(sent.message.type, 'text');
    assert.equal(sent.message.text, '大家好');
    assert.equal(sent.message.sender.accountId, leader);
    assert.equal(sent.message.recipient, null);

    const reply = expectOk(await say(member, '收到'));
    assert.equal(reply.message.sender.accountId, member);

    const seen = await history(member);
    const texts = seen.filter((m) => m.type === 'text').map((m) => m.text);
    assert.deepEqual(texts, ['大家好', '收到']);
    const systems = seen.filter((m) => m.type === 'system');
    assert.equal(systems.length, 1, '成员只看到自己入盟的那条系统消息');
    assert.equal(systems[0].system?.kind, 'alliance_joined');
    assert.equal(systems[0].system?.player.accountId, member);
    assert.equal(systems[0].system?.founder, false);
    assert.equal(seen.some((m) => m.system?.founder === true), false, '建盟消息发生在成员入盟之前');
    // 成员本人没有主城，仍然能发言（盟内频道不设官府门槛）
    assert.equal(await clearCooldown(member).then(() => true), true);
  });

  test('非成员与无联盟的玩家：读写都被拒（ALLIANCE_NOT_IN）', async () => {
    const { id } = await makeAlliance('联乙');
    assert.ok(id);
    const outsider = await makeAccount('outsider');
    expectErr(await chat(outsider, Op.CHAT_HISTORY, { channel: 'alliance' }), 'ALLIANCE_NOT_IN');
    expectErr(await say(outsider, '我想说话'), 'ALLIANCE_NOT_IN');
  });

  test('Agent 连接读写联盟频道都返回 AGENT_FORBIDDEN', async () => {
    const { leader } = await makeAlliance('联丙');
    expectErr(await chat(leader, Op.CHAT_HISTORY, { channel: 'alliance' }, 'agent'), 'AGENT_FORBIDDEN');
    expectErr(await chat(leader, Op.CHAT_SEND, { channel: 'alliance', text: '代发' }, 'agent'), 'AGENT_FORBIDDEN');
  });

  test('不同联盟互相看不到对方的消息', async () => {
    const a = await makeAlliance('联丁');
    const b = await makeAlliance('联戊');
    const aMember = await enlist(a.id, a.leader, 'mem-diff-a');
    const bMember = await enlist(b.id, b.leader, 'mem-diff-b');
    expectOk(await say(a.leader, '甲盟暗号'));
    expectOk(await say(b.leader, '乙盟暗号'));
    const aTexts = (await history(aMember)).map((m) => m.text);
    const bTexts = (await history(bMember)).map((m) => m.text);
    assert.ok(aTexts.includes('甲盟暗号'));
    assert.equal(aTexts.includes('乙盟暗号'), false);
    assert.ok(bTexts.includes('乙盟暗号'));
    assert.equal(bTexts.includes('甲盟暗号'), false);
  });

  test('限频与屏蔽词生效', async () => {
    const { leader, id } = await makeAlliance('联己');
    const sender = await enlist(id, leader, 'mem-filter');
    const first = expectOk(await say(sender, '这里有敏感词哦'));
    assert.equal(first.message.text?.includes('敏感词'), false);
    assert.ok(first.message.text?.includes('*'));
    // 同一账号同一频道的第二条在限频窗口内被拒
    const limited = await say(sender, '第二条');
    expectErr(limited, 'CHAT_RATE_LIMITED');
    assert.ok(Number(limited.data?.retryAfterSeconds) >= 1);
  });

  test('屏蔽玩家：对方的发言从我的历史与推送中消失；系统消息不受影响', async () => {
    const { leader, id } = await makeAlliance('联庚');
    const annoying = await enlist(id, leader, 'mem-annoy');
    const viewer = await enlist(id, leader, 'mem-viewer');
    expectOk(await chat(viewer, Op.CHAT_BLOCK, { accountId: annoying, blocked: true }));

    online = [leader, annoying, viewer];
    chatPushes.length = 0;
    expectOk(await say(annoying, '烦人的话'));
    await settle();
    const pushedTo = chatPushes.map((p) => p.accountId);
    assert.equal(pushedTo.includes(viewer), false, '屏蔽了发言人的成员不收推送');
    assert.equal(pushedTo.includes(leader), true, '其他在线成员收到推送');
    online = [];

    const seen = await history(viewer);
    assert.equal(seen.some((m) => m.text === '烦人的话'), false);
    assert.ok(seen.some((m) => m.type === 'system'), '系统消息仍可见');
    // 对方的发言对其他成员照常可见
    assert.ok((await history(leader)).some((m) => m.text === '烦人的话'));
  });

  test('推送只给本联盟在线成员，不推给别的联盟', async () => {
    const a = await makeAlliance('联辛');
    const b = await makeAlliance('联壬');
    const aMember = await enlist(a.id, a.leader, 'mem-push-a');
    const bMember = await enlist(b.id, b.leader, 'mem-push-b');
    online = [a.leader, aMember, b.leader, bMember];
    chatPushes.length = 0;
    expectOk(await say(aMember, '只给甲盟'));
    await settle();
    const pushedTo = chatPushes.map((p) => p.accountId);
    assert.ok(pushedTo.includes(a.leader));
    assert.equal(pushedTo.includes(b.leader), false);
    assert.equal(pushedTo.includes(bMember), false);
    online = [];
  });

  test('加入 / 退出 / 被踢 / 转让盟主都产生系统消息，且能看到对应的玩家与参数', async () => {
    const { leader, id } = await makeAlliance('联癸');
    const leaving = await enlist(id, leader, 'mem-leave');
    const kicked = await enlist(id, leader, 'mem-kick');
    const heir = await enlist(id, leader, 'mem-heir');

    expectOk(await call(leaving, Op.ALLIANCE_LEAVE));
    expectOk(await call(leader, Op.ALLIANCE_KICK, { accountId: kicked }));
    expectOk(await call(leader, Op.ALLIANCE_SET_ROLE, { accountId: heir, role: 'leader' }));

    const msgs = await history(heir);
    const systems = msgs.filter((m) => m.type === 'system');
    const left = systems.find((m) => m.system?.kind === 'alliance_left');
    const kick = systems.find((m) => m.system?.kind === 'alliance_kicked');
    const change = systems.find((m) => m.system?.kind === 'alliance_leader_changed');
    assert.equal(left?.system?.player.accountId, leaving);
    assert.equal(kick?.system?.player.accountId, kicked);
    assert.equal(kick?.system?.by.accountId, leader);
    assert.equal(change?.system?.from.accountId, leader);
    assert.equal(change?.system?.to.accountId, heir);
    assert.equal(change?.system?.reason, 'transfer');
    for (const m of systems) {
      assert.equal(m.sender, null, '系统消息没有发送人');
      assert.equal(m.text, null);
    }
    // 被踢后离开了联盟：看不到此后的联盟频道
    expectErr(await chat(kicked, Op.CHAT_HISTORY, { channel: 'alliance' }), 'ALLIANCE_NOT_IN');
  });

  test('离盟后看不到旧消息；重新入盟也只看到入盟之后的消息', async () => {
    const { leader, id } = await makeAlliance('联甲甲');
    const member = await enlist(id, leader, 'mem-rejoin');
    expectOk(await say(member, '离盟前的话'));
    expectOk(await call(member, Op.ALLIANCE_LEAVE));
    expectErr(await chat(member, Op.CHAT_HISTORY, { channel: 'alliance' }), 'ALLIANCE_NOT_IN');
    expectErr(await say(member, '离盟后还想说'), 'ALLIANCE_NOT_IN');

    await clearCooldown(member);
    expectOk(await call(member, Op.ALLIANCE_APPLY, { allianceId: id }));
    expectOk(await call(leader, Op.ALLIANCE_RESPOND, { kind: 'request', accountId: member, accept: true }));
    const texts = (await history(member)).map((m) => m.text);
    assert.equal(texts.includes('离盟前的话'), false, '重新入盟不回看离盟前的消息');
    assert.ok((await history(member)).some((m) => m.type === 'system' && m.system?.kind === 'alliance_joined'));
  });

  test('解散联盟：联盟消息随联盟级联删除，解散本身不写系统消息', async () => {
    const leader = await makeAccount('lead-disband', { government: 5, gold: ALLIANCE_CREATE_COST_GOLD + 5000 });
    const created = expectOk(await call(leader, Op.CREATE_ALLIANCE, { name: '联乙乙' }));
    const allianceId = created.allianceId as string;
    expectOk(await say(leader, '准备解散'));
    const before = await pool.query(`SELECT count(*)::int AS n FROM chat_messages WHERE alliance_id = $1`, [allianceId]);
    assert.ok((before.rows[0] as { n: number }).n >= 2, '建盟的系统消息与发言都已落库');

    expectOk(await call(leader, Op.ALLIANCE_DISBAND));
    const after = await pool.query(`SELECT count(*)::int AS n FROM chat_messages WHERE alliance_id = $1`, [allianceId]);
    assert.equal((after.rows[0] as { n: number }).n, 0);
    const disbandMsg = await pool.query(`SELECT count(*)::int AS n FROM chat_messages WHERE system_event->>'kind' = 'alliance_disbanded'`);
    assert.equal((disbandMsg.rows[0] as { n: number }).n, 0);
  });

  test('盟主长期不活跃被自动转让：系统消息 reason = inactive，并可经 NOTIFY 路径推给在线成员', async () => {
    const { leader, id } = await makeAlliance('联丙丙');
    const member = await enlist(id, leader, 'mem-inactive');
    await pool.query(`UPDATE accounts SET last_active_at = now() - ($2::bigint * interval '1 millisecond') WHERE id = $1`, [
      leader,
      ALLIANCE_LEADER_INACTIVE_MS + DAY,
    ]);
    const transfers = await transferInactiveLeaders(pool, ALLIANCE_LEADER_INACTIVE_MS);
    assert.ok(transfers.some((t) => t.allianceId === id && t.to === member));

    const msgs = await history(member);
    const change = msgs.find((m) => m.system?.kind === 'alliance_leader_changed');
    assert.equal(change?.system?.reason, 'inactive');
    assert.equal(change?.system?.from.accountId, leader);
    assert.equal(change?.system?.to.accountId, member);

    // 提交后 API 收到 NOTIFY 时调用的路径：按消息编号取回并推给在线成员
    const latest = await pool.query(`SELECT id FROM chat_messages WHERE alliance_id = $1 ORDER BY id DESC LIMIT 1`, [id]);
    online = [leader, member];
    chatPushes.length = 0;
    await pushAllianceMessage(pool, registry, id, Number((latest.rows[0] as { id: string | number }).id));
    assert.deepEqual(chatPushes.map((p) => p.accountId).sort(), [leader, member].sort());
    assert.equal(chatPushes[0].message.type, 'system');
    online = [];
  });

  test('消息可见性判断（卡片详情用）：成员入盟之后可见，外人与入盟前不可见', async () => {
    const { leader, id } = await makeAlliance('联丁丁');
    const early = await makeAccount('early-viewer');
    const sent = expectOk(await say(leader, '可见性测试'));
    const messageId = sent.message.id as number;
    const outsider = await makeAccount('outsider-vis');
    assert.equal(await chatDb.canSeeAllianceMessage(pool, outsider, messageId), false);
    assert.equal(await chatDb.canSeeAllianceMessage(pool, early, messageId), false);
    const member = await enlist(id, leader, 'mem-vis');
    assert.equal(await chatDb.canSeeAllianceMessage(pool, member, messageId), false, '消息早于入盟');
    const later = expectOk(await say(member, '入盟后的消息'));
    assert.equal(await chatDb.canSeeAllianceMessage(pool, member, later.message.id as number), true);
    assert.equal(await chatDb.canSeeAllianceMessage(pool, outsider, later.message.id as number), false);
  });

  test('保留期：超过 7 天的联盟消息被清理，每个联盟最多保留最近 1000 条', async () => {
    const { leader, id } = await makeAlliance('联戊戊');
    await pool.query(
      `INSERT INTO chat_messages (channel, alliance_id, sender_id, text, created_at) VALUES ('alliance', $1, $2, '过期', now() - interval '8 days')`,
      [id, leader],
    );
    // 再灌入 1005 条未过期消息：清理后每个联盟只剩最近 1000 条（系统消息同计），且不影响别的联盟
    const other = await makeAlliance('联甲丙');
    await pool.query(
      `INSERT INTO chat_messages (channel, alliance_id, sender_id, text)
       SELECT 'alliance', $1, $2, '刷屏' || g FROM generate_series(1, 1005) AS g`,
      [id, leader],
    );
    await pool.query(`INSERT INTO chat_messages (channel, alliance_id, sender_id, text) VALUES ('alliance', $1, $2, '别盟的话')`, [other.id, other.leader]);
    await chatDb.pruneChatMessages(pool);
    const stale = await pool.query(`SELECT count(*)::int AS n FROM chat_messages WHERE alliance_id = $1 AND text = '过期'`, [id]);
    assert.equal((stale.rows[0] as { n: number }).n, 0);
    const kept = await pool.query(`SELECT count(*)::int AS n FROM chat_messages WHERE alliance_id = $1`, [id]);
    assert.equal((kept.rows[0] as { n: number }).n, 1000);
    const newest = await pool.query(`SELECT text FROM chat_messages WHERE alliance_id = $1 ORDER BY id DESC LIMIT 1`, [id]);
    assert.equal((newest.rows[0] as { text: string }).text, '刷屏1005');
    const otherKept = await pool.query(`SELECT count(*)::int AS n FROM chat_messages WHERE alliance_id = $1`, [other.id]);
    assert.ok((otherKept.rows[0] as { n: number }).n >= 2, '别的联盟不受影响');
  });
});
