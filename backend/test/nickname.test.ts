// SET_NICKNAME 参数校验（v52，AISLG-142）的单元测试：昵称 trim、长度边界与非法形状。不需要数据库。

import test from 'node:test';
import assert from 'node:assert/strict';
import { NICKNAME_MAX, readNickname } from '../api/src/handlers-account';

test('昵称：去首尾空白；非字符串 / 空串 / 超长返回 null', () => {
  assert.equal(readNickname({ nickname: '  卧龙  ' }), '卧龙');
  assert.equal(readNickname({ nickname: 'g_8f3k2a' }), 'g_8f3k2a');
  // readNickname 固定读 nickname 键：缺省与非字符串都是非法
  assert.equal(readNickname(undefined), null);
  assert.equal(readNickname({}), null);
  assert.equal(readNickname({ nickname: 42 }), null);
  assert.equal(readNickname({ nickname: '   ' }), null);
  assert.equal(readNickname({ nickname: 'a'.repeat(NICKNAME_MAX) }), 'a'.repeat(NICKNAME_MAX));
  assert.equal(readNickname({ nickname: 'a'.repeat(NICKNAME_MAX + 1) }), null);
});

test('昵称长度按字符串长度计：与 LOGIN 密码分支的用户名同限（1..32）', () => {
  assert.equal(NICKNAME_MAX, 32);
  assert.equal(readNickname({ nickname: 'a' }), 'a');
  // 中英文与数字都允许（与城池改名同口径），按 JS 字符串 length 判长度
  assert.equal(readNickname({ nickname: '诸葛孔明' }), '诸葛孔明');
});
