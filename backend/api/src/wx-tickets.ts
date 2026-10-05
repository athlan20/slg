// 微信扫码 ticket 的内存状态机（docs/wechat-qr-login.md「ticket 只放内存，不建表」「状态流转」）。
// ticket 最多活 3 分钟，且推送要找到网页那条连接（连接对象只在内存里），所以不入库——前提是 API 单进程部署，
// 以后多实例要把 ticket 搬进 PostgreSQL、推送改走 pg_notify。API 重启后旧码作废，网页重新生成即可。
// 本文件只管状态与规则（纯内存、时间可注入），不碰数据库、微信接口与帧收发，便于单元测试。
//
//   pending ──scan──▶ scanned ──confirm──▶ 确认（删除 ticket）
//      │                 └──cancel──▶ 取消（删除 ticket）
//      └──到期──▶ sweep 清理并交回调用方推送 expired

import { randomInt } from 'node:crypto';
import type { ConnInfo } from './connections';

export type WxPurpose = 'login' | 'bind';

export interface WxTicket {
  id: string;
  purpose: WxPurpose;
  /** 生成二维码的网页连接：状态推送的唯一对象 */
  webConn: ConnInfo;
  /** bind 用途：发起绑定时网页连接所登录的账号；login 为 null */
  accountId: string | null;
  status: 'pending' | 'scanned';
  /** 扫码后记下，仅服务端持有，不发给网页与小游戏 */
  openid: string | null;
  unionid: string | null;
  /** 扫码的小游戏连接：确认 / 取消只接受这条连接 */
  scanConn: ConnInfo | null;
  requestedAt: number;
  expiresAt: number;
  requesterIp: string | null;
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** ticket 长度：scene 最多 32 字符，16 位 base62 ≈ 95 bit 随机量 */
export const TICKET_LENGTH = 16;

export function generateTicketId(): string {
  let out = '';
  for (let i = 0; i < TICKET_LENGTH; i += 1) {
    out += BASE62[randomInt(BASE62.length)];
  }
  return out;
}

/** 小游戏确认页展示用的 IP 打码：113.87.*.*；IPv6 只保留前两段 */
export function maskIp(ip: string | null): string | null {
  if (!ip) {
    return null;
  }
  const v4 = ip.replace(/^::ffff:/i, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
    const [a, b] = v4.split('.');
    return `${a}.${b}.*.*`;
  }
  if (ip.includes(':')) {
    const [a, b] = ip.split(':');
    return `${a || '0'}:${b || '0'}:*`;
  }
  return null;
}

export type TakeResult = { ok: true; ticket: WxTicket } | { ok: false };

export class WxTicketStore {
  private tickets = new Map<string, WxTicket>();
  /** 一条网页连接同时只保留一个 ticket */
  private byWebConn = new Map<ConnInfo, string>();

  constructor(
    private readonly ttlMs: number,
    private readonly makeId: () => string = generateTicketId,
  ) {}

  get size(): number {
    return this.tickets.size;
  }

  /** 为网页连接创建 ticket；该连接上一个 ticket 随之作废（不推送，网页自己换了码） */
  create(webConn: ConnInfo, purpose: WxPurpose, accountId: string | null, now: number): WxTicket {
    this.dropByWebConn(webConn);
    let id = this.makeId();
    while (this.tickets.has(id)) {
      id = this.makeId();
    }
    const ticket: WxTicket = {
      id,
      purpose,
      webConn,
      accountId,
      status: 'pending',
      openid: null,
      unionid: null,
      scanConn: null,
      requestedAt: now,
      expiresAt: now + this.ttlMs,
      requesterIp: webConn.ip,
    };
    this.tickets.set(id, ticket);
    this.byWebConn.set(webConn, id);
    return ticket;
  }

  /** 读取未过期的 ticket；过期的顺手删除（推送 expired 由 sweep 负责） */
  get(id: string, now: number): WxTicket | null {
    const ticket = this.tickets.get(id);
    if (!ticket) {
      return null;
    }
    if (ticket.expiresAt <= now) {
      this.remove(ticket);
      return null;
    }
    return ticket;
  }

  /** 小游戏扫码：只有 pending 的 ticket 能被扫；已是 scanned（另一部手机）一律无效 */
  markScanned(id: string, scanConn: ConnInfo, openid: string, unionid: string | null, now: number): TakeResult {
    const ticket = this.get(id, now);
    if (!ticket || ticket.status !== 'pending') {
      return { ok: false };
    }
    ticket.status = 'scanned';
    ticket.openid = openid;
    ticket.unionid = unionid;
    ticket.scanConn = scanConn;
    return { ok: true, ticket };
  }

  /** 确认 / 取消：只接受扫码的那条连接，且 ticket 必须是 scanned；成功即消耗（删除），防重复确认 */
  takeScanned(id: string, conn: ConnInfo, now: number): TakeResult {
    const ticket = this.get(id, now);
    if (!ticket || ticket.status !== 'scanned' || ticket.scanConn !== conn) {
      return { ok: false };
    }
    this.remove(ticket);
    return { ok: true, ticket };
  }

  /** 网页连接断开 / 主动换码：作废它名下的 ticket */
  dropByWebConn(webConn: ConnInfo): void {
    const id = this.byWebConn.get(webConn);
    const ticket = id ? this.tickets.get(id) : undefined;
    if (ticket) {
      this.remove(ticket);
    }
  }

  /** 只作废指定的这一个 ticket（生成二维码失败时用：期间网页可能已换了新码，不能误删） */
  discard(ticket: WxTicket): void {
    if (this.tickets.get(ticket.id) === ticket) {
      this.remove(ticket);
    }
  }

  /** 小游戏连接断开：它已扫码但没确认的 ticket 作废并交回调用方，通知网页 canceled
   *  （确认只认扫码的那条连接，断开后这个 ticket 不可能再被确认，网页不必干等到过期） */
  dropByScanConn(scanConn: ConnInfo): WxTicket[] {
    const dropped = [...this.tickets.values()].filter((t) => t.scanConn === scanConn);
    for (const ticket of dropped) {
      this.remove(ticket);
    }
    return dropped;
  }

  /** 清理已过期的 ticket 并返回它们，由调用方推送 expired */
  sweep(now: number): WxTicket[] {
    const expired: WxTicket[] = [];
    for (const ticket of this.tickets.values()) {
      if (ticket.expiresAt <= now) {
        expired.push(ticket);
      }
    }
    for (const ticket of expired) {
      this.remove(ticket);
    }
    return expired;
  }

  private remove(ticket: WxTicket): void {
    this.tickets.delete(ticket.id);
    if (this.byWebConn.get(ticket.webConn) === ticket.id) {
      this.byWebConn.delete(ticket.webConn);
    }
  }
}

/** 滑动窗口限频（生成二维码要调微信接口，不能被刷）：同一 key 在窗口内最多 limit 次 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** 记一次并返回是否放行；被拒的请求不占额度 */
  allow(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** 清掉窗口外的记录，避免 Map 无限增长（由定时器调用） */
  prune(now: number): void {
    for (const [key, times] of this.hits) {
      const recent = times.filter((t) => now - t < this.windowMs);
      if (recent.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, recent);
      }
    }
  }
}
