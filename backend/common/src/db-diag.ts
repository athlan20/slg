// 连接池诊断（AISLG-173）：挂在 createPool 返回的池上做观测，只读不改行为（查询、归还，以及 AISLG-171
// 的「结束带着在途查询回池的连接」都不动）。输出的前缀：
//  [db-pool]  池状态：每 30 秒一行；有请求排队时每 5 秒一行直到恢复；拿连接失败时附一次快照
//  [db-conn]  连接新建（带后端进程号）、被池移除（带存活时长）、连接上的错误（带错误码）
//  [db-hold]  连接借出超过 5 秒才归还：占用时长与最后一条语句
//  [db-slow]  语句超过 2 秒；语句超时（57014）与客户端读超时单独标出
// 语句只记文本（截断到 200 字符），不记参数；同类行都走 diagLogThrottled 限流。

import type pg from 'pg';
import { diagEnabled, diagLog, diagLogThrottled, quoteText } from './diag-log';

/** 池状态：空闲时每 30 秒一行，有排队时每 5 秒一行；检查粒度 1 秒 */
const STATUS_IDLE_MS = 30_000;
const STATUS_QUEUED_MS = 5_000;
const STATUS_CHECK_MS = 1_000;
/** 借出超过它才记 [db-hold] */
const HOLD_LOG_MS = 5_000;
/** 池状态行里列出仍被占用超过它的连接，最多列出 HOLD_LIST_MAX 条 */
const HOLD_LIST_MS = 10_000;
const HOLD_LIST_MAX = 3;
/** 语句超过它记 [db-slow] */
const SLOW_QUERY_MS = 2_000;
/** 同类日志（超时、慢语句、连接错误、占用、新建 / 移除）的限流窗口 */
const THROTTLE_MS = 10_000;

const STATEMENT_TIMEOUT_CODE = '57014';
const READ_TIMEOUT_MESSAGE = 'Query read timeout';
const CONNECT_TIMEOUT_MESSAGE = 'timeout exceeded when trying to connect';

interface ConnState {
  pid: number | undefined;
  connectedAt: number;
  /** 借出时刻；归还后清空，非空即仍被占用 */
  borrowedAt: number | null;
  /** 最近一条语句的文本（不含参数） */
  lastSql: string;
}

type Clock = () => number;

type ConnectCallback = (err: unknown, client?: pg.PoolClient, release?: unknown) => void;

export interface PoolDiagnostics {
  /** 按时刻推进池状态检查：定时器每秒调用一次，测试可直接传入时刻 */
  tick(now: number): void;
}

function errorTextOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 错误码（pg / 系统错误的 code），没有则 'unknown' */
export function errorCodeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' || typeof code === 'number' ? String(code) : 'unknown';
}

/** 数据库错误的短分类（记录原因用）：拿连接超时 / 读超时 / 其余按错误码 */
export function dbErrorReason(err: unknown): string {
  const text = errorTextOf(err);
  if (text.includes(CONNECT_TIMEOUT_MESSAGE)) {
    return 'pool_timeout';
  }
  if (text === READ_TIMEOUT_MESSAGE) {
    return 'read_timeout';
  }
  const code = errorCodeOf(err);
  return code === 'unknown' ? 'error' : code;
}

/**
 * 连接上 / 池上的错误（替代 createPool 原有的两处错误输出）：带错误码与短文本，同类限流。
 * 诊断关闭（DIAG_LOG=0）时保留原来的 console.error 行，不因开关丢失错误信息。
 */
export function logConnError(poolName: string, scope: 'pool' | 'client', err: unknown): void {
  if (!diagEnabled()) {
    console.error(`pg ${scope} error (${poolName}):`, errorTextOf(err));
    return;
  }
  diagLogThrottled(
    `conn-error:${poolName}:${scope}:${errorCodeOf(err)}`,
    THROTTLE_MS,
    'db-conn',
    `error pool=${poolName} scope=${scope} code=${errorCodeOf(err)} msg=${quoteText(errorTextOf(err))}`,
    'error',
  );
}

function isPromise(value: unknown): value is Promise<unknown> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

export interface PoolDiagnosticsOptions {
  /** 时钟（测试注入）；默认 Date.now */
  clock?: Clock;
  /** 是否由内部定时器驱动池状态检查（默认是；测试关掉后手动调用 tick） */
  startTimer?: boolean;
}

