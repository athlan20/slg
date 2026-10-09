// 聊天端到端冒烟（v51，AISLG-138）：对着已启动的 API（WS_URL）与同一个数据库（DATABASE_URL）逐条验证：
// 官府门槛、世界 / 私聊收发、屏蔽词替换、限频、推送与屏蔽过滤、离线私聊未读、卡片快照与归属、
// 表情与参数校验、禁言、Agent 不可用、历史翻页、保留期与条数上限。
// 运行：npm run smoke:chat（与 npm run smoke 一样读 backend/.env：本机开发库与 8080 API）。要跑在临时库上，
// 用环境变量覆盖 DATABASE_URL 与 WS_URL（进程环境优先于 .env）。会在库里新建 chat_ 前缀的测试账号与消息。
// 条数清理检查会按保留期清理整张消息表，所以只有设 CHAT_SMOKE_PRUNE=1 才跑（只在临时库上设）。
// 同一账号 10 秒内只能在同一频道发言一条，因此每个需要发言的场景都用新账号；
// 负面用例（期望被拒绝 / 期望收不到推送）前都先确认触发消息确实发出（expectOk），避免空通过。

import pg from 'pg';
import { Op, type ErrorCode, type ResponseFrame } from '../common/src/protocol';
import { CHAT_EMOJIS, CHAT_TEXT_MAX_CHARS, type ChatMessageView } from '../common/src/protocol-chat';
import { Client, check, dataOf, step, stepTotal } from './smoke-client';
import { seedAccount } from './smoke-account';
import { pruneChatMessages } from '../api/src/chat-db';
import {
  addHero,
  addWildernessReport,
  countRows,
  insertAgedMessage,
  insertWorldBulk,
  mainCityId,
  setGovernment,
  setMutedUntil,
} from './smoke-chat-fixtures';

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8080/ws';
const PASSWORD = 'chat-pass-123';
const RUN = Date.now().toString(36);
let counter = 0;

