// API 侧的赛季通知处理（AISLG-134，docs/season-system.md §2.5 / §4）：season_* 推送 PUSH_SEASON 给全部在线连接，
// season_started 之后断开已登录连接（1012），维护态通知只使缓存失效，无关通知不处理。不需要数据库。
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type pg from 'pg';
import { Op } from '../common/src/protocol';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleSeasonNotice } from '../api/src/notify-season';

/** 不会真正访问数据库的连接池桩（refreshTimeScale 失败会被吞掉） */
const stubPool = { query: () => Promise.reject(new Error('no db in unit test')) } as unknown as pg.Pool;

function fakeConn(registry: ConnectionRegistry, accountId: string) {
  const sent: Array<{ op: number; data: Record<string, unknown> }> = [];
  const closes: Array<{ code: number; reason: string }> = [];
  const socket = {
    readyState: 1,
    OPEN: 1,
    send: (raw: string) => sent.push(JSON.parse(raw)),
    close: (code: number, reason: string) => closes.push({ code, reason }),
  };
  const conn: ConnInfo = { socket: socket as never, ip: null, host: null, accountId: null, username: null, role: 'player', sessionId: null, connectedAt: new Date() };
  registry.add(conn);
  registry.bind(conn, accountId);
  return { sent, closes };
}

describe('赛季通知的 API 侧处理（无数据库）', () => {
  test('season_warning：PUSH_SEASON(phase=warning) 推给全部在线连接，携带预告阶段', () => {
    const registry = new ConnectionRegistry();
    const a = fakeConn(registry, '11111111-1111-4111-8111-111111111111');
    const b = fakeConn(registry, '22222222-2222-4222-8222-222222222222');
    const handled = handleSeasonNotice(
      { reason: 'season_warning', data: { seasonId: 1, endsAt: '2026-10-25T00:00:00.000Z', remainingSec: 3600, stage: 'T-1h' } },
      registry,
      stubPool,
    );
    assert.equal(handled, true);
    for (const conn of [a, b]) {
      assert.equal(conn.sent.length, 1);
      assert.equal(conn.sent[0].op, Op.PUSH_SEASON);
      assert.equal(conn.sent[0].data.phase, 'warning');
      assert.equal(conn.sent[0].data.stage, 'T-1h');
      assert.equal(conn.closes.length, 0, '预告不断开连接');
    }
  });

  test('season_started：推送 phase=started 后断开全部已登录连接（1012）', () => {
    const registry = new ConnectionRegistry();
    const a = fakeConn(registry, '11111111-1111-4111-8111-111111111111');
    assert.equal(handleSeasonNotice({ reason: 'season_started', data: { seasonId: 2, endsAt: 'x', remainingSec: 1 } }, registry, stubPool), true);
    assert.equal(a.sent[0].data.phase, 'started');
    assert.deepEqual(a.closes, [{ code: 1012, reason: 'season_started' }]);
  });

  test('season_resetting 只推送，不断开', () => {
    const registry = new ConnectionRegistry();
    const a = fakeConn(registry, '11111111-1111-4111-8111-111111111111');
    handleSeasonNotice({ reason: 'season_resetting', data: { seasonId: 1, endsAt: 'x', remainingSec: 0 } }, registry, stubPool);
    assert.equal(a.sent[0].data.phase, 'resetting');
    assert.equal(a.closes.length, 0);
  });

  test('维护态通知不推送、不计入 PUSH；无关通知返回 false 交给其他分支', () => {
    const registry = new ConnectionRegistry();
    const a = fakeConn(registry, '11111111-1111-4111-8111-111111111111');
    assert.equal(handleSeasonNotice({ reason: 'maintenance_on' }, registry, stubPool), true);
    assert.equal(handleSeasonNotice({ reason: 'maintenance_off' }, registry, stubPool), true);
    assert.equal(a.sent.length, 0);
    assert.equal(handleSeasonNotice({ reason: 'build_completed', buildId: 'x' }, registry, stubPool), false);
  });
});
