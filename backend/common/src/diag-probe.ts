// 数据库链路探针与事件循环卡顿监测（AISLG-173），API 与 Worker 启动后各调用一次。
//  [db-probe]  独立于连接池的专用连接（不占池位），每 15 秒执行 SELECT 1，3 秒超时。
//              正常静默（每 5 分钟一行心跳）；耗时超过 500ms、失败、恢复时各记一行。失败后下一轮重建连接。
//  [loop-lag]  事件循环卡顿超过 500ms 记一行（限流），用来排除「进程自身卡住」。

import net from 'node:net';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import pg from 'pg';
import { readDbConfig } from './db';
import { diagEnabled, diagLog, diagLogThrottled, quoteText } from './diag-log';
import { dbErrorReason, errorCodeOf } from './db-diag';

export const PROBE_INTERVAL_MS = 15_000;
export const PROBE_TIMEOUT_MS = 3_000;
export const PROBE_SLOW_MS = 500;
export const PROBE_HEARTBEAT_MS = 5 * 60_000;
export const LOOP_LAG_MS = 500;
const LOOP_LAG_CHECK_MS = 5_000;
const LOOP_LAG_THROTTLE_MS = 10_000;

/** 探针用的最小连接接口（默认实现是 pg.Client；测试注入假实现） */
export interface ProbeClient {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  on(event: 'error', listener: (err: Error) => void): void;
  /** 立即关闭：链路半死时 end 可能迟迟不返回，因此直接销毁底层 socket */
  destroy(): void;
}

export interface DbProbeOptions {
  createClient?: (name: string) => ProbeClient;
  intervalMs?: number;
  timeoutMs?: number;
  slowMs?: number;
  heartbeatMs?: number;
  clock?: () => number;
}

export interface DbProbe {
  /** 执行一轮探测（定时器每轮调用；测试可直接调用） */
  runOnce(): Promise<void>;
  stop(): void;
}

/** 默认探针连接：独立的 pg.Client，连接参数与池一致，application_name 带 -probe 后缀 */
function pgProbeClient(name: string): ProbeClient {
  const client = new pg.Client({
    ...readDbConfig(),
    application_name: `${name}-probe`,
    connectionTimeoutMillis: PROBE_TIMEOUT_MS,
  });
  const socket = (): net.Socket | undefined =>
    (client as unknown as { connection?: { stream?: net.Socket } }).connection?.stream;
  return {
    async connect(): Promise<void> {
      await client.connect();
      // 探针 socket 不阻止进程退出（定时器也已 unref）
      socket()?.unref();
    },
    query: (sql: string) => client.query(sql),
    on: (event, listener) => {
      client.on(event, listener);
    },
    destroy(): void {
      socket()?.destroy();
      void client.end().catch(() => undefined);
    },
  };
}

/** 超时保护：超时即以 Error 结束；work 先结束则清掉定时器 */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`probe timeout ${ms}ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * 启动数据库链路探针。name 为进程名（如 slg-api），用于日志与 application_name。
 * DIAG_LOG=0 时不启动（返回空实现）。进程退出时自动关闭探针连接。
 */
export function startDbProbe(name: string, options: DbProbeOptions = {}): DbProbe {
  if (!diagEnabled()) {
    return { runOnce: async () => undefined, stop: () => undefined };
  }
  const createClient = options.createClient ?? pgProbeClient;
  const intervalMs = options.intervalMs ?? PROBE_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const slowMs = options.slowMs ?? PROBE_SLOW_MS;
  const heartbeatMs = options.heartbeatMs ?? PROBE_HEARTBEAT_MS;
  const clock = options.clock ?? Date.now;

  let current: { client: ProbeClient; connected: boolean } | null = null;
  /** 连续失败的起点与次数（恢复时据此记下中断时长） */
  let failingSince: number | null = null;
  let failCount = 0;
  let lastHeartbeatAt = clock();
  let running = false;
  let stopped = false;

  const drop = (): void => {
    const dropped = current?.client;
    current = null;
    dropped?.destroy();
  };

  const ensureClient = (): { client: ProbeClient; connected: boolean } => {
    if (!current) {
      const client = createClient(name);
      client.on('error', (err) => {
        // 空闲探针连接断开：丢弃，下一轮重建（同时进行中的查询会以失败结束）
        if (current?.client === client) {
          drop();
        }
        diagLogThrottled(
          `probe-conn-error:${name}`,
          intervalMs,
          'db-probe',
          `connection-error name=${name} code=${errorCodeOf(err)} msg=${quoteText(err.message)}`,
          'warn',
        );
      });
      current = { client, connected: false };
    }
    return current;
  };

  const onOk = (ms: number): void => {
    const now = clock();
    if (failingSince !== null) {
      const downSeconds = Math.round((now - failingSince) / 1000);
      failingSince = null;
      failCount = 0;
      diagLog('db-probe', `recovered name=${name} ms=${ms} down_s=${downSeconds}`);
      return;
    }
    if (ms > slowMs) {
      diagLog('db-probe', `slow name=${name} ms=${ms}`, 'warn');
      return;
    }
    if (now - lastHeartbeatAt >= heartbeatMs) {
      lastHeartbeatAt = now;
      diagLog('db-probe', `ok name=${name} ms=${ms} heartbeat`);
    }
  };

  const onFail = (err: unknown, ms: number): void => {
    if (failingSince === null) {
      failingSince = clock();
    }
    failCount += 1;
    const text = err instanceof Error ? err.message : String(err);
    diagLog(
      'db-probe',
      `failed name=${name} ms=${ms} reason=${dbErrorReason(err)} consecutive=${failCount} msg=${quoteText(text)}`,
      'error',
    );
  };

  let timer: NodeJS.Timeout | undefined;
  const runOnce = async (): Promise<void> => {
    if (running || stopped) {
      return;
    }
    running = true;
    const startedAt = clock();
    try {
      const probe = ensureClient();
      await withTimeout(
        (async () => {
          if (!probe.connected) {
            await probe.client.connect();
            probe.connected = true;
          }
          await probe.client.query('SELECT 1');
        })(),
        timeoutMs,
      );
      onOk(clock() - startedAt);
    } catch (err) {
      onFail(err, clock() - startedAt);
      // 失败的连接不再复用：下一轮重建
      drop();
    } finally {
      running = false;
    }
  };

  const stop = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    if (timer) {
      clearInterval(timer);
    }
    process.removeListener('exit', stop);
    drop();
  };

  timer = setInterval(() => {
    void runOnce();
  }, intervalMs);
  timer.unref();
  process.on('exit', stop);

  return { runOnce, stop };
}

/** 单次采样的卡顿判定（maxMs 为采样窗口内的最大事件循环延迟） */
export function checkLoopLag(name: string, maxMs: number): void {
  if (maxMs > LOOP_LAG_MS) {
    diagLogThrottled(
      `loop-lag:${name}`,
      LOOP_LAG_THROTTLE_MS,
      'loop-lag',
      `stall name=${name} max_ms=${Math.round(maxMs)}`,
      'warn',
    );
  }
}

/** 启动事件循环卡顿监测（API 与 Worker 都启用）；返回停止函数 */
export function startLoopLagMonitor(name: string): () => void {
  if (!diagEnabled()) {
    return () => undefined;
  }
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const timer = setInterval(() => {
    // histogram 以纳秒计
    checkLoopLag(name, histogram.max / 1e6);
    histogram.reset();
  }, LOOP_LAG_CHECK_MS);
  timer.unref();
  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}
