// WebSocket 协议客户端：连接、seq 关联、请求超时与推送分发。
// 协议语义（登录、查询、建造）在 state/useGameSession 里编排，本文件只管帧的收发。

import type { ClientFrame, PushFrame, ResponseFrame } from './protocol';
import { withActiveCity } from './cityScope';

/** 构建时追加的站点 → 网关映射：环境变量 PUBLIC_WS_BY_HOST（JSON，如 `{"slg.example.cn":"wss://slgws.example.cn/ws"}`），
 *  放在 frontend/.env.local（已被 .gitignore 忽略）；格式不对时忽略并告警。 */
function extraWsByHost(): Record<string, string> {
  const raw = import.meta.env.PUBLIC_WS_BY_HOST;
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    console.warn('PUBLIC_WS_BY_HOST 不是合法 JSON，已忽略');
    return {};
  }
}

/** 站点（页面域名）→ WebSocket 网关。双站点（v47，AISLG-130）：国际站页面与网关同域名
 *  （wss://slg.yuntianyou.cc/ws）；国内站页面与网关不同域名，由 PUBLIC_WS_BY_HOST 在构建时补上。
 *  两个站背后是同一套服务与数据库。 */
const PRODUCTION_WS_BY_HOST: Record<string, string> = {
  'slg.yuntianyou.cc': 'wss://slg.yuntianyou.cc/ws',
  ...extraWsByHost(),
};

/** 本地联调 / 端到端测试用：非生产站点可经 localStorage `slg.wsUrl` 改接别的 API（如临时库上的 18080 实例）；读不到就用默认 */
function localWsOverride(): string | null {
  try {
    return window.localStorage.getItem('slg.wsUrl');
  } catch {
    return null;
  }
}

/** API 连接地址：已知生产站点按上表走 wss；其余环境默认 ws://127.0.0.1:8080/ws
 *  （可被 localStorage `slg.wsUrl` 覆盖）。调整入口在此。 */
export const WS_URL = ((): string => {
  const mapped = typeof window !== 'undefined' ? PRODUCTION_WS_BY_HOST[window.location.hostname] : undefined;
  if (mapped) {
    return mapped;
  }
  return (typeof window !== 'undefined' ? localWsOverride() : null) ?? 'ws://127.0.0.1:8080/ws';
})();

/**
 * Agent API 文档（Markdown）的运行时地址：由 WS_URL 推导（ws→http / wss→https，
 * 路径换成 /agent-api.md）。该路由只读、无凭证、已放开 CORS（Access-Control-Allow-Origin: *），
 * 前端可直接 fetch 后整篇交给 AI（用法见文档开头「给 Agent 的用法」）。
 */
export const AGENT_API_DOC_URL = WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/agent-api.md');

/**
 * 登录入口配置（v44 /auth/config）的运行时地址：由 WS_URL 推导（ws→http / wss→https，
 * 路径换成 /auth/config）。返回 { googleClientId, wechatEnabled }，前端据此决定
 * 显示 Google 按钮 / 微信扫码分页；跨域头由 registerCors 放开。
 */
export const AUTH_CONFIG_URL = WS_URL.replace(/^ws/, 'http').replace(/\/ws$/, '/auth/config');

/** 单条请求的等待上限（毫秒） */
const REQUEST_TIMEOUT_MS = 5000;

export type PushHandler = (frame: PushFrame) => void;

interface PendingRequest {
  resolve: (frame: ResponseFrame) => void;
  reject: (err: Error) => void;
  timer: number;
}

export class ApiClient {
  private socket: WebSocket | null = null;
  private seq = 0;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly pushHandlers = new Set<PushHandler>();
  /** 连接被网络或服务端关闭时回调（客户端主动 close 不触发） */
  onClose: ((code: number, reason: string) => void) | null = null;

  get connected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  /** 建立连接；已连接时直接返回 */
  connect(url = WS_URL): Promise<void> {
    if (this.connected) {
      return Promise.resolve();
    }
    this.teardownSocket();
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;
      const failTimer = window.setTimeout(() => {
        socket.close();
      }, REQUEST_TIMEOUT_MS);
      socket.onopen = () => {
        window.clearTimeout(failTimer);
        if (this.socket === socket) {
          this.bindSocket(socket);
        }
        resolve();
      };
      socket.onclose = (ev) => {
        window.clearTimeout(failTimer);
        if (this.socket === socket) {
          this.socket = null;
        }
        reject(new Error(`连接失败（close code ${ev.code}）`));
      };
    });
  }

  /** 发送请求并等待同 seq 的响应；超时或连接断开时拒绝 */
  request(op: number, data?: Record<string, unknown>): Promise<ResponseFrame> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('连接未建立'));
    }
    const seq = ++this.seq;
    const payload = withActiveCity(op, data);
    const frame: ClientFrame = payload === undefined ? { op, seq } : { op, seq, data: payload };
    socket.send(JSON.stringify(frame));
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(seq);
        reject(new Error(`请求 op=${op} 超时`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(seq, { resolve, reject, timer });
    });
  }

  /** 订阅服务端推送，返回取消订阅函数 */
  onPush(handler: PushHandler): () => void {
    this.pushHandlers.add(handler);
    return () => {
      this.pushHandlers.delete(handler);
    };
  }

  /** 主动关闭连接（不触发 onClose） */
  close(): void {
    this.teardownSocket();
    this.rejectAllPending(new Error('连接已关闭'));
  }

  private bindSocket(socket: WebSocket): void {
    socket.onmessage = (ev: MessageEvent) => {
      let frame: ResponseFrame & Partial<PushFrame>;
      try {
        frame = JSON.parse(String(ev.data)) as ResponseFrame & Partial<PushFrame>;
      } catch {
        return;
      }
      if (frame.push === true) {
        for (const handler of this.pushHandlers) {
          handler(frame as PushFrame);
        }
        return;
      }
      if (typeof frame.seq === 'number') {
        const pending = this.pending.get(frame.seq);
        if (pending) {
          window.clearTimeout(pending.timer);
          this.pending.delete(frame.seq);
          pending.resolve(frame);
        }
      }
    };
    socket.onclose = (ev) => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.rejectAllPending(new Error('连接已断开'));
      this.onClose?.(ev.code, ev.reason);
    };
  }

  private teardownSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.close(1000, 'client close');
    }
  }

  private rejectAllPending(err: Error): void {
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }
}
