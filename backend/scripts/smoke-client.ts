// 冒烟脚本的 WebSocket 测试客户端：请求-响应按 seq 关联、推送按条件等待。
// 与 smoke.ts（验收步骤）拆分存放以控制单文件行数。

import WebSocket from 'ws';
import type { PushFrame, ResponseFrame } from '../common/src/protocol';

export const REQUEST_TIMEOUT_MS = 5000;

export class Client {
  private seq = 0;
  private readonly pending = new Map<number, (frame: ResponseFrame) => void>();
  private readonly pushWaiters: Array<{
    op: number;
    match?: (data: Record<string, unknown>) => boolean;
    resolve: (frame: PushFrame) => void;
  }> = [];
  private closed = false;

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (raw: unknown) => {
      const text = Array.isArray(raw)
        ? Buffer.concat(raw as Buffer[]).toString('utf8')
        : String(raw);
      let frame: ResponseFrame & Partial<PushFrame>;
      try {
        frame = JSON.parse(text);
      } catch {
        return;
      }
      if (frame.push === true) {
        const waiter = this.pushWaiters.find(
          (w) => w.op === frame.op && (!w.match || w.match(frame.data ?? {})),
        );
        if (waiter) {
          this.pushWaiters.splice(this.pushWaiters.indexOf(waiter), 1);
          waiter.resolve(frame as PushFrame);
        }
        return;
      }
      if (typeof frame.seq === 'number') {
        const resolver = this.pending.get(frame.seq);
        if (resolver) {
          this.pending.delete(frame.seq);
          resolver(frame);
        }
      }
    });
    socket.on('close', () => {
      this.closed = true;
    });
  }

  /** 用已建立的 WebSocket 包装（如带自定义 Host 头连进来的连接） */
  static fromSocket(socket: WebSocket): Client {
    return new Client(socket);
  }

  static connect(url: string = process.env.WS_URL || 'ws://127.0.0.1:8080/ws'): Promise<Client> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.once('open', () => resolve(new Client(socket)));
      socket.once('error', reject);
    });
  }

  request(op: number, data?: Record<string, unknown>): Promise<ResponseFrame> {
    const seq = ++this.seq;
    const frame = { op, seq, ...(data !== undefined ? { data } : {}) };
    const reply = new Promise<ResponseFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`请求 op=${op} 超时`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(seq, (response) => {
        clearTimeout(timer);
        resolve(response);
      });
    });
    this.socket.send(JSON.stringify(frame));
    return reply;
  }

  /** 等待一条满足条件的推送；不消费其他推送 */
  waitPush(op: number, timeoutMs: number, match?: (data: Record<string, unknown>) => boolean): Promise<PushFrame> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.pushWaiters.findIndex((w) => w.resolve === resolve);
        if (index >= 0) this.pushWaiters.splice(index, 1);
        reject(new Error(`等待推送 op=${op} 超时`));
      }, timeoutMs);
      this.pushWaiters.push({
        op,
        match,
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
      });
    });
  }

  close(): void {
    if (!this.closed) {
      this.socket.close();
    }
  }
}

export function dataOf(frame: ResponseFrame): Record<string, unknown> {
  return frame.data ?? {};
}

let stepIndex = 0;

/** 输出一个带序号的步骤标题 */
export function step(name: string): void {
  stepIndex += 1;
  console.log(`\n[step ${stepIndex}] ${name}`);
}

/** 断言并打印；失败抛错终止冒烟 */
export function check(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`断言失败：${message}`);
  }
  console.log(`  ✓ ${message}`);
}

/** 已输出的步骤总数（汇总行用） */
export function stepTotal(): number {
  return stepIndex;
}
