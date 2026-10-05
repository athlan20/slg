// 每条 WebSocket 连接的服务端状态与按账号的连接登记。
// 状态变化的发起者取自发起原始指令的连接（conn.role），而不是 Worker 的身份。

import type { WebSocket } from 'ws';
import type { InitiatorRole, PushFrame, ResponseFrame } from '../../common/src/protocol';

export interface ConnInfo {
  socket: WebSocket;
  /** 连接来源 IP（反向代理后取 X-Forwarded-For 首跳，见 index.ts 的 TRUST_PROXY） */
  ip: string | null;
  /** 连接访问的站点 Host（握手 Host 头，TRUST_PROXY 时优先 X-Forwarded-Host；小写去端口）。
   *  双站点（v47）按它区分国内 / 国际站：连哪个域名就算哪个站 */
  host: string | null;
  accountId: string | null;
  username: string | null;
  role: InitiatorRole | null;
  /** 本次登录使用的会话 id（LOGOUT 吊销用；密码与令牌登录都会设置） */
  sessionId: string | null;
  connectedAt: Date;
  /** 登录超时的截止时刻（毫秒时间戳；index.ts 建连时设置）。等人扫微信码的连接会被延长到 ticket 过期之后 */
  authDeadlineAt?: number;
}

/** 把未登录连接的登录截止时刻延后到至少 untilMs（只延不缩） */
export function extendAuthDeadline(conn: ConnInfo, untilMs: number): void {
  conn.authDeadlineAt = Math.max(conn.authDeadlineAt ?? 0, untilMs);
}

export class ConnectionRegistry {
  private byAccount = new Map<string, Set<ConnInfo>>();
  /** 推送 eventId 计数（v21 AISLG-37）：账号维度单调递增；floor 取自启动时的
   *  max(events.id)，保证 API 重启后 id 不回退（客户端「已见最大 id」去重不失效） */
  private eventIdFloor = 0;
  private eventIds = new Map<string, number>();

  /** 启动时设置 eventId 起点下限（调用方传 max(events.id)；不设则从 0 起） */
  setEventIdFloor(floor: number): void {
    this.eventIdFloor = Math.max(this.eventIdFloor, Math.floor(floor) || 0);
  }

  /** 下一个推送 eventId：每账号独立计数，同一次 broadcast 的所有连接拿到同一个值 */
  private nextEventId(accountId: string): number {
    const current = this.eventIds.get(accountId) ?? this.eventIdFloor;
    const next = current + 1;
    this.eventIds.set(accountId, next);
    return next;
  }

  /** 连接建立时登记（登录成功前不属于任何账号） */
  add(conn: ConnInfo): void {
    // 无需按 socket 索引：账号维度从 bind 开始
  }

  /** 登录成功后把连接绑定到账号 */
  bind(conn: ConnInfo, accountId: string): void {
    conn.accountId = accountId;
    let set = this.byAccount.get(accountId);
    if (!set) {
      set = new Set();
      this.byAccount.set(accountId, set);
    }
    set.add(conn);
  }

  /** 连接当前绑定的账号 id（不移除；未绑定为 null） */
  peekAccountId(conn: ConnInfo): string | null {
    return conn.accountId;
  }

  /** 连接关闭时移除；返回它绑定的账号 id（未登录返回 null） */
  remove(conn: ConnInfo): string | null {
    const accountId = conn.accountId;
    if (accountId) {
      const set = this.byAccount.get(accountId);
      if (set) {
        set.delete(conn);
        if (set.size === 0) {
          this.byAccount.delete(accountId);
        }
      }
    }
    conn.accountId = null;
    return accountId;
  }

  connectionsOf(accountId: string): ConnInfo[] {
    return Array.from(this.byAccount.get(accountId) ?? []);
  }

  /** 当前声明为 Agent 的在线连接 */
  agentConnections(accountId: string): ConnInfo[] {
    return this.connectionsOf(accountId).filter((c) => c.role === 'agent');
  }

  send(conn: ConnInfo, frame: ResponseFrame | PushFrame): void {
    if (conn.socket.readyState !== conn.socket.OPEN) {
      return;
    }
    try {
      conn.socket.send(JSON.stringify(frame));
    } catch (err) {
      // 发送失败按连接即将断开处理，不中断 API
      console.warn('send failed:', err instanceof Error ? err.message : err);
    }
  }

  /** 推送给账号的全部在线连接；except 用于「发起连接已拿到直接结果」的场景。
   *  注入 eventId（v21 AISLG-37）：一次扇出一个 id，同事件多连接收到相同值。 */
  broadcast(accountId: string, frame: PushFrame, except?: ConnInfo): number {
    frame.eventId = this.nextEventId(accountId);
    let sent = 0;
    for (const conn of this.connectionsOf(accountId)) {
      if (conn === except) {
        continue;
      }
      this.send(conn, frame);
      sent += 1;
    }
    return sent;
  }

  /** 全服广播（v23，AISLG-60）：推给当前所有在线连接。eventId 仍按账号维度注入，
   *  同一次广播各账号拿到各自的 eventId（客户端去重逻辑不变）。 */
  broadcastAll(frame: PushFrame): number {
    let sent = 0;
    for (const accountId of this.byAccount.keys()) {
      sent += this.broadcast(accountId, { ...frame, eventId: 0 });
    }
    return sent;
  }

  closeAll(code: number, reason: string): void {
    for (const set of this.byAccount.values()) {
      for (const conn of set) {
        conn.socket.close(code, reason);
      }
    }
    this.byAccount.clear();
  }
}
