// 会话令牌纯函数的单元测试（不依赖数据库）。
// 签发 / 解析 / 吊销涉及 PostgreSQL，由 scripts/smoke.ts 端到端覆盖。

import test from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_TTL_SECONDS, generateSessionToken, hashSessionToken } from '../api/src/auth';

test('生成的令牌为 43 字符 base64url 且两次不重复', () => {
  const a = generateSessionToken();
  const b = generateSessionToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
});

test('令牌哈希为 64 位十六进制且确定、可区分', () => {
  assert.match(hashSessionToken('token-x'), /^[0-9a-f]{64}$/);
  assert.equal(hashSessionToken('token-x'), hashSessionToken('token-x'));
  assert.notEqual(hashSessionToken('token-x'), hashSessionToken('token-y'));
});

test('会话默认有效期为 30 天（占位决策，调整需同步 README 与生成文档）', () => {
  assert.equal(SESSION_TTL_SECONDS, 30 * 24 * 3600);
});
