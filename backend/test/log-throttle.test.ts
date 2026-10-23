// 日志节流与诊断日志输出（AISLG-173）：同一 key 窗口内只放行一行、放行时附带合并条数；
// 统一前缀与时间戳；DIAG_LOG=0 整体关闭；语句 / 错误文本单行截断。

import test from 'node:test';
import assert from 'node:assert/strict';
import { LogThrottle } from '../common/src/log-throttle';
import { diagEnabled, diagLog, diagLogThrottled, oneLine, quoteText } from '../common/src/diag-log';
import { captureConsole, withEnv } from './diag-capture';

test('LogThrottle：窗口内只放行第一次，之后合并计数，窗口过后放行并带出合并条数', () => {
  let now = 0;
  const throttle = new LogThrottle(() => now);
  assert.equal(throttle.take('k', 10_000), 0);
  assert.equal(throttle.take('k', 10_000), null);
  now = 5_000;
  assert.equal(throttle.take('k', 10_000), null);
  now = 10_000;
  // 窗口到点：放行，附带窗口内被合并的 2 条
  assert.equal(throttle.take('k', 10_000), 2);
  // 放行后重新计窗口
  assert.equal(throttle.take('k', 10_000), null);
});

test('LogThrottle：不同 key 互不影响', () => {
  const throttle = new LogThrottle(() => 0);
  assert.equal(throttle.take('a', 10_000), 0);
  assert.equal(throttle.take('b', 10_000), 0);
  assert.equal(throttle.take('a', 10_000), null);
});

test('风暴：上千条同类失败只输出一行，其余计入合并', async () => {
  const key = 'test-storm-only-one-line';
  const lines = await captureConsole(() => {
    for (let i = 0; i < 1000; i += 1) {
      diagLogThrottled(key, 60_000, 'db-slow', 'statement_timeout pool=test');
    }
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T\S+Z \[db-slow\] statement_timeout pool=test$/);
});

test('diagLog：统一为 ISO 时间戳加固定前缀', async () => {
  const lines = await captureConsole(() => diagLog('db-probe', 'ok name=x ms=3'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[db-probe\] ok name=x ms=3$/);
});

test('DIAG_LOG=0：诊断日志整体关闭', async () => {
  await withEnv({ DIAG_LOG: '0' }, async () => {
    assert.equal(diagEnabled(), false);
    const lines = await captureConsole(() => {
      diagLog('db-probe', 'should not print');
      diagLogThrottled('test-disabled-key', 60_000, 'db-slow', 'should not print either');
    });
    assert.deepEqual(lines, []);
  });
  await withEnv({ DIAG_LOG: undefined }, () => {
    assert.equal(diagEnabled(), true);
  });
});

test('oneLine / quoteText：去掉换行与多余空白，超过 200 字符截断', () => {
  assert.equal(oneLine('SELECT 1\n   FROM   t'), 'SELECT 1 FROM t');
  const long = 'x'.repeat(300);
  assert.equal(oneLine(long).length, 201);
  assert.equal(quoteText('a\nb'), '"a b"');
});
