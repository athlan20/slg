// 游戏服务器连接（AISLG-131）：标准 WebSocket + JSON 帧（与 backend/api 一致，
// 见 docs/agent-api.md「帧结构」）。职责：
// - 启动即连接并 LOGIN {token, asAgent: true, docVersion}（v50 起可带 agentModel 自报）；
// - 工具调用经 request() 走 seq 配对，超时按配置；
// - 推送帧（op ≥ 2000 / push=true）进有上限的环形缓冲，get_notifications 增量读取；
// - 断线自动重连（指数退避封顶 30s），重连成功后重新登录并写一条合成通知，
//   让 AI 能感知「连接曾断过、期间可能有错过」。

import WebSocket from 'ws';
import type { SlgMcpConfig } from './config.js';
import type { AgentApiManifest } from './manifest.js';

/** 帧里的错误对象（见协议「响应帧」） */
export interface FrameError {
  code: string;
  message: string;
}

export type GameResponse = { ok: true; data: Record<string, unknown> } | { ok: false; error: FrameError };

/** 环形缓冲里的一条通知（op ≥ 2000 的推送，或本服务写入的合成事件） */
export interface BufferedNotification {
  /** 本连接内单调递增的序号，get_notifications 的增量游标 */
  id: number;
  /** 服务端推送去重键（协议 v21 起所有推送都有；合成事件为 null） */
  eventId: number | null;
  op: number;
  /** 协议名（如 PUSH_BUILD_STATE）；合成事件为 'connection' */
  name: string;
  data: Record<string, unknown>;
}

/** 通知环形缓冲的默认容量（旧通知被新通知挤掉） */
export const NOTIFY_BUFFER_LIMIT = 500;

const LOGIN_OP = 1;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

interface Pending {
  resolve: (response: GameResponse) => void;
  timer: NodeJS.Timeout;
}

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

export class SlgConnection {
  private readonly config: SlgMcpConfig;
  private readonly manifest: AgentApiManifest;
  private socket: WebSocket | null = null;
  private seq = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly notifications: BufferedNotification[] = [];
  private notificationSeq = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private state: ConnectionState = 'disconnected';
  /** 最近一次登录失败（token 失效等）；成功后清空 */
  loginError: FrameError | null = null;
  /** LOGIN 响应里的文档更新提示（协议 v32）；工具结果里透传给 AI */
  docNotice: string | null = null;

  constructor(config: SlgMcpConfig, manifest: AgentApiManifest, notifyLimit: number = NOTIFY_BUFFER_LIMIT) {
    this.config = config;
    this.manifest = manifest;
    this.notifyLimit = notifyLimit;
  }

