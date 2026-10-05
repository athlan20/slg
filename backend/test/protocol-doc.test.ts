// 协议文档清单的完整性校验：
// - OP_DOC 覆盖全部协议号（类型系统在编译期强制，这里兜底运行时数据）；
// - 示例帧的 op 号与所属协议一致，错误码合法；
// - 错误示例文案与 api/src/frames.ts 的实际响应文案一致（防止文档说谎）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { ErrorCode, Op, PROTOCOL_VERSION, type ErrorCode as ErrorCodeType } from '../common/src/protocol';
import { ERROR_MESSAGES } from '../api/src/frames';
import { OP_DOC } from '../common/src/protocol-doc-ops';
import { ERROR_DOC, FRAME_EXAMPLES, type OpDoc, type RequestOpDoc } from '../common/src/protocol-doc';
import { WALKTHROUGH } from '../common/src/protocol-doc-walkthrough';

const OP_DOC_BY_NUMBER = OP_DOC as Record<number, OpDoc>;

const VALID_OPS = new Set<number>(Object.values(Op));
const VALID_ERROR_CODES = new Set<string>(Object.values(ErrorCode));

function assertValidErrorCode(code: unknown, where: string): void {
  assert.ok(typeof code === 'string' && VALID_ERROR_CODES.has(code), `${where} 的错误码 ${String(code)} 不在 ErrorCode 中`);
}

test('PROTOCOL_VERSION 为正整数', () => {
  assert.ok(Number.isInteger(PROTOCOL_VERSION) && PROTOCOL_VERSION >= 1);
});

test('OP_DOC 覆盖全部协议号', () => {
  for (const op of VALID_OPS) {
    assert.ok(OP_DOC_BY_NUMBER[op], `协议号 ${op} 缺少文档`);
  }
  assert.equal(Object.keys(OP_DOC).length, VALID_OPS.size, 'OP_DOC 存在多余条目');
});

test('请求型协议的示例帧 op 号与自身一致，错误码合法', () => {
  for (const [key, doc] of Object.entries(OP_DOC)) {
    const op = Number(key);
    if (doc.kind !== 'request') {
      continue;
    }
    for (const group of doc.examples) {
      assert.equal(group.request.op, op, `${doc.name} 请求示例的 op 应为 ${op}，实际 ${group.request.op}`);
      for (const response of group.responses) {
        assert.equal(response.op, op, `${doc.name} 响应示例的 op 应为 ${op}`);
        if (!response.ok) {
          assertValidErrorCode(response.error?.code, `${doc.name} 响应示例`);
        }
      }
    }
    for (const code of doc.errors) {
      assertValidErrorCode(code, `${doc.name} 错误列表`);
    }
  }
});

test('推送型协议的示例帧 op 号与自身一致', () => {
  for (const [key, doc] of Object.entries(OP_DOC)) {
    const op = Number(key);
    if (doc.kind !== 'push') {
      continue;
    }
    for (const frame of doc.examples) {
      assert.equal(frame.op, op, `${doc.name} 推送示例的 op 应为 ${op}`);
    }
  }
});

test('错误示例文案与服务端实际文案一致', () => {
  const checkMessage = (frame: { ok: boolean; error?: { code: ErrorCodeType; message: string } }, where: string): void => {
    if (!frame.ok && frame.error) {
      assert.equal(frame.error.message, ERROR_MESSAGES[frame.error.code], `${where} 的错误文案与服务端不一致`);
    }
  };
  for (const doc of Object.values(OP_DOC)) {
    if (doc.kind === 'request') {
      for (const group of doc.examples) {
        group.responses.forEach((response, i) =>
          checkMessage(response, `${doc.name}「${group.caption ?? '示例'}」响应 ${i + 1}`),
        );
      }
    }
  }
  checkMessage(FRAME_EXAMPLES.responseError, '通用帧示例');
  for (const step of WALKTHROUGH) {
    for (const item of step.frames) {
      if (item.kind === 'response') {
        checkMessage(item.frame as { ok: boolean; error?: { code: ErrorCodeType; message: string } }, `示例会话「${step.title}」`);
      }
    }
  }
});

test('示例会话中的帧只引用已定义的协议号', () => {
  for (const step of WALKTHROUGH) {
    for (const item of step.frames) {
      const op = (item.frame as { op: number }).op;
      assert.ok(VALID_OPS.has(op), `示例会话「${step.title}」出现未定义的协议号 ${op}`);
    }
  }
});

test('错误码文档覆盖全部 ErrorCode 且无多余条目', () => {
  assert.deepEqual(Object.keys(ERROR_DOC).sort(), [...VALID_ERROR_CODES].sort());
});

// 登录前即可发送的协议：LOGIN、微信扫码登录一组（v43；WX_QR_CREATE 的 bind 用途在处理器内要求已登录）与 Google 登录（v44）
const PRE_AUTH_DOC_NAMES = new Set(['LOGIN', 'WX_QR_CREATE', 'WX_SCAN', 'WX_CONFIRM', 'WX_CANCEL', 'GOOGLE_LOGIN', 'GITHUB_AUTH_START', 'OAUTH_REDEEM']);

test('每个请求型协议都标注 preAuth，且只有 LOGIN、微信扫码与 Google / GitHub 登录协议允许登录前发送', () => {
  for (const doc of Object.values(OP_DOC)) {
    if (doc.kind !== 'request') {
      continue;
    }
    const typed = doc as RequestOpDoc;
    assert.equal(typed.preAuth, PRE_AUTH_DOC_NAMES.has(typed.name), `${typed.name} 的 preAuth 标注不正确`);
  }
});
