// 微信扫码登录 / 绑定的协议处理（WX_QR_CREATE / WX_SCAN / WX_CONFIRM / WX_CANCEL，docs/wechat-qr-login.md）。
// 微信这一段只负责换到一个会话令牌：网页收到 confirmed{sessionToken} 后走原有的 LOGIN {token}，
// completeLogin 及后续流程不动。openid 只存在服务端，不发给网页，也不发给小游戏。
// 账号与微信身份的数据库操作见 wx-accounts.ts，ticket 状态机见 wx-tickets.ts，微信接口见 wechat.ts。

import { Op } from '../../common/src/protocol';
import { issueSessionToken } from './auth';
import { extendAuthDeadline, type ConnInfo } from './connections';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import { WechatError, type WechatClient } from './wechat';
import { accountHasWechat, bindWechat, findAccountByOpenid, loginWithWechat } from './wx-accounts';
import { maskIp, RateLimiter, WxTicketStore, type WxPurpose, type WxTicket } from './wx-tickets';

/** ticket 过期后再留这么久才断开未登录连接：给「已确认 → 网页发 LOGIN」与自动换码留出时间 */
const AUTH_GRACE_MS = 10_000;
/** 生成码限频：同一 IP 每分钟 20 次 */
const CREATE_LIMIT = 20;
const CREATE_WINDOW_MS = 60_000;

/** API 进程内的微信扫码服务：client 为 null 表示没配置 AppID / AppSecret，扫码登录整体关闭 */
export interface WxService {
  client: WechatClient | null;
  tickets: WxTicketStore;
  createLimiter: RateLimiter;
  now: () => number;
}

export function createWxService(client: WechatClient | null, ttlSeconds: number): WxService {
  return {
    client,
    tickets: new WxTicketStore(ttlSeconds * 1000),
    createLimiter: new RateLimiter(CREATE_LIMIT, CREATE_WINDOW_MS),
    now: () => Date.now(),
  };
}

type WxStatus = 'scanned' | 'confirmed' | 'canceled' | 'expired';

/** 状态推送只给生成二维码的网页连接（login 用途时它还没登录，不在账号连接表里，直接发） */
function pushStatus(ctx: HandlerContext, ticket: WxTicket, status: WxStatus, extra: Record<string, unknown> = {}): void {
  ctx.registry.send(ticket.webConn, {
    op: Op.PUSH_WX_QR_STATUS,
    push: true,
    data: { ticket: ticket.id, status, ...extra },
  });
}

function isValidTicketId(value: string | null): value is string {
  return value !== null && /^[0-9A-Za-z]{16}$/.test(value);
}

export async function handleWechatOp(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  switch (op) {
    case Op.WX_QR_CREATE:
      return handleQrCreate(ctx, conn, op, seq, data);
    case Op.WX_SCAN:
      return handleScan(ctx, conn, op, seq, data);
    case Op.WX_CONFIRM:
      return handleConfirm(ctx, conn, op, seq, data);
    default:
      return handleCancel(ctx, conn, op, seq, data);
  }
}

