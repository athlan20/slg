// 清单与工具生成规则的单测（AISLG-131）：排除名单、参数类型映射、
// 与后端协议版本同步检查（协议变更后忘了 sync:manifest 这里会红）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { errorCodeMap, loadManifest, loadManifestMarkdown, toolOps, toolParams } from '../src/manifest.js';
import { PROTOCOL_VERSION } from '../../backend/common/src/protocol-version.js';

const manifest = loadManifest();

test('捆绑清单与后端协议版本一致（忘了 sync:manifest 时此处失败）', () => {
  assert.equal(manifest.version, PROTOCOL_VERSION);
});

test('清单可解析且含 request/push 两类 op', () => {
  assert.ok(manifest.ops.length >= 60, `op 数量异常：${manifest.ops.length}`);
  assert.ok(manifest.ops.some((op) => op.kind === 'push'));
});

test('文档副本存在且版本号一致', () => {
  const markdown = loadManifestMarkdown();
  assert.ok(markdown.includes(`协议版本：**${manifest.version}**`));
});

test('排除规则：登录流程 / 仅网页 / 仅玩家的 op 不生成工具', () => {
  const names = toolOps(manifest).map((op) => op.name);
  // 登录流程与仅网页（preAuth）：WX_* / GOOGLE_LOGIN / GITHUB_AUTH_START / OAUTH_REDEEM
  for (const banned of [
    'LOGIN',
    'LOGOUT',
    'WX_QR_CREATE',
    'WX_SCAN',
    'WX_CONFIRM',
    'WX_CANCEL',
    'GOOGLE_LOGIN',
    'GITHUB_AUTH_START',
    'OAUTH_REDEEM',
    // 仅玩家连接（Agent 调用一律 AGENT_FORBIDDEN）
    'RESET_ACCOUNT',
    'GOOGLE_BIND',
    'GET_AGENT_TOKEN',
    'RESET_AGENT_TOKEN',
  ]) {
    assert.ok(!names.includes(banned), `${banned} 不应生成工具`);
  }
});

test('排除规则：Agent 可用的核心操作都生成工具', () => {
  const names = toolOps(manifest).map((op) => op.name);
  for (const expected of ['GET_STATE', 'BUILD', 'UPGRADE', 'RECRUIT', 'MARCH', 'SCOUT', 'GET_BATTLE_REPORTS', 'AGENT_REPORT_PLAN', 'GET_LEADERBOARD', 'TRUCE', 'GET_OFFLINE_REPORT']) {
    assert.ok(names.includes(expected), `${expected} 应生成工具`);
  }
  assert.ok(names.length >= 30, `工具数量异常：${names.length}`);
});

test('参数映射：字面量联合转枚举（BUILD.kind / GET_LEADERBOARD.kind）', () => {
  const build = toolOps(manifest).find((op) => op.name === 'BUILD');
  assert.ok(build);
  const kind = toolParams(build).find((param) => param.name === 'kind');
  assert.ok(kind, 'BUILD.kind 应有参数');
  assert.equal(kind.kind, 'enum');
  assert.equal(kind.required, true);
  assert.ok(kind.options.includes('farm') && kind.options.includes('tavern'));

  const leaderboard = toolOps(manifest).find((op) => op.name === 'GET_LEADERBOARD');
  const lbKind = toolParams(leaderboard).find((param) => param.name === 'kind');
  assert.equal(lbKind?.kind, 'enum');
  assert.ok(lbKind?.options.includes('model'), 'v50 的模型榜 kind 应在枚举里');
});

test('参数映射：基础类型与非标识符伪字段', () => {
  const recruit = toolOps(manifest).find((op) => op.name === 'RECRUIT');
  const count = toolParams(recruit).find((param) => param.name === 'count');
  assert.equal(count?.kind, 'number');

  // AGENT_REPORT_PLAN 清单里的「（规则）」是纯文档行，不是参数
  const report = toolOps(manifest).find((op) => op.name === 'AGENT_REPORT_PLAN');
  const names = toolParams(report).map((param) => param.name);
  assert.ok(names.every((name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)), `出现伪字段：${names.join(',')}`);

  // MARCH.troops 是 object，宽松放行并把原始类型写进描述
  const march = toolOps(manifest).find((op) => op.name === 'MARCH');
  const troops = toolParams(march).find((param) => param.name === 'troops');
  assert.equal(troops?.kind, 'any');
});

test('错误码表可索引（工具失败时附人话解释）', () => {
  const lookup = errorCodeMap(manifest);
  assert.ok(lookup.get('INVALID_PARAMS'));
  assert.ok(lookup.get('AGENT_PASSWORD_FORBIDDEN'));
});
