// OAuth state 与一次性登录码（api/src/oauth-store.ts）的单元测试（AISLG-128）：
// 覆盖一次性（重复使用被拒）、过期、篡改（不存在的值）、bind 记账号、sweep 清理。

import test from 'node:test';
import assert from 'node:assert/strict';
import { OneTimeCodeStore, OauthStateStore, OAUTH_CODE_TTL_MS, OAUTH_STATE_TTL_MS } from '../api/src/oauth-store';

test('state 一次性：take 成功即消耗，再用拿到 null（防回调重放 / 参数篡改）', () => {
  const store = new OauthStateStore(OAUTH_STATE_TTL_MS, () => 'state-abc');
  store.create('login', null, 0);
  const first = store.take('state-abc', 1000);
  assert.ok(first);
  assert.equal(first.purpose, 'login');
  assert.equal(first.accountId, null);
  assert.equal(store.take('state-abc', 1001), null, '同一个 state 第二次用无效');
  assert.equal(store.take('tampered-value', 1002), null, '不存在的 state（篡改）无效');
});

test('state 10 分钟有效：到期前可用、到期后按无效处理', () => {
  const store = new OauthStateStore();
  const entry = store.create('login', null, 0);
  assert.ok(store.take(entry.state, OAUTH_STATE_TTL_MS - 1), '到期前一毫秒仍有效');
  const expired = new OauthStateStore();
  const e2 = expired.create('login', null, 0);
  assert.equal(expired.take(e2.state, OAUTH_STATE_TTL_MS), null, '刚到有效期即无效');
  assert.equal(expired.size, 0, '过期的 state 被顺手清理');
});

test('bind 的 state 记下发起账号；login 的 accountId 为 null', () => {
  const store = new OauthStateStore();
  const bind = store.create('bind', 'account-1', 0);
  const login = store.create('login', null, 0);
  assert.equal(store.take(bind.state, 1)?.accountId, 'account-1');
  assert.equal(store.take(login.state, 1)?.accountId, null);
});

test('state 同账号可并存多个（玩家开了多个标签页）', () => {
  const store = new OauthStateStore();
  const a = store.create('bind', 'account-1', 0);
  const b = store.create('bind', 'account-1', 0);
  assert.notEqual(a.state, b.state);
  assert.equal(store.size, 2);
  assert.ok(store.take(a.state, 1));
  assert.ok(store.take(b.state, 1));
});

test('state sweep：只清过期条目', () => {
  const store = new OauthStateStore();
  const fresh = store.create('login', null, 5000);
  store.create('login', null, 0);
  store.sweep(OAUTH_STATE_TTL_MS);
  assert.equal(store.size, 1);
  assert.ok(store.take(fresh.state, OAUTH_STATE_TTL_MS + 1));
});

test('一次性登录码：60 秒有效、只能用一次、过期为 null', () => {
  const store = new OneTimeCodeStore(OAUTH_CODE_TTL_MS, () => 'code-xyz');
  store.create({ accountId: 'a1', username: 'gh_8f3k2a', created: true }, 0);
  const first = store.take('code-xyz', OAUTH_CODE_TTL_MS - 1);
  assert.deepEqual(first, { accountId: 'a1', username: 'gh_8f3k2a', created: true });
  assert.equal(store.take('code-xyz', OAUTH_CODE_TTL_MS - 1), null, '用过一次即失效');

  const other = new OneTimeCodeStore();
  const code = other.create({ accountId: 'a2', username: 'pw_x', created: false }, 0);
  assert.equal(other.take(code, OAUTH_CODE_TTL_MS), null, '刚到 60 秒即过期');
  assert.equal(other.take(code, OAUTH_CODE_TTL_MS + 1), null, '过期后也拿不回（已删）');
  assert.equal(other.take('not-a-code', 1), null, '篡改 / 不存在的码无效');
});

test('一次性登录码 sweep：只清过期条目', () => {
  const store = new OneTimeCodeStore();
  const fresh = store.create({ accountId: 'a1', username: 'u', created: false }, 10_000);
  store.create({ accountId: 'a2', username: 'v', created: false }, 0);
  store.sweep(OAUTH_CODE_TTL_MS);
  assert.equal(store.size, 1);
  assert.ok(store.take(fresh, 10_000 + OAUTH_CODE_TTL_MS - 1), '未过期的仍在');
});
