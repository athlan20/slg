import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../api/src/password';

test('哈希后可用原密码验证通过', async () => {
  const stored = await hashPassword('correct horse battery staple');
  assert.match(stored, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.equal(await verifyPassword('correct horse battery staple', stored), true);
});

test('错误密码验证失败', async () => {
  const stored = await hashPassword('correct horse battery staple');
  assert.equal(await verifyPassword('wrong password', stored), false);
});

test('相同密码两次哈希产生不同盐', async () => {
  const a = await hashPassword('same-password');
  const b = await hashPassword('same-password');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('same-password', a), true);
  assert.equal(await verifyPassword('same-password', b), true);
});

test('存储值损坏时验证失败而不抛异常', async () => {
  assert.equal(await verifyPassword('whatever', ''), false);
  assert.equal(await verifyPassword('whatever', 'plaintext'), false);
  assert.equal(await verifyPassword('whatever', 'scrypt$1$2$3'), false);
  assert.equal(await verifyPassword('whatever', 'scrypt$abc$def$ghi$xxx$yyy'), false);
});

test('Unicode 正规化形式差异不影响验证（两侧统一 NFKC）', async () => {
  const stored = await hashPassword('pass\u00e9 word'); // é 单字符
  assert.equal(await verifyPassword('passe\u0301 word', stored), true); // e + 组合字符
});
