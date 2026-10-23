// 数据库链路探针与事件循环卡顿（AISLG-173）：注入假探针连接，核对静默 / 慢 / 失败 / 恢复 / 心跳 / 重建 / 超时的日志，
// 以及卡顿阈值。不连数据库。

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLoopLag, startDbProbe, startLoopLagMonitor, type DbProbe, type ProbeClient } from '../common/src/diag-probe';
import { captureConsole, withEnv } from './diag-capture';

/** 假链路：所有探针连接共享。costMs 为每次查询推进的耗时；failWith 为查询失败原因；hang 令查询挂起 */
interface FakeLink {
  now: number;
  costMs: number;
  failWith: Error | null;
  hang: boolean;
}

/** 假探针连接：统计建连、销毁次数与执行过的语句 */
class FakeProbeClient implements ProbeClient {
  connects = 0;
  destroyed = 0;
  queries: string[] = [];
  constructor(private readonly link: FakeLink) {}
  async connect(): Promise<void> {
    this.connects += 1;
  }
  query(sql: string): Promise<unknown> {
    this.queries.push(sql);
    if (this.link.hang) {
      return new Promise(() => undefined);
    }
    this.link.now += this.link.costMs;
    if (this.link.failWith) {
      return Promise.reject(this.link.failWith);
    }
    return Promise.resolve({ rows: [] });
  }
  on(_event: 'error', _listener: (err: Error) => void): void {
    // 本用例不模拟空闲断线
  }
  destroy(): void {
    this.destroyed += 1;
  }
}

function makeProbe(options: { timeoutMs?: number; heartbeatMs?: number } = {}) {
  const created: FakeProbeClient[] = [];
  const link: FakeLink = { now: 1_000_000, costMs: 0, failWith: null, hang: false };
  const probe: DbProbe = startDbProbe('t-probe', {
    createClient: () => {
      const client = new FakeProbeClient(link);
      created.push(client);
      return client;
    },
    intervalMs: 3_600_000,
    timeoutMs: options.timeoutMs ?? 3_000,
    slowMs: 500,
    heartbeatMs: options.heartbeatMs ?? 5 * 60_000,
    clock: () => link.now,
  });
  return { probe, created, link };
}

test('正常：耗时在阈值内且未到心跳周期时静默', async () => {
  const { probe, created } = makeProbe();
  try {
    const lines = await captureConsole(() => probe.runOnce());
    assert.deepEqual(lines, []);
    assert.equal(created.length, 1);
    assert.equal(created[0].connects, 1);
    assert.deepEqual(created[0].queries, ['SELECT 1']);
  } finally {
    probe.stop();
  }
});

test('正常：每 5 分钟一行心跳', async () => {
  const { probe, link } = makeProbe();
  try {
    link.now += 5 * 60_000;
    const lines = await captureConsole(() => probe.runOnce());
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[db-probe\] ok name=t-probe ms=0 heartbeat$/);
  } finally {
    probe.stop();
  }
});

test('耗时超过 500ms：记一行慢（不算失败，连接保留）', async () => {
  const { probe, created, link } = makeProbe();
  try {
    link.costMs = 800;
    const lines = await captureConsole(() => probe.runOnce());
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[db-probe\] slow name=t-probe ms=800$/);
    assert.equal(created[0].destroyed, 0);
  } finally {
    probe.stop();
  }
});

test('失败：记一行（耗时、错误），连接销毁；下一轮重建，恢复时记一行', async () => {
  const { probe, created, link } = makeProbe();
  try {
    link.costMs = 40;
    link.failWith = Object.assign(new Error('terminating connection due to administrator command'), { code: '57P01' });
    const failed = await captureConsole(() => probe.runOnce());
    assert.equal(failed.length, 1);
    assert.match(
      failed[0],
      /\[db-probe\] failed name=t-probe ms=40 reason=57P01 consecutive=1 msg="terminating connection due to administrator command"$/,
    );
    assert.equal(created[0].destroyed, 1, '失败的连接被销毁');

    // 链路恢复：下一轮重建连接并成功，记 recovered（中断约 15 秒）
    link.costMs = 0;
    link.failWith = null;
    link.now += 15_000;
    const recovered = await captureConsole(() => probe.runOnce());
    assert.equal(created.length, 2, '下一轮重建连接');
    assert.equal(created[1].connects, 1);
    assert.equal(recovered.length, 1);
    assert.match(recovered[0], /\[db-probe\] recovered name=t-probe ms=0 down_s=15$/);
  } finally {
    probe.stop();
  }
});

test('连续失败：consecutive 递增，恢复后从头计', async () => {
  const { probe, link } = makeProbe();
  try {
    link.failWith = new Error('connection refused');
    const first = await captureConsole(() => probe.runOnce());
    const second = await captureConsole(() => probe.runOnce());
    assert.match(first[0], /consecutive=1/);
    assert.match(second[0], /consecutive=2/);
    link.failWith = null;
    await captureConsole(() => probe.runOnce());
    link.failWith = new Error('connection refused');
    const again = await captureConsole(() => probe.runOnce());
    assert.match(again[0], /consecutive=1/);
  } finally {
    probe.stop();
  }
});

test('探测超时（3 秒，此处取 20ms）：视为失败，错误为超时，连接销毁', async () => {
  const created: FakeProbeClient[] = [];
  const link: FakeLink = { now: 0, costMs: 0, failWith: null, hang: true };
  const probe = startDbProbe('t-timeout', {
    createClient: () => {
      const client = new FakeProbeClient(link);
      created.push(client);
      return client;
    },
    intervalMs: 3_600_000,
    timeoutMs: 20,
  });
  try {
    const lines = await captureConsole(() => probe.runOnce());
    assert.equal(lines.length, 1);
    assert.match(lines[0], /\[db-probe\] failed name=t-timeout ms=\d+ reason=error consecutive=1 msg="probe timeout 20ms"$/);
    assert.equal(created[0].destroyed, 1);
  } finally {
    probe.stop();
  }
});

test('stop 之后不再探测，已建连接被销毁', async () => {
  const { probe, created } = makeProbe();
  await probe.runOnce();
  probe.stop();
  await probe.runOnce();
  assert.equal(created.length, 1);
  assert.equal(created[0].destroyed, 1);
});

test('DIAG_LOG=0：探针不启动，不建任何连接', async () => {
  await withEnv({ DIAG_LOG: '0' }, async () => {
    let created = 0;
    const probe = startDbProbe('t-off', {
      createClient: () => {
        created += 1;
        return new FakeProbeClient({ now: 0, costMs: 0, failWith: null, hang: false });
      },
      intervalMs: 10,
    });
    await probe.runOnce();
    probe.stop();
    assert.equal(created, 0);
  });
});

test('事件循环卡顿：超过 500ms 记一行，未超过不记', async () => {
  const lines = await captureConsole(() => {
    checkLoopLag('t-lag-quiet', 120);
    checkLoopLag('t-lag-stall', 812.4);
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[loop-lag\] stall name=t-lag-stall max_ms=812$/);
});

test('事件循环监测可启动与停止', () => {
  const stop = startLoopLagMonitor('t-lag-monitor');
  stop();
});
