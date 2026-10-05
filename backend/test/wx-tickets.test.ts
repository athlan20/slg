// 微信扫码 ticket 状态机、限频与 IP 打码的单元测试（纯内存，不依赖数据库与微信接口）。

import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConnInfo } from '../api/src/connections';
import { RateLimiter, WxTicketStore, generateTicketId, maskIp, TICKET_LENGTH } from '../api/src/wx-tickets';

function fakeConn(ip: string | null = '113.87.1.2'): ConnInfo {
  return {
    socket: { readyState: 1, OPEN: 1, send: () => undefined } as unknown as ConnInfo['socket'],
    ip,
    host: null,
    accountId: null,
    username: null,
    role: null,
    sessionId: null,
    connectedAt: new Date(),
  };
}

const TTL = 180_000;

test('ticket 为 16 位 base62 且不重复', () => {
  const a = generateTicketId();
  const b = generateTicketId();
  assert.match(a, new RegExp(`^[0-9A-Za-z]{${TICKET_LENGTH}}$`));
  assert.notEqual(a, b);
});

test('IP 打码：IPv4 保留前两段，IPv6 保留前两组，取不到为 null', () => {
  assert.equal(maskIp('113.87.20.5'), '113.87.*.*');
  assert.equal(maskIp('::ffff:10.1.2.3'), '10.1.*.*');
  assert.equal(maskIp('2409:8a55:1234::1'), '2409:8a55:*');
  assert.equal(maskIp(null), null);
  assert.equal(maskIp('unknown'), null);
});

test('正常流转：pending → scanned → 确认后 ticket 被消耗', () => {
  const store = new WxTicketStore(TTL);
  const web = fakeConn();
  const phone = fakeConn(null);
  const ticket = store.create(web, 'login', null, 1000);
  assert.equal(ticket.status, 'pending');
  assert.equal(ticket.expiresAt, 1000 + TTL);
  assert.equal(ticket.requesterIp, '113.87.1.2');

  const scanned = store.markScanned(ticket.id, phone, 'openid-1', null, 2000);
  assert.ok(scanned.ok);
  assert.equal(ticket.status, 'scanned');
  assert.equal(ticket.openid, 'openid-1');

  const taken = store.takeScanned(ticket.id, phone, 3000);
  assert.ok(taken.ok);
  assert.equal(store.size, 0);
  assert.equal(store.takeScanned(ticket.id, phone, 3001).ok, false, '一次性：重复确认无效');
});

test('已 scanned 的 ticket 被另一部手机再扫无效；未扫码的 ticket 不能确认', () => {
  const store = new WxTicketStore(TTL);
  const ticket = store.create(fakeConn(), 'login', null, 0);
  assert.equal(store.takeScanned(ticket.id, fakeConn(), 1).ok, false, 'pending 不能直接确认');
  const phoneA = fakeConn();
  assert.ok(store.markScanned(ticket.id, phoneA, 'o-a', null, 2).ok);
  assert.equal(store.markScanned(ticket.id, fakeConn(), 'o-b', null, 3).ok, false);
  assert.equal(ticket.openid, 'o-a', '第二次扫码不得覆盖 openid');
});

test('确认 / 取消只接受扫码的那条连接', () => {
  const store = new WxTicketStore(TTL);
  const web = fakeConn();
  const phone = fakeConn();
  const ticket = store.create(web, 'login', null, 0);
  store.markScanned(ticket.id, phone, 'o', null, 1);
  assert.equal(store.takeScanned(ticket.id, fakeConn(), 2).ok, false, '换连接确认');
  assert.equal(store.takeScanned(ticket.id, web, 2).ok, false, '网页连接自己确认');
  assert.ok(store.takeScanned(ticket.id, phone, 2).ok);
});

test('过期的 ticket 读不到、扫不了；sweep 返回并清理过期项', () => {
  const store = new WxTicketStore(TTL);
  const web = fakeConn();
  const ticket = store.create(web, 'login', null, 0);
  assert.equal(store.get(ticket.id, TTL - 1), ticket);
  assert.equal(store.markScanned(ticket.id, fakeConn(), 'o', null, TTL).ok, false);

  const second = store.create(fakeConn(), 'login', null, 10);
  const third = store.create(fakeConn(), 'login', null, TTL + 5);
  const expired = store.sweep(TTL + 10);
  assert.deepEqual(expired.map((t) => t.id), [second.id], '只清理已到期的（第一张已被 get 顺手删除）');
  assert.equal(store.get(third.id, TTL + 10), third);
  assert.equal(store.size, 1);
});

test('一条网页连接同时只保留一个 ticket：重新生成即作废旧的', () => {
  const store = new WxTicketStore(TTL);
  const web = fakeConn();
  const first = store.create(web, 'login', null, 0);
  const second = store.create(web, 'login', null, 1);
  assert.equal(store.get(first.id, 2), null);
  assert.equal(store.get(second.id, 2), second);
  assert.equal(store.size, 1);
});

test('网页连接断开：它的 ticket 一起作废；discard 只删指定的那张', () => {
  const store = new WxTicketStore(TTL);
  const web = fakeConn();
  const old = store.create(web, 'login', null, 0);
  const current = store.create(web, 'login', null, 1);
  store.discard(old);
  assert.equal(store.get(current.id, 2), current, 'discard 旧 ticket 不能误删新的');
  store.dropByWebConn(web);
  assert.equal(store.size, 0);
});

test('小游戏连接断开：已扫未确认的 ticket 作废并返回，供通知网页', () => {
  const store = new WxTicketStore(TTL);
  const web = fakeConn();
  const phone = fakeConn();
  const ticket = store.create(web, 'login', null, 0);
  assert.deepEqual(store.dropByScanConn(phone), [], '没扫过码的连接断开无影响');
  store.markScanned(ticket.id, phone, 'o', null, 1);
  assert.deepEqual(store.dropByScanConn(phone).map((t) => t.id), [ticket.id]);
  assert.equal(store.size, 0);
});

test('bind 的 ticket 记着发起绑定的账号', () => {
  const store = new WxTicketStore(TTL);
  const ticket = store.create(fakeConn(), 'bind', 'account-1', 0);
  assert.equal(ticket.purpose, 'bind');
  assert.equal(ticket.accountId, 'account-1');
});

test('限频：窗口内超过上限被拒，被拒不占额度，窗口滑过后恢复；不同 key 互不影响', () => {
  const limiter = new RateLimiter(3, 60_000);
  assert.ok(limiter.allow('ip-a', 0));
  assert.ok(limiter.allow('ip-a', 1000));
  assert.ok(limiter.allow('ip-a', 2000));
  assert.equal(limiter.allow('ip-a', 3000), false);
  assert.ok(limiter.allow('ip-b', 3000));
  assert.equal(limiter.allow('ip-a', 59_999), false);
  assert.ok(limiter.allow('ip-a', 60_000), '最早一次滑出窗口后放行');
  limiter.prune(1_000_000);
  assert.ok(limiter.allow('ip-a', 1_000_000));
});