  private readonly notifyLimit: number;

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: { code: 'MCP_SHUTDOWN', message: 'MCP 服务已停止' } });
    }
    this.pending.clear();
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState === WebSocket.OPEN) {
      await new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        socket.close(1000, 'shutdown');
      });
    }
  }

  getState(): ConnectionState {
    return this.state;
  }

  isReady(): boolean {
    return this.state === 'connected';
  }

  /** 自最近一次读取以来的通知快照（id > sinceId），并带下一个游标 */
  notificationsSince(sinceId: number, limit: number): { entries: BufferedNotification[]; nextSinceId: number } {
    const entries = this.notifications.filter((entry) => entry.id > sinceId).slice(0, limit);
    const nextSinceId = entries.length > 0 ? (entries.at(-1) as BufferedNotification).id : sinceId;
    return { entries, nextSinceId };
  }

  /** 压一条合成通知（连接建立 / 断开重连），让 AI 感知连接事件 */
  private pushSynthetic(state: 'connected' | 'reconnected' | 'disconnected'): void {
    this.buffer({
      eventId: null,
      op: -1,
      name: 'connection',
      data: { state, at: new Date().toISOString(), server: this.config.server },
    });
  }

  private buffer(entry: Omit<BufferedNotification, 'id'>): void {
    this.notificationSeq += 1;
    this.notifications.push({ ...entry, id: this.notificationSeq });
    if (this.notifications.length > this.notifyLimit) {
      this.notifications.splice(0, this.notifications.length - this.notifyLimit);
    }
  }

  /**
   * 调用一个游戏协议：未就绪时等待（连接 / 登录进行中），超时或失败按错误返回。
   * 不抛异常——调用方（MCP 工具）把错误原样转成工具结果。
   */
  async request(op: number, data: Record<string, unknown>): Promise<GameResponse> {
    const waitError = await this.waitReady();
    if (waitError !== null) {
      return { ok: false, error: waitError };
    }
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return { ok: false, error: { code: 'MCP_NOT_CONNECTED', message: `与游戏服务器的连接不可用（${this.state}），正在自动重连，请稍后重试` } };
    }
    this.seq += 1;
    const seq = this.seq;
    const frame = JSON.stringify({ op, seq, data });
    return new Promise<GameResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        resolve({
          ok: false,
          error: { code: 'MCP_TIMEOUT', message: `请求超时（> ${this.config.requestTimeoutMs}ms）：连接可能已中断，自动重连后请重试` },
        });
      }, this.config.requestTimeoutMs);
      this.pending.set(seq, { resolve, timer });
      socket.send(frame);
    });
  }

  /** 等到 connected（含登录完成）；返回 null 表示就绪，否则为错误 */
  private async waitReady(): Promise<FrameError | null> {
    if (this.isReady()) {
      return null;
    }
    const deadline = Date.now() + this.config.readyTimeoutMs;
    while (Date.now() < deadline && !this.stopped) {
      if (this.loginError !== null) {
        return { ...this.loginError, message: `登录失败：${this.loginError.message}（请检查 MCP 配置里的 SLG_TOKEN / SLG_SERVER）` };
      }
      if (this.isReady()) {
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return {
      code: 'MCP_NOT_READY',
      message: `尚未连上游戏服务器（${this.state}）：它会持续自动重连，请稍后重试；长时间不行请检查 SLG_SERVER（当前 ${this.config.server}）与网络`,
    };
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.state = 'connecting';
    await new Promise<void>((resolve) => {
      const socket = new WebSocket(this.config.server);
      this.socket = socket;
      const failTimer = setTimeout(() => {
        socket.terminate();
        resolve();
      }, this.config.readyTimeoutMs);
      socket.once('open', () => {
        clearTimeout(failTimer);
        void this.login(socket).finally(() => resolve());
      });
      socket.once('error', () => {
        clearTimeout(failTimer);
        resolve();
      });
      socket.on('message', (raw) => this.handleMessage(raw.toString()));
      socket.once('close', () => this.handleClose(socket));
    });
    if (!this.isReady()) {
      this.scheduleReconnect();
    }
  }

  private async login(socket: WebSocket): Promise<void> {
    const data: Record<string, unknown> = {
      token: this.config.token,
      asAgent: true,
      docVersion: this.manifest.version,
    };
    if (this.config.agentModel !== null) {
      data.agentModel = this.config.agentModel;
    }
    const response = await this.rawRequest(socket, LOGIN_OP, data);
    if (response.ok) {
      this.loginError = null;
      this.docNotice = typeof response.data.docNotice === 'string' ? response.data.docNotice : null;
      this.state = 'connected';
      this.reconnectAttempt = 0;
      this.pushSynthetic(this.notificationSeq > 0 ? 'reconnected' : 'connected');
    } else {
      this.loginError = response.error;
      this.state = 'disconnected';
      socket.close(4001, 'login failed');
    }
  }

  /** 不经 waitReady 的裸请求（登录用；连接刚打开必然可用） */
  private rawRequest(socket: WebSocket, op: number, data: Record<string, unknown>): Promise<GameResponse> {
    this.seq += 1;
    const seq = this.seq;
    return new Promise<GameResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        resolve({ ok: false, error: { code: 'MCP_TIMEOUT', message: '登录请求超时' } });
      }, this.config.requestTimeoutMs);
      this.pending.set(seq, { resolve, timer });
      socket.send(JSON.stringify({ op, seq, data }));
    });
  }

  private handleMessage(raw: string): void {
    let frame: {
      op?: unknown;
      seq?: unknown;
      push?: unknown;
      ok?: unknown;
      data?: unknown;
      error?: unknown;
      eventId?: unknown;
    };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (frame.push === true || typeof frame.op === 'number' && frame.op >= 2000) {
      const opNames = this.manifest.ops.find((candidate) => candidate.op === frame.op);
      this.buffer({
        eventId: typeof frame.eventId === 'number' ? frame.eventId : null,
        op: typeof frame.op === 'number' ? frame.op : -1,
        name: opNames?.name ?? `op_${String(frame.op)}`,
        data: (frame.data ?? {}) as Record<string, unknown>,
      });
      return;
    }
    if (typeof frame.seq === 'number') {
      const pending = this.pending.get(frame.seq);
      if (!pending) {
        return;
      }
      this.pending.delete(frame.seq);
      clearTimeout(pending.timer);
      if (frame.ok === true) {
        pending.resolve({ ok: true, data: (frame.data ?? {}) as Record<string, unknown> });
        return;
      }
      const error = frame.error as FrameError | undefined;
      pending.resolve({ ok: false, error: { code: error?.code ?? 'UNKNOWN', message: error?.message ?? '未知错误' } });
    }
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) {
      return;
    }
    const wasReady = this.state === 'connected';
    this.socket = null;
    this.state = 'disconnected';
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, error: { code: 'MCP_DISCONNECTED', message: '连接已断开，正在自动重连，请重试' } });
    }
    this.pending.clear();
    if (wasReady && !this.stopped) {
      this.pushSynthetic('disconnected');
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) {
      return;
    }
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }
}
