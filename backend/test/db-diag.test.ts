// 连接池诊断（AISLG-173）：用假池 / 假连接模拟事件，核对 [db-pool] / [db-conn] / [db-hold] / [db-slow] 的触发、
// 限流与「不记参数」。不连数据库；createPool 的既有行为由 db-pool-config.test.ts 覆盖。

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type pg from 'pg';
import { attachPoolDiagnostics, logConnError } from '../common/src/db-diag';
import { captureConsole, silenceConsole, withEnv } from './diag-capture';

type ConnectCallback = (err: unknown, client?: unknown, release?: unknown) => void;

/** 假连接：query 行为由 script 决定（可推进模拟时钟、可抛错） */
class FakeClient extends EventEmitter {
  processID = 4242;
  script: (sql: string) => Promise<unknown> = async () => ({ rows: [] });
  query(text: unknown, values?: unknown, callback?: unknown): Promise<unknown> {
    const sql = typeof text === 'string' ? text : (text as { text: string }).text;
    const work = this.script(sql);
    const cb = typeof values === 'function' ? values : typeof callback === 'function' ? callback : null;
    if (cb) {
      const done = cb as (err: unknown, res?: unknown) => void;
      work.then(
        (res) => done(null, res),
        (err) => done(err),
      );
      // 回调形式不返回 Promise（与 pg 一致）
      return undefined as unknown as Promise<unknown>;
    }
    return work;
  }
}

/** 假池：只提供诊断用到的接口（事件、计数、connect） */
class FakePool extends EventEmitter {
  totalCount = 1;
  idleCount = 0;
  waitingCount = 0;
  ended = false;
  connectError: Error | null = null;
  constructor(readonly client: FakeClient) {
    super();
  }
  connect(callback?: ConnectCallback): Promise<FakeClient> {
    if (this.connectError) {
      if (callback) {
        callback(this.connectError);
        return undefined as unknown as Promise<FakeClient>;
      }
      return Promise.reject(this.connectError);
    }
    if (callback) {
      callback(undefined, this.client, () => undefined);
      return undefined as unknown as Promise<FakeClient>;
    }
    return Promise.resolve(this.client);
  }
}

/** 挂好诊断的假池；定时器关闭，池状态由用例显式 tick 推进（时钟为假时钟） */
function setup(poolName: string): { pool: FakePool; client: FakeClient; clock: { now: number }; tick: (now?: number) => void } {
  const client = new FakeClient();
  const pool = new FakePool(client);
  const clock = { now: 1_000_000 };
  const diag = attachPoolDiagnostics(pool as unknown as pg.Pool, poolName, { clock: () => clock.now, startTimer: false });
  // 与 pg-pool 一致：先 connect 再 acquire（夹具内的 connect 行不计入用例）
  silenceConsole(() => pool.emit('connect', client));
  return { pool, client, clock, tick: (now = clock.now) => diag.tick(now) };
}

