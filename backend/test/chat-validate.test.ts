// 聊天参数校验（v51，AISLG-138）的单元测试：文字长度、卡片形状、表情白名单、协议号与文档隐藏规则。
// 不需要数据库。

import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_EMOJIS, CHAT_TEXT_MAX_CHARS, isChatEmoji } from '../common/src/protocol-chat';
import { Op, ErrorCode } from '../common/src/protocol';
import { OP_DOC } from '../common/src/protocol-doc-ops';
import { AGENT_HIDDEN_ERROR_CODES, AGENT_HIDDEN_OPS } from '../common/src/protocol-doc-ops-chat';
import { renderAgentApiMarkdown, buildAgentApiManifest } from '../common/src/protocol-doc-render';
import { isUuid, normalizeChatText, readCardRequest, readChannel } from '../api/src/chat-validate';

const UUID = '4f0c1a2e-8d3b-4c5e-9a7f-1b2c3d4e5f60';

test('文字：去首尾空白；空白串与超过 100 码点的文字返回 null', () => {
  assert.equal(normalizeChatText('  你好  '), '你好');
  assert.equal(normalizeChatText('   '), null);
  assert.equal(normalizeChatText('a'.repeat(CHAT_TEXT_MAX_CHARS)), 'a'.repeat(CHAT_TEXT_MAX_CHARS));
  assert.equal(normalizeChatText('a'.repeat(CHAT_TEXT_MAX_CHARS + 1)), null);
});

test('文字长度按码点计：100 个 emoji 合法，101 个不合法', () => {
  assert.notEqual(normalizeChatText('😀'.repeat(CHAT_TEXT_MAX_CHARS)), null);
  assert.equal(normalizeChatText('😀'.repeat(CHAT_TEXT_MAX_CHARS + 1)), null);
});

test('表情：只接受内置表情表中的字符', () => {
  assert.ok(CHAT_EMOJIS.length >= 20);
  assert.equal(isChatEmoji(CHAT_EMOJIS[0]), true);
  assert.equal(isChatEmoji('🦄'), false);
  assert.equal(isChatEmoji(42), false);
});

test('频道：只认 world 与 private', () => {
  assert.equal(readChannel('world'), 'world');
  assert.equal(readChannel('private'), 'private');
  assert.equal(readChannel('global'), null);
  assert.equal(readChannel(undefined), null);
});

test('卡片：坐标必须是整数，id 必须是 UUID 或正整数战报号', () => {
  assert.deepEqual(readCardRequest({ kind: 'coord', x: 3, y: 4 }), { kind: 'coord', x: 3, y: 4 });
  assert.equal(readCardRequest({ kind: 'coord', x: 3.5, y: 4 }), null);
  assert.deepEqual(readCardRequest({ kind: 'hero', heroId: UUID }), { kind: 'hero', heroId: UUID });
  assert.equal(readCardRequest({ kind: 'hero', heroId: 'not-a-uuid' }), null);
  assert.deepEqual(readCardRequest({ kind: 'report', reportId: 17 }), { kind: 'report', reportId: 17 });
  assert.equal(readCardRequest({ kind: 'report', reportId: 0 }), null);
  assert.equal(readCardRequest({ kind: 'report', reportId: '17' }), null);
  assert.deepEqual(readCardRequest({ kind: 'city', cityId: UUID }), { kind: 'city', cityId: UUID });
  assert.equal(readCardRequest({ kind: 'monster' }), null);
  assert.equal(readCardRequest(null), null);
});

test('UUID 判定：大小写均可，长度或字符不对则拒绝', () => {
  assert.equal(isUuid(UUID), true);
  assert.equal(isUuid(UUID.toUpperCase()), true);
  assert.equal(isUuid(UUID.slice(0, -1)), false);
  assert.equal(isUuid(123), false);
});

test('协议号：聊天 op 与推送号都已登记文档条目，且全部被 Agent 文档隐藏', () => {
  const chatOps = [Op.CHAT_HISTORY, Op.CHAT_SEND, Op.CHAT_CONVERSATIONS, Op.CHAT_READ, Op.CHAT_BLOCK, Op.CHAT_REPORT_DETAIL, Op.PUSH_CHAT_MESSAGE];
  assert.deepEqual(chatOps, [66, 67, 68, 69, 70, 71, 2019]);
  for (const op of chatOps) {
    assert.ok(OP_DOC[op], `OP_DOC 缺少 ${op}`);
    assert.ok(AGENT_HIDDEN_OPS.has(op), `${op} 应被 Agent 文档隐藏`);
  }
});

test('错误码：聊天专属错误码被 Agent 文档隐藏，其余错误码不受影响', () => {
  const chatCodes: ErrorCode[] = [ErrorCode.CHAT_GOVERNMENT_TOO_LOW, ErrorCode.CHAT_MUTED, ErrorCode.CHAT_BLOCKED, ErrorCode.CHAT_RATE_LIMITED];
  for (const code of chatCodes) {
    assert.ok(AGENT_HIDDEN_ERROR_CODES.has(code), `${code} 应被隐藏`);
  }
  assert.equal(AGENT_HIDDEN_ERROR_CODES.has(ErrorCode.RATE_LIMITED), false);
});

test('Agent 文档与清单不收录聊天接口，只注明「聊天仅限玩家本人」', () => {
  const markdown = renderAgentApiMarkdown();
  assert.ok(markdown.includes('聊天仅限玩家本人'));
  assert.equal(/\bCHAT_(HISTORY|SEND|CONVERSATIONS|READ|BLOCK|REPORT_DETAIL)\b/.test(markdown), false);
  assert.equal(markdown.includes('PUSH_CHAT_MESSAGE'), false);

  const manifest = buildAgentApiManifest() as { ops: Array<{ op: number }>; errorCodes: Record<string, unknown> };
  const ops = manifest.ops.map((item) => item.op);
  for (const op of AGENT_HIDDEN_OPS) {
    assert.equal(ops.includes(op), false, `清单不应包含 ${op}`);
  }
  assert.equal(Object.keys(manifest.errorCodes).some((code) => code.startsWith('CHAT_')), false);
});