if (!process.env.DATABASE_URL) {
  throw new Error('chat 冒烟需要 DATABASE_URL（与 API 指向同一个库）');
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

interface Player {
  tag: string;
  username: string;
  id: string;
  client: Client;
}

/** 新建账号、登录，并把主城官府设到 government 级 */
async function newPlayer(tag: string, government: number): Promise<Player> {
  counter += 1;
  const username = `chat_${tag}_${RUN}${counter}`;
  await seedAccount(username, PASSWORD);
  const client = await Client.connect(WS_URL);
  const res = await client.request(Op.LOGIN, { username, password: PASSWORD, asAgent: false });
  check(res.ok === true, `${tag} 登录成功（${res.error?.code ?? 'ok'}）`);
  const id = dataOf(res).accountId as string;
  await setGovernment(pool, id, government);
  return { tag, username, id, client };
}

function expectOk(res: ResponseFrame, message: string): void {
  check(res.ok === true, `${message}（${res.error?.code ?? 'ok'}）`);
}

function expectError(res: ResponseFrame, code: ErrorCode, message: string): void {
  check(res.ok === false && res.error?.code === code, `${message}（${code}）`);
}

/** 响应里的 message 视图（发送成功时） */
function messageOf(res: ResponseFrame): ChatMessageView {
  expectOk(res, '消息发送成功');
  return dataOf(res).message as ChatMessageView;
}

function sendWorld(player: Player, text: string): Promise<ResponseFrame> {
  return player.client.request(Op.CHAT_SEND, { channel: 'world', text });
}

/** 等一条含该文字的推送；超时视为「没有收到」（返回 false）。调用前先发起、再触发消息 */
function pushArrives(client: Client, text: string, timeoutMs = 1500): Promise<boolean> {
  return client.waitPush(Op.PUSH_CHAT_MESSAGE, timeoutMs, (data) => (data.message as ChatMessageView).text === text).then(
    () => true,
    () => false,
  );
}

async function worldHistory(player: Player, limit = 50): Promise<ChatMessageView[]> {
  const res = await player.client.request(Op.CHAT_HISTORY, { channel: 'world', limit });
  return (dataOf(res).messages as ChatMessageView[]) ?? [];
}

async function main(): Promise<void> {
  console.log(`chat smoke target: ${WS_URL}, run: ${RUN}`);

  step('未登录连接查询聊天应被拒绝');
  {
    const anon = await Client.connect(WS_URL);
    expectError(await anon.request(Op.CHAT_HISTORY, { channel: 'world' }), 'NOT_LOGGED_IN', '未登录查询聊天');
    anon.close();
  }

  step('官府不足 3 级：世界频道发言被拒绝；私聊不设门槛');
  const low = await newPlayer('low', 0);
  const alice = await newPlayer('alice', 3);
  expectError(await sendWorld(low, '我还没有官府'), 'CHAT_GOVERNMENT_TOO_LOW', '官府 0 级发世界消息');
  expectOk(await low.client.request(Op.CHAT_SEND, { channel: 'private', peerId: alice.id, text: '你好，我是新人' }), '官府 0 级仍可私聊');

  step('官府 3 级后发世界频道文字：去首尾空白，返回消息视图');
  const aliceMsg = messageOf(await sendWorld(alice, '  大家好  '));
  check(aliceMsg.channel === 'world' && aliceMsg.type === 'text', '消息为世界频道文字');
  check(aliceMsg.text === '大家好' && aliceMsg.recipient === null, '文字已去首尾空白，世界频道无收件人');
  check(aliceMsg.sender.accountId === alice.id && aliceMsg.sender.username === alice.username, '发送人为本账号');

  step('屏蔽词在服务端替换成等长的 *（示例词表：示例屏蔽词）');
  const bob = await newPlayer('bob', 3);
  const bobMsg = messageOf(await sendWorld(bob, '你好示例屏蔽词'));
  check(bobMsg.text === '你好*****', `屏蔽词被替换（得到 ${bobMsg.text}）`);
  // 字间插空格也要拦住：整段替换，前面的字保留（示例词表：示例屏蔽词）
  const bob2 = await newPlayer('bob2', 3);
  const spacedMsg = messageOf(await sendWorld(bob2, '你 好 示 例 屏 蔽 词'));
  check(spacedMsg.text === '你 好 *********', `字间插空格仍被替换（得到 ${spacedMsg.text}）`);

  step('同一频道 10 秒内第二条被限频，附 retryAfterSeconds');
  const throttled = await sendWorld(alice, '第二条');
  expectError(throttled, 'CHAT_RATE_LIMITED', '10 秒内连发');
  const retry = (throttled as { data?: { retryAfterSeconds?: number } }).data?.retryAfterSeconds;
  check(Number.isInteger(retry) && (retry as number) >= 1 && (retry as number) <= 10, `retryAfterSeconds 在 1..10 之间（${retry}）`);

  step('世界推送：在线玩家收到；发送人自己的连接不重复推送');
  const watcher = await newPlayer('watch', 0);
  const carol = await newPlayer('carol', 3);
  const carolPushed = watcher.client.waitPush(Op.PUSH_CHAT_MESSAGE, 3000, (data) => (data.message as ChatMessageView).text === '推送测试');
  const carolMsg = messageOf(await sendWorld(carol, '推送测试'));
  const pushFrame = await carolPushed;
  check(pushFrame.push === true && (pushFrame.data.message as ChatMessageView).id === carolMsg.id, '在线玩家收到同一条消息的推送');
  check(!(await pushArrives(carol.client, '推送测试', 800)), '发送人自己的连接不重复推送');

  step('屏蔽后：看不到对方的世界发言（历史与推送都不出现），取消屏蔽后恢复');
  const dan = await newPlayer('dan', 3);
  const blockRes = await watcher.client.request(Op.CHAT_BLOCK, { accountId: dan.id, blocked: true });
  expectOk(blockRes, '屏蔽 dan');
  const blockedList = (dataOf(blockRes).blocked as Array<{ accountId: string }>) ?? [];
  check(blockedList.some((p) => p.accountId === dan.id), '屏蔽名单包含 dan');
  const danPush = pushArrives(watcher.client, 'dan 的发言');
  const danMsg = messageOf(await sendWorld(dan, 'dan 的发言'));
  check(!(await danPush), '被屏蔽的人发言，watcher 收不到推送');
  check(!(await worldHistory(watcher)).some((m) => m.id === danMsg.id), '屏蔽后历史不出现 dan 的发言');
  const unblock = await watcher.client.request(Op.CHAT_BLOCK, { accountId: dan.id, blocked: false });
  expectOk(unblock, '取消屏蔽 dan');
  check((await worldHistory(watcher)).some((m) => m.id === danMsg.id), '取消屏蔽后历史恢复 dan 的发言');

  step('离线私聊：对方不在线时消息保存，上线后有未读，标记已读后清零');
  const frank = await newPlayer('frank', 0);
  const grace = await newPlayer('grace', 0);
  grace.client.close();
  const frankDm = messageOf(
    await frank.client.request(Op.CHAT_SEND, { channel: 'private', peerId: grace.id, text: '你上线了吗' }),
  );
  check(frankDm.channel === 'private' && frankDm.recipient?.accountId === grace.id, '私聊消息带收件人');
  const graceAgain = await Client.connect(WS_URL);
  expectOk(await graceAgain.request(Op.LOGIN, { username: grace.username, password: PASSWORD, asAgent: false }), 'grace 重新登录');
  const conv = await graceAgain.request(Op.CHAT_CONVERSATIONS);
  const convs = (dataOf(conv).conversations as Array<{ peer: { accountId: string }; unread: number }>) ?? [];
  check(convs.find((c) => c.peer.accountId === frank.id)?.unread === 1, '会话列表显示 frank 一条未读');
  check(dataOf(conv).unreadTotal === 1, '私聊未读总数为 1');
  const hist = await graceAgain.request(Op.CHAT_HISTORY, { channel: 'private', peerId: frank.id });
  check(((dataOf(hist).messages as ChatMessageView[]) ?? []).some((m) => m.id === frankDm.id), '私聊历史包含离线期间的消息');
  const read = await graceAgain.request(Op.CHAT_READ, { peerId: frank.id });
  expectOk(read, '标记已读');
  check(dataOf(read).unreadTotal === 0, '标记已读后未读清零');
  graceAgain.close();

  step('私聊在线推送：对方收到；对方屏蔽发送人后私聊失败（CHAT_BLOCKED）');
  const heidi = await newPlayer('heidi', 0);
  const ivan = await newPlayer('ivan', 0);
  const dmPushed = heidi.client.waitPush(Op.PUSH_CHAT_MESSAGE, 3000, (data) => (data.message as ChatMessageView).text === 'ping');
  expectOk(await ivan.client.request(Op.CHAT_SEND, { channel: 'private', peerId: heidi.id, text: 'ping' }), '私聊发送 ping');
  check((await dmPushed).push === true, '私聊消息推送给在线的对方');
  const judy = await newPlayer('judy', 0);
  expectOk(await heidi.client.request(Op.CHAT_BLOCK, { accountId: judy.id, blocked: true }), 'heidi 屏蔽 judy');
  expectError(
    await judy.client.request(Op.CHAT_SEND, { channel: 'private', peerId: heidi.id, text: '你好' }),
    'CHAT_BLOCKED',
    '被对方屏蔽后私聊',
  );

  step('卡片：坐标 / 武将 / 城池 / 战报的快照由服务端生成');
  const kimCard = await newPlayer('kimc', 3);
  const coordCard = messageOf(
    await kimCard.client.request(Op.CHAT_SEND, { channel: 'world', text: '这块地不错', card: { kind: 'coord', x: 10, y: 10 } }),
  );
  check(coordCard.type === 'card' && coordCard.text === '这块地不错', '坐标卡附带一句话，类型为卡片');
  const tile = coordCard.card as { kind: string; terrain: string; tileKind: string; level: number; x: number; y: number };
  check(tile.kind === 'coord' && tile.x === 10 && tile.y === 10 && typeof tile.terrain === 'string', '坐标卡带地形与坐标');
  check(['wilderness', 'npc_city', 'city'].includes(tile.tileKind) && typeof tile.level === 'number', '坐标卡带地块类别与等级');

  const kimHero = await newPlayer('kimh', 3);
  const heroId = await addHero(pool, kimHero.id, '测试名将', true);
  const heroMsg = messageOf(await kimHero.client.request(Op.CHAT_SEND, { channel: 'world', card: { kind: 'hero', heroId } }));
  const heroCard = heroMsg.card as { kind: string; name: string; famous: boolean; lead: number; force: number; wit: number; level: number };
  check(heroCard.kind === 'hero' && heroCard.name === '测试名将' && heroCard.famous === true, '武将卡带名字与名将标记');
  check(heroCard.lead === 71 && heroCard.force === 66 && heroCard.wit === 58 && heroCard.level === 4, '武将卡带统武智与等级');

  const kimCity = await newPlayer('kimy', 3);
  const cityId = await mainCityId(pool, kimCity.id);
  const cityMsg = messageOf(await kimCity.client.request(Op.CHAT_SEND, { channel: 'world', card: { kind: 'city', cityId } }));
  const cityCard = cityMsg.card as { kind: string; name: string; ownerName: string; level: number; x: number; y: number };
  check(cityCard.kind === 'city' && cityCard.ownerName === kimCity.username && cityCard.level === 3, '城池卡带城名、主人与官府等级');
  check(typeof cityCard.x === 'number' && typeof cityCard.y === 'number', '城池卡带坐标');

  const kimReport = await newPlayer('kimr', 3);
  const reportId = await addWildernessReport(pool, kimReport.id, `${kimReport.username}·主城`);
  const reportMsg = messageOf(await kimReport.client.request(Op.CHAT_SEND, { channel: 'world', card: { kind: 'report', reportId } }));
  const reportCard = reportMsg.card as { kind: string; battleKind: string; role: string; won: boolean; attackerName: string };
  check(reportCard.kind === 'report' && reportCard.battleKind === 'wilderness' && reportCard.role === 'attacker', '战报卡带战斗类别与角色');
  check(reportCard.won === true && reportCard.attackerName.includes(kimReport.username), '战报卡带胜负与攻方名');
  const detail = await watcher.client.request(Op.CHAT_REPORT_DETAIL, { messageId: reportMsg.id });
  expectOk(detail, '其他玩家打开战报详情');
  const report = dataOf(detail).report as { kind: string; x: number; y: number };
  check(report.kind === 'wilderness' && report.x === 12 && report.y === 34, '其他玩家看到的是这份战报的内容');
  check(!('comment' in report), '战报详情不含 Agent 点评');
  expectError(
    await watcher.client.request(Op.CHAT_REPORT_DETAIL, { messageId: cityMsg.id }),
    'INVALID_PARAMS',
    '非战报卡片不能打开战报详情',
  );

  step('卡片归属：别人的武将 id、越界坐标被拒绝，且被拒绝的请求不占用限频');
  const leo = await newPlayer('leo', 3);
  expectError(
    await leo.client.request(Op.CHAT_SEND, { channel: 'world', card: { kind: 'hero', heroId } }),
    'INVALID_PARAMS',
    '发送他人武将卡',
  );
  expectError(
    await leo.client.request(Op.CHAT_SEND, { channel: 'world', card: { kind: 'coord', x: -1, y: 5 } }),
    'INVALID_PARAMS',
    '越界坐标卡',
  );
  expectOk(await sendWorld(leo, '被拒绝的请求没有占用限频'), '之后的正常发言仍然成功');

  step('表情：内置表情可发；表情不能与文字同发；不在表里的表情被拒绝');
  const emo = await newPlayer('emo', 3);
  const emojiMsg = messageOf(await emo.client.request(Op.CHAT_SEND, { channel: 'world', emoji: CHAT_EMOJIS[0] }));
  check(emojiMsg.type === 'emoji' && emojiMsg.emoji === CHAT_EMOJIS[0], '表情消息类型为 emoji');
  expectError(
    await emo.client.request(Op.CHAT_SEND, { channel: 'world', emoji: CHAT_EMOJIS[0], text: '混发' }),
    'INVALID_PARAMS',
    '表情与文字同发',
  );
  expectError(await emo.client.request(Op.CHAT_SEND, { channel: 'world', emoji: '🦄' }), 'INVALID_PARAMS', '未内置的表情');

  step('参数校验：空消息、超长、非法频道、私聊给自己，合法消息不受影响');
  const val = await newPlayer('val', 3);
  expectError(await val.client.request(Op.CHAT_SEND, { channel: 'world', text: '   ' }), 'INVALID_PARAMS', '空白消息');
  expectError(
    await val.client.request(Op.CHAT_SEND, { channel: 'world', text: 'a'.repeat(CHAT_TEXT_MAX_CHARS + 1) }),
    'INVALID_PARAMS',
    '超过 100 字',
  );
  expectError(await val.client.request(Op.CHAT_SEND, { channel: 'global', text: 'x' }), 'INVALID_PARAMS', '非法频道');
  expectError(
    await val.client.request(Op.CHAT_SEND, { channel: 'private', peerId: val.id, text: '自言自语' }),
    'INVALID_PARAMS',
    '私聊给自己',
  );
  expectOk(await sendWorld(val, '合法消息'), '合法消息仍然成功');

  step('禁言：禁言期间发言被拒绝并附 until；解除后恢复');
  const muted = await newPlayer('mute', 3);
  const untilIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await setMutedUntil(pool, muted.id, untilIso);
  const mutedRes = await sendWorld(muted, '禁言中');
  expectError(mutedRes, 'CHAT_MUTED', '禁言期间发言');
  check((mutedRes as { data?: { until?: string } }).data?.until === untilIso, '禁言响应附带 until');
  await setMutedUntil(pool, muted.id, null);
  expectOk(await sendWorld(muted, '解禁后可以说话'), '解除禁言后可以发言');

  step('Agent 连接：读写聊天一律 AGENT_FORBIDDEN，且收不到聊天推送');
  const owner = await newPlayer('owner', 3);
  const token = dataOf(await owner.client.request(Op.GET_AGENT_TOKEN)).token as string;
  const agent = await Client.connect(WS_URL);
  expectOk(await agent.request(Op.LOGIN, { token, asAgent: true }), 'Agent 令牌登录');
  expectError(await agent.request(Op.CHAT_HISTORY, { channel: 'world' }), 'AGENT_FORBIDDEN', 'Agent 读世界频道');
  expectError(await agent.request(Op.CHAT_SEND, { channel: 'world', text: 'agent 发言' }), 'AGENT_FORBIDDEN', 'Agent 发世界消息');
  expectError(await agent.request(Op.CHAT_CONVERSATIONS), 'AGENT_FORBIDDEN', 'Agent 查会话');
  expectError(await agent.request(Op.CHAT_BLOCK, { accountId: owner.id, blocked: true }), 'AGENT_FORBIDDEN', 'Agent 屏蔽');
  const agentPush = pushArrives(agent, '给 Agent 的推送');
  const pusher = await newPlayer('pusher', 3);
  messageOf(await sendWorld(pusher, '给 Agent 的推送'));
  check(!(await agentPush), 'Agent 连接收不到聊天推送（发言确已发出）');
  agent.close();

  step('历史翻页：limit 与 beforeId 逐页取到更早的消息，hasMore 随之变化');
  const page1 = await watcher.client.request(Op.CHAT_HISTORY, { channel: 'world', limit: 2 });
  const messages1 = (dataOf(page1).messages as ChatMessageView[]) ?? [];
  check(messages1.length === 2 && dataOf(page1).hasMore === true, '第一页 2 条且还有更早的消息');
  check(messages1[0].id < messages1[1].id, '页内按时间从旧到新');
  const page2 = await watcher.client.request(Op.CHAT_HISTORY, { channel: 'world', limit: 2, beforeId: messages1[0].id });
  const messages2 = (dataOf(page2).messages as ChatMessageView[]) ?? [];
  check(messages2.length > 0 && messages2.every((m) => m.id < messages1[0].id), '第二页只包含更早的消息');

  step('保留期：超过 7 天的世界消息与 30 天的私聊不返回；超量的世界消息被清理到 1000 条以内');
  await insertAgedMessage(pool, 'world', alice.id, null, 'aged-world-should-hide', 8);
  await insertAgedMessage(pool, 'private', alice.id, bob.id, 'aged-private-should-hide', 31);
  check(!(await worldHistory(watcher)).some((m) => m.text === 'aged-world-should-hide'), '8 天前的世界消息不返回');
  const agedPrivate = await alice.client.request(Op.CHAT_HISTORY, { channel: 'private', peerId: bob.id, limit: 50 });
  check(!((dataOf(agedPrivate).messages as ChatMessageView[]) ?? []).some((m) => m.text === 'aged-private-should-hide'), '31 天前的私聊不返回');
  if (process.env.CHAT_SMOKE_PRUNE === '1') {
    await insertWorldBulk(pool, alice.id, 1005);
    await pruneChatMessages(pool);
    const worldCount = await countRows(pool, `SELECT count(*)::int AS n FROM chat_messages WHERE channel = 'world'`, []);
    check(worldCount <= 1000, `清理后世界消息不超过 1000 条（当前 ${worldCount}）`);
    const agedLeft = await countRows(pool, `SELECT count(*)::int AS n FROM chat_messages WHERE text = 'aged-world-should-hide'`, []);
    check(agedLeft === 0, '超过 7 天的世界消息已被物理清理');
  } else {
    console.log('  - 跳过条数清理检查：清理作用于整张消息表，只在临时库上设 CHAT_SMOKE_PRUNE=1 才跑');
  }

  console.log(`\n聊天冒烟全部通过（${stepTotal()} 个步骤）`);
  for (const client of [low, alice, bob, bob2, watcher, carol, dan, frank, heidi, ivan, judy, kimCard, kimHero, kimCity, kimReport, leo, emo, val, muted, owner, pusher]) {
    client.client.close();
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