/**
 * 给池挂上诊断观测。池名用 applicationName（api / worker / 维护池各自一个名字）。
 * DIAG_LOG=0 时什么都不挂，行为与改动前完全一致。
 */
export function attachPoolDiagnostics(
  pool: pg.Pool,
  poolName: string,
  options: PoolDiagnosticsOptions = {},
): PoolDiagnostics {
  if (!diagEnabled()) {
    return { tick: () => undefined };
  }
  const clock: Clock = options.clock ?? Date.now;

  const states = new WeakMap<object, ConnState>();
  /** 当前被借出的连接（用于池状态行列出长时间占用者） */
  const borrowed = new Set<ConnState>();

  const pidOf = (state: ConnState): string => String(state.pid ?? '?');

  /** 语句记录：包装 client.query，只存文本，不存参数；超时与慢语句在这里判定 */
  const observeQueries = (client: pg.PoolClient, state: ConnState): void => {
    const target = client as unknown as { query: (...args: unknown[]) => unknown };
    const rawQuery = target.query;
    const report = (err: unknown, startedAt: number): void => {
      const ms = clock() - startedAt;
      const sql = quoteText(state.lastSql);
      if (err && errorCodeOf(err) === STATEMENT_TIMEOUT_CODE) {
        diagLogThrottled(
          `slow-statement-timeout:${poolName}`,
          THROTTLE_MS,
          'db-slow',
          `statement_timeout pool=${poolName} pid=${pidOf(state)} ms=${ms} code=${STATEMENT_TIMEOUT_CODE} sql=${sql}`,
          'warn',
        );
      } else if (err && errorTextOf(err) === READ_TIMEOUT_MESSAGE) {
        diagLogThrottled(
          `slow-read-timeout:${poolName}`,
          THROTTLE_MS,
          'db-slow',
          `read_timeout pool=${poolName} pid=${pidOf(state)} ms=${ms} sql=${sql}`,
          'warn',
        );
      } else if (ms > SLOW_QUERY_MS) {
        diagLogThrottled(
          `slow:${poolName}`,
          THROTTLE_MS,
          'db-slow',
          `slow pool=${poolName} pid=${pidOf(state)} ms=${ms} sql=${sql}`,
          'warn',
        );
      }
    };
    target.query = function observedQuery(this: unknown, ...args: unknown[]): unknown {
      const first = args[0];
      const text = typeof first === 'string' ? first : (first as { text?: unknown } | null | undefined)?.text;
      if (typeof text === 'string') {
        state.lastSql = text;
      }
      const startedAt = clock();
      const last = args.length - 1;
      const callback = typeof args[last] === 'function' ? (args[last] as (...cbArgs: unknown[]) => unknown) : null;
      if (callback) {
        // 回调形式：在调用方的回调之前记录，回调本身的参数与行为不变
        args[last] = function observedCallback(this: unknown, err: unknown, ...rest: unknown[]): unknown {
          report(err, startedAt);
          return callback.call(this, err, ...rest);
        };
      }
      const result = rawQuery.apply(this, args);
      if (!callback && isPromise(result)) {
        // Promise 形式：只旁路观察结果，原 Promise 原样返回给调用方（错误仍由调用方处理）
        result.then(
          () => report(undefined, startedAt),
          (err: unknown) => report(err, startedAt),
        );
      }
      return result;
    };
  };

  pool.on('connect', (client: pg.PoolClient) => {
    const state: ConnState = {
      pid: (client as unknown as { processID?: number }).processID,
      connectedAt: clock(),
      borrowedAt: null,
      lastSql: '',
    };
    states.set(client, state);
    observeQueries(client, state);
    diagLogThrottled(`conn-new:${poolName}`, THROTTLE_MS, 'db-conn', `new pool=${poolName} pid=${pidOf(state)}`);
  });

  pool.on('acquire', (client: pg.PoolClient) => {
    const state = states.get(client);
    if (!state) {
      return;
    }
    state.borrowedAt = clock();
    borrowed.add(state);
  });

  // 与 createPool 里 AISLG-171 的 release 监听并存：这里只读借出时刻、计算占用时长
  pool.on('release', (_err: unknown, client: pg.PoolClient) => {
    const state = states.get(client);
    if (!state || state.borrowedAt === null) {
      return;
    }
    const heldMs = clock() - state.borrowedAt;
    state.borrowedAt = null;
    borrowed.delete(state);
    if (heldMs > HOLD_LOG_MS) {
      diagLogThrottled(
        `hold:${poolName}`,
        THROTTLE_MS,
        'db-hold',
        `held pool=${poolName} pid=${pidOf(state)} ms=${heldMs} sql=${quoteText(state.lastSql)}`,
        'warn',
      );
    }
  });

  pool.on('remove', (client: pg.PoolClient) => {
    const state = states.get(client);
    if (!state) {
      return;
    }
    states.delete(client);
    borrowed.delete(state);
    const livedSeconds = ((clock() - state.connectedAt) / 1000).toFixed(1);
    diagLogThrottled(
      `conn-remove:${poolName}`,
      THROTTLE_MS,
      'db-conn',
      `removed pool=${poolName} pid=${pidOf(state)} lived=${livedSeconds}s`,
    );
  });

  /** 池快照：总数 / 空闲 / 排队，以及仍被占用超过 10 秒的前几条 */
  const snapshot = (now: number): string => {
    const longHolders = [...borrowed]
      .filter((state) => state.borrowedAt !== null && now - state.borrowedAt >= HOLD_LIST_MS)
      .sort((a, b) => (a.borrowedAt ?? 0) - (b.borrowedAt ?? 0));
    const top = longHolders
      .slice(0, HOLD_LIST_MAX)
      .map((state) => {
        const heldSeconds = ((now - (state.borrowedAt ?? now)) / 1000).toFixed(1);
        return `pid=${pidOf(state)} held=${heldSeconds}s sql=${quoteText(state.lastSql)}`;
      });
    const topText = top.length > 0 ? ` top=[${top.join('; ')}]` : '';
    return `total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount} holding_over_10s=${longHolders.length}${topText}`;
  };

  // 拿连接失败（含拿连接超时）时附一次快照：包装 pool.connect（pool.query 也走它）
  const rawConnect = pool.connect.bind(pool) as unknown as (callback?: ConnectCallback) => unknown;
  const reportConnectFailure = (err: unknown): void => {
    diagLogThrottled(
      `connect-fail:${poolName}`,
      THROTTLE_MS,
      'db-pool',
      `connect-failed pool=${poolName} code=${errorCodeOf(err)} msg=${quoteText(errorTextOf(err))} ${snapshot(clock())}`,
      'warn',
    );
  };
  (pool as unknown as { connect: unknown }).connect = function observedConnect(
    this: unknown,
    callback?: ConnectCallback,
  ): unknown {
    if (callback) {
      return rawConnect((err, client, release) => {
        if (err) {
          reportConnectFailure(err);
        }
        callback(err, client, release);
      });
    }
    return (rawConnect() as Promise<pg.PoolClient>).catch((err: unknown) => {
      reportConnectFailure(err);
      throw err;
    });
  };

  let queued = false;
  let lastStatusAt: number | null = null;
  let timer: NodeJS.Timeout | undefined;
  const tick = (now: number): void => {
    if (pool.ended) {
      if (timer) {
        clearInterval(timer);
      }
      return;
    }
    if (pool.waitingCount > 0) {
      // 有请求排队：每 5 秒一行，直到恢复
      if (!queued || lastStatusAt === null || now - lastStatusAt >= STATUS_QUEUED_MS) {
        queued = true;
        lastStatusAt = now;
        diagLog('db-pool', `status pool=${poolName} state=queued ${snapshot(now)}`, 'warn');
      }
      return;
    }
    if (queued) {
      queued = false;
      lastStatusAt = now;
      diagLog('db-pool', `status pool=${poolName} state=recovered ${snapshot(now)}`);
      return;
    }
    // 正常：每 30 秒一行（启动后第一次检查即输出一行，便于确认池已挂上诊断）
    if (lastStatusAt === null || now - lastStatusAt >= STATUS_IDLE_MS) {
      lastStatusAt = now;
      diagLog('db-pool', `status pool=${poolName} state=ok ${snapshot(now)}`);
    }
  };

  // 定时器 unref：不阻止进程退出，也不影响测试退出
  if (options.startTimer !== false) {
    timer = setInterval(() => tick(clock()), STATUS_CHECK_MS);
    timer.unref();
  }

  return { tick };
}