async function handleQrCreate(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const purpose = readString(data, 'purpose');
  if (purpose !== 'login' && purpose !== 'bind') {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  // bind 要先登录且只能是玩家连接；login 用途在已登录连接上没有意义
  if (purpose === 'bind') {
    if (!conn.accountId) {
      respondError(ctx.registry, conn, op, seq, 'NOT_LOGGED_IN');
      return;
    }
    if (conn.role !== 'player') {
      respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
      return;
    }
  } else if (conn.accountId) {
    respondError(ctx.registry, conn, op, seq, 'ALREADY_LOGGED_IN');
    return;
  }
  const wx = ctx.wx;
  if (!wx?.client) {
    respondError(ctx.registry, conn, op, seq, 'WX_UNAVAILABLE');
    return;
  }
  const now = wx.now();
  if (!wx.createLimiter.allow(conn.ip ?? 'unknown', now)) {
    respondError(ctx.registry, conn, op, seq, 'RATE_LIMITED');
    return;
  }
  // 已绑定的账号再发 bind 没有意义，直接告知，省一次微信接口调用
  if (purpose === 'bind' && (await accountHasWechat(ctx.pool, wx.client.appId, conn.accountId as string))) {
    respondError(ctx.registry, conn, op, seq, 'WX_ALREADY_BOUND');
    return;
  }
  const ticket = wx.tickets.create(conn, purpose, purpose === 'bind' ? conn.accountId : null, now);
  try {
    const qrImage = await wx.client.createQrCode(ticket.id);
    // 生成期间连接断了或网页又换了码：这张码没人要了
    if (conn.socket.readyState !== conn.socket.OPEN || wx.tickets.get(ticket.id, wx.now()) !== ticket) {
      wx.tickets.discard(ticket);
      return;
    }
    if (!conn.accountId) {
      extendAuthDeadline(conn, ticket.expiresAt + AUTH_GRACE_MS);
    }
    respondOk(ctx.registry, conn, op, seq, {
      ticket: ticket.id,
      qrImage,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
    });
  } catch (err) {
    wx.tickets.discard(ticket);
    if (!(err instanceof WechatError)) {
      throw err;
    }
    respondError(ctx.registry, conn, op, seq, 'WX_UNAVAILABLE');
  }
}

async function handleScan(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const ticketId = readString(data, 'ticket');
  const code = readString(data, 'code');
  if (!isValidTicketId(ticketId) || code === null || code.length < 1 || code.length > 256) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const wx = ctx.wx;
  if (!wx?.client) {
    respondError(ctx.registry, conn, op, seq, 'WX_UNAVAILABLE');
    return;
  }
  // 先校验 ticket 再去微信换 openid：随便一条未登录连接不能借此刷微信接口
  const pending = wx.tickets.get(ticketId, wx.now());
  if (!pending || pending.status !== 'pending') {
    respondError(ctx.registry, conn, op, seq, 'WX_TICKET_INVALID');
    return;
  }
  let session;
  try {
    session = await wx.client.codeToSession(code);
  } catch (err) {
    if (!(err instanceof WechatError)) {
      throw err;
    }
    respondError(ctx.registry, conn, op, seq, err.kind === 'code_invalid' ? 'WX_CODE_INVALID' : 'WX_UNAVAILABLE');
    return;
  }
  const identity = { appId: wx.client.appId, openid: session.openid, unionid: session.unionid };

  // 确认页要告诉玩家「将登录哪个账号 / 将创建新账号」；bind 时提前挡掉已被占用的微信
  let accountName: string | null;
  if (pending.purpose === 'login') {
    accountName = (await findAccountByOpenid(ctx.pool, identity.appId, identity.openid))?.username ?? null;
  } else {
    const occupied =
      (await findAccountByOpenid(ctx.pool, identity.appId, identity.openid)) !== null ||
      (await accountHasWechat(ctx.pool, identity.appId, pending.accountId as string));
    if (occupied) {
      respondError(ctx.registry, conn, op, seq, 'WX_ALREADY_BOUND');
      return;
    }
    accountName = pending.webConn.username;
  }

  // 上面有异步等待：此刻再占位，期间被别的手机抢先扫了就算无效
  const scanned = wx.tickets.markScanned(ticketId, conn, identity.openid, identity.unionid, wx.now());
  if (!scanned.ok) {
    respondError(ctx.registry, conn, op, seq, 'WX_TICKET_INVALID');
    return;
  }
  const ticket = scanned.ticket;
  // 小游戏连接要等玩家点确认，超时线同样延长到 ticket 过期之后
  extendAuthDeadline(conn, ticket.expiresAt + AUTH_GRACE_MS);
  pushStatus(ctx, ticket, 'scanned');
  respondOk(ctx.registry, conn, op, seq, {
    purpose: ticket.purpose,
    accountName,
    requestedAt: new Date(ticket.requestedAt).toISOString(),
    requesterIp: maskIp(ticket.requesterIp),
  });
}

async function handleConfirm(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const ticketId = readString(data, 'ticket');
  if (!isValidTicketId(ticketId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const wx = ctx.wx;
  if (!wx?.client) {
    respondError(ctx.registry, conn, op, seq, 'WX_UNAVAILABLE');
    return;
  }
  // takeScanned 同步消耗 ticket：重复点确认、别的连接冒用都拿不到
  const taken = wx.tickets.takeScanned(ticketId, conn, wx.now());
  if (!taken.ok) {
    respondError(ctx.registry, conn, op, seq, 'WX_TICKET_INVALID');
    return;
  }
  const ticket = taken.ticket;
  if (ticket.webConn.socket.readyState !== ticket.webConn.socket.OPEN) {
    respondError(ctx.registry, conn, op, seq, 'WX_TICKET_INVALID');
    return;
  }
  const identity = { appId: wx.client.appId, openid: ticket.openid as string, unionid: ticket.unionid };
  try {
    if (ticket.purpose === 'login') {
      const account = await loginWithWechat(ctx.pool, identity, ticket.requesterIp);
      const session = await issueSessionToken(ctx.pool, account.id);
      pushStatus(ctx, ticket, 'confirmed', { sessionToken: session.token });
    } else {
      const result = await bindWechat(ctx.pool, ticket.accountId as string, identity);
      if (result === 'already_bound') {
        pushStatus(ctx, ticket, 'canceled');
        respondError(ctx.registry, conn, op, seq, 'WX_ALREADY_BOUND');
        return;
      }
      pushStatus(ctx, ticket, 'confirmed', { bound: true });
    }
  } catch (err) {
    console.error('wechat confirm failed:', err);
    pushStatus(ctx, ticket, 'canceled');
    respondError(ctx.registry, conn, op, seq, 'INTERNAL');
    return;
  }
  respondOk(ctx.registry, conn, op, seq, {});
}

async function handleCancel(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const ticketId = readString(data, 'ticket');
  if (!isValidTicketId(ticketId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const taken = ctx.wx?.tickets.takeScanned(ticketId, conn, ctx.wx.now());
  if (!ctx.wx || !taken?.ok) {
    respondError(ctx.registry, conn, op, seq, 'WX_TICKET_INVALID');
    return;
  }
  pushStatus(ctx, taken.ticket, 'canceled');
  respondOk(ctx.registry, conn, op, seq, {});
}

/** 定时清理（index.ts 每 5 秒调一次）：到期的 ticket 推送 expired，并清掉限频记录 */
export function sweepWxTickets(ctx: HandlerContext): void {
  const wx = ctx.wx;
  if (!wx) {
    return;
  }
  const now = wx.now();
  for (const ticket of wx.tickets.sweep(now)) {
    pushStatus(ctx, ticket, 'expired');
  }
  wx.createLimiter.prune(now);
}

/** 连接断开：网页连接的 ticket 作废；小游戏连接已扫未确认的 ticket 作废并通知网页 canceled */
export function onWxConnectionClosed(ctx: HandlerContext, conn: ConnInfo): void {
  const wx = ctx.wx;
  if (!wx) {
    return;
  }
  wx.tickets.dropByWebConn(conn);
  for (const ticket of wx.tickets.dropByScanConn(conn)) {
    pushStatus(ctx, ticket, 'canceled');
  }
}