test('连接新建与移除：带后端进程号与存活时长', async () => {
  const { pool, client } = setup('t-conn');
  const lines = await captureConsole(() => {
    pool.emit('remove', client);
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[db-conn\] removed pool=t-conn pid=4242 lived=0\.0s$/);
});

test('占用者：借出超过 5 秒才归还时记一行，语句只记文本、不记参数', async () => {
  const { pool, client, clock } = setup('t-hold');
  client.script = async () => ({ rows: [] });
  const lines = await captureConsole(async () => {
    pool.emit('acquire', client);
    await client.query('SELECT id FROM accounts WHERE username = $1', ['secret-user-name']);
    clock.now += 6_000;
    pool.emit('release', undefined, client);
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[db-hold\] held pool=t-hold pid=4242 ms=6000 sql="SELECT id FROM accounts WHERE username = \$1"$/);
  assert.ok(!lines.join('\n').includes('secret-user-name'), '日志不得含语句参数');
});

test('占用未超过 5 秒：归还时不记', async () => {
  const { pool, client, clock } = setup('t-hold-short');
  const lines = await captureConsole(() => {
    pool.emit('acquire', client);
    clock.now += 4_000;
    pool.emit('release', undefined, client);
  });
  assert.deepEqual(lines, []);
});

test('池状态：超过 10 秒仍被占用的连接在池状态行里列出', async () => {
  const { pool, client, clock, tick } = setup('t-status-holder');
  pool.emit('acquire', client);
  clock.now += 12_000;
  const lines = await captureConsole(() => tick());
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[db-pool\] status pool=t-status-holder state=ok total=1 idle=0 waiting=0 holding_over_10s=1 top=\[pid=4242 held=12\.0s/);
});

test('池状态：有排队时每 5 秒一行，恢复时记一行，空闲时每 30 秒一行', async () => {
  const { pool, clock, tick } = setup('t-status-queue');
  const start = clock.now;
  const lines = await captureConsole(() => {
    // 空闲：首次检查即一行
    tick(start);
    // 空闲 29 秒：静默
    tick(start + 29_000);
    // 出现排队：立即一行（状态 queued）
    pool.waitingCount = 3;
    tick(start + 29_500);
    // 排队中 1 秒后：静默
    tick(start + 30_500);
    // 排队中满 5 秒：再一行
    tick(start + 34_500);
    // 恢复：一行 recovered
    pool.waitingCount = 0;
    tick(start + 35_000);
    // 恢复后的空闲计时从恢复时刻起
    tick(start + 60_000);
  });
  const states = lines.map((line) => /state=(\w+)/.exec(line)?.[1]);
  assert.deepEqual(states, ['ok', 'queued', 'queued', 'recovered']);
  assert.match(lines[2], /waiting=3/);
});

test('拿连接失败时附一次池快照（含超时错误码与文本）', async () => {
  const { pool } = setup('t-connect-fail');
  pool.connectError = new Error('timeout exceeded when trying to connect');
  const lines = await captureConsole(async () => {
    await assert.rejects(pool.connect());
    await new Promise<void>((resolve) => {
      pool.connect((err) => {
        assert.ok(err);
        resolve();
      });
    });
  });
  // 两种调用形式各一行快照；第二次命中同一 key 的窗口，被合并
  assert.equal(lines.length, 1);
  assert.match(
    lines[0],
    /\[db-pool\] connect-failed pool=t-connect-fail code=unknown msg="timeout exceeded when trying to connect" total=1 idle=0 waiting=0 holding_over_10s=0/,
  );
});

test('慢语句：超过 2 秒记一行（耗时、语句文本）', async () => {
  const { client, clock } = setup('t-slow');
  client.script = async () => {
    clock.now += 2_500;
    return { rows: [] };
  };
  const lines = await captureConsole(async () => {
    await client.query('SELECT * FROM world_tiles');
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[db-slow\] slow pool=t-slow pid=4242 ms=2500 sql="SELECT \* FROM world_tiles"$/);
});

test('语句超时（57014）与客户端读超时单独标出，不论耗时', async () => {
  const { client } = setup('t-timeouts');
  const statementTimeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
  client.script = async () => {
    throw statementTimeout;
  };
  const first = await captureConsole(async () => {
    await assert.rejects(client.query('UPDATE cities SET gold = 1'));
  });
  assert.equal(first.length, 1);
  assert.match(first[0], /\[db-slow\] statement_timeout pool=t-timeouts pid=4242 ms=0 code=57014 sql="UPDATE cities SET gold = 1"$/);

  client.script = async () => {
    throw new Error('Query read timeout');
  };
  const second = await captureConsole(async () => {
    await assert.rejects(client.query('SELECT 1'));
  });
  assert.equal(second.length, 1);
  assert.match(second[0], /\[db-slow\] read_timeout pool=t-timeouts pid=4242 ms=0 sql="SELECT 1"$/);
});

test('风暴：上千条同类超时只输出一行，日志量受控', async () => {
  const { client } = setup('t-storm');
  client.script = async () => {
    throw Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
  };
  const lines = await captureConsole(async () => {
    for (let i = 0; i < 1000; i += 1) {
      await client.query('SELECT 1').catch(() => undefined);
    }
  });
  assert.equal(lines.length, 1);
});

test('连接上的错误：带错误码与短文本，同类限流', async () => {
  const lines = await captureConsole(() => {
    logConnError('t-err', 'client', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
    logConnError('t-err', 'client', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }));
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[db-conn\] error pool=t-err scope=client code=ECONNRESET msg="read ECONNRESET"$/);
});

test('DIAG_LOG=0：不挂任何观测，错误输出保持原样', async () => {
  await withEnv({ DIAG_LOG: '0' }, async () => {
    const client = new FakeClient();
    const pool = new FakePool(client);
    const rawConnect = pool.connect;
    attachPoolDiagnostics(pool as unknown as pg.Pool, 't-off');
    assert.equal(pool.connect, rawConnect, '关闭时不包装 connect');
    const lines = await captureConsole(() => {
      pool.emit('connect', client);
      pool.emit('release', undefined, client);
      logConnError('t-off', 'pool', new Error('boom'));
    });
    assert.deepEqual(lines, ['pg pool error (t-off): boom']);
  });
});
