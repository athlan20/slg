// 连接池超时与 TCP keepalive（AISLG-171）的单元测试：不连数据库，只检查 createPool 的配置，
// 以及查询读超时后「仍在途的连接」会不会被丢弃（不被带病放回池里）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool, MAINTENANCE_STATEMENT_TIMEOUT_MS } from '../common/src/db';

const TIMEOUT_ENVS = ['DB_STATEMENT_TIMEOUT_MS'] as const;

function withEnv(env: Partial<Record<(typeof TIMEOUT_ENVS)[number], string>>, run: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of TIMEOUT_ENVS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, env);
  try {
    run();
  } finally {
    for (const key of TIMEOUT_ENVS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

function optionsOf(pool: unknown): Record<string, unknown> {
  return (pool as { options: Record<string, unknown> }).options;
}

test('运行期连接池：默认语句超时 30 秒，客户端读超时比它多 5 秒，并开启 TCP keepalive', () => {
  withEnv({}, () => {
    const options = optionsOf(createPool('test-runtime'));
    assert.equal(options.statement_timeout, 30_000);
    assert.equal(options.query_timeout, 35_000);
    assert.equal(options.keepAlive, true);
    assert.equal(options.keepAliveInitialDelayMillis, 10_000);
    assert.equal(options.connectionTimeoutMillis, 10_000);
  });
});

test('DB_STATEMENT_TIMEOUT_MS 可调，客户端读超时随之平移', () => {
  withEnv({ DB_STATEMENT_TIMEOUT_MS: '8000' }, () => {
    const options = optionsOf(createPool('test-tuned'));
    assert.equal(options.statement_timeout, 8_000);
    assert.equal(options.query_timeout, 13_000);
  });
});

test('维护连接池：超时放宽到 MAINTENANCE_STATEMENT_TIMEOUT_MS，不受运行期变量影响', () => {
  withEnv({ DB_STATEMENT_TIMEOUT_MS: '8000' }, () => {
    const options = optionsOf(createPool('test-maint', 2, { maintenance: true }));
    assert.equal(MAINTENANCE_STATEMENT_TIMEOUT_MS, 600_000);
    assert.equal(options.statement_timeout, 600_000);
    assert.equal(options.query_timeout, 605_000);
    assert.equal(options.keepAlive, true);
  });
});

test('查询读超时后仍在途的连接在 release 时被结束（不带病放回池）', () => {
  const pool = createPool('test-stuck');
  let ended = 0;
  const stuck = {
    readyForQuery: false,
    end: async () => {
      ended += 1;
    },
  };
  // 调用方未传错误的 release：仍有查询在途，应被结束
  pool.emit('release', undefined, stuck);
  assert.equal(ended, 1);
});

test('正常结束的连接 release 时不被结束', () => {
  const pool = createPool('test-healthy');
  let ended = 0;
  const healthy = {
    readyForQuery: true,
    end: async () => {
      ended += 1;
    },
  };
  pool.emit('release', undefined, healthy);
  assert.equal(ended, 0);
});
