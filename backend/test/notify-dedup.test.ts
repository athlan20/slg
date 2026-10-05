// 行军结算推送去重（AISLG-51）的单元测试：march_resolved 的 notify 直推与水位线轮询
// 双路覆盖同一条结算，去重守卫保证同一 (marchId, resolved_at) 只广播一次——否则两次
// broadcast 生成不同 eventId，破坏「eventId 为推送去重键」的承诺。轮询/监听的数据库
// 链路不在单测覆盖，由冒烟与线上回归验证。
import test from 'node:test';
import assert from 'node:assert/strict';

import type pg from 'pg';
import { CompletionNotifier } from '../api/src/notify';
import type { ConnectionRegistry } from '../api/src/connections';
import type { MarchRow } from '../api/src/views';

interface Captured {
  accountId: string;
  reason: string;
  marchId: string;
}

/** pushMarchRow 是私有方法：测试经结构断言直取，注入假 registry 收集广播 */
function notifierWithSink(): { notifier: CompletionNotifier; sink: Captured[] } {
  const sink: Captured[] = [];
  const registry = {
    broadcast(accountId: string, frame: { data?: { reason?: string; march?: { id?: string } } }) {
      sink.push({
        accountId,
        reason: String(frame.data?.reason),
        marchId: String(frame.data?.march?.id),
      });
    },
  } as unknown as ConnectionRegistry;
  const notifier = new CompletionNotifier({} as pg.Pool, registry);
  return { notifier, sink };
}

function marchRow(id: string, resolvedAt: Date | null, status = 'arrived'): MarchRow {
  return {
    id,
    account_id: 'acc-1',
    from_city_id: 'city-1',
    x: 10,
    y: 20,
    troops: { porter: 1 },
    purpose: 'plunder',
    status,
    initiator: 'player',
    started_at: new Date(0),
    arrive_at: new Date(1000),
    resolved_at: resolvedAt,
  };
}

function push(notifier: CompletionNotifier, row: MarchRow): void {
  (notifier as unknown as { pushMarchRow(a: string, r: MarchRow): void }).pushMarchRow(
    row.account_id,
    row,
  );
}

test('同一行军的同一结算（直推 + 轮询）只广播一次', () => {
  const { notifier, sink } = notifierWithSink();
  const resolvedAt = new Date('2026-10-01T04:24:00.500Z');
  push(notifier, marchRow('m-1', resolvedAt));
  push(notifier, marchRow('m-1', resolvedAt));
  assert.equal(sink.length, 1);
  assert.deepEqual(sink[0], { accountId: 'acc-1', reason: 'march_arrived', marchId: 'm-1' });
});

test('不同行军、到达与返程互不去重', () => {
  const { notifier, sink } = notifierWithSink();
  const at = new Date('2026-10-01T04:24:00.500Z');
  push(notifier, marchRow('m-1', at));
  push(notifier, marchRow('m-2', at));
  push(notifier, marchRow('m-3', at, 'returned'));
  assert.equal(sink.length, 3);
  assert.deepEqual(
    sink.map((c) => c.reason),
    ['march_arrived', 'march_arrived', 'march_returned'],
  );
});

test('同 id 不同结算时刻不去重（守卫键含 resolved_at）', () => {
  const { notifier, sink } = notifierWithSink();
  push(notifier, marchRow('m-1', new Date(1000)));
  push(notifier, marchRow('m-1', new Date(2000)));
  assert.equal(sink.length, 2);
});

test('去重键消费后不残留：后续不同结算照常广播', () => {
  const { notifier, sink } = notifierWithSink();
  push(notifier, marchRow('m-1', new Date(1000)));
  push(notifier, marchRow('m-1', new Date(1000)));
  push(notifier, marchRow('m-1', new Date(3000)));
  assert.equal(sink.length, 2);
});
