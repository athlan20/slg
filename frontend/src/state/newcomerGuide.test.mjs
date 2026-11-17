// 新手接入弹窗判断逻辑的单元测试（AISLG-267，纯函数 / 不连库、不连网）。
// Node 原生去除类型直接跑 .ts（见 package.json 的 test 脚本 src/state/*.test.mjs）；
// localStorage 用内存桩模拟，另有一份会抛错的桩。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendNewcomerPromptTail,
  hasEverConnectedAgent,
  isNewAccount,
  NEWCOMER_WINDOW_DAYS,
  newcomerGuideOptOutKey,
  readNewcomerGuideOptOut,
  shouldAutoOpenGuide,
  writeNewcomerGuideOptOut,
} from './newcomerGuide.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
/** 固定「当前时间」，避免测试依赖真实时钟 */
const NOW = Date.parse('2025-01-08T00:00:00.000Z');

/** 没接过 Agent 的最小快照 */
function neverConnected(accountCreatedAt) {
  return { accountCreatedAt, agentOnline: false, plan: null, recentEvents: [] };
}

/** 内存版 localStorage 桩 */
function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    key: (index) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
  };
}

/** 隐私模式 / 存储被禁用：读写都抛错 */
const throwingStorage = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

function withStorage(storage) {
  globalThis.window = { localStorage: storage };
}

test('新号判定：7 天内算新号，超过 7 天不算', () => {
  const created = new Date(NOW - 3 * DAY_MS).toISOString();
  assert.equal(isNewAccount(created, NOW), true, '3 天前创建');
  const boundary = new Date(NOW - NEWCOMER_WINDOW_DAYS * DAY_MS).toISOString();
  assert.equal(isNewAccount(boundary, NOW), true, '正好 7 天（边界内）');
  const older = new Date(NOW - (NEWCOMER_WINDOW_DAYS * DAY_MS + 1000)).toISOString();
  assert.equal(isNewAccount(older, NOW), false, '超过 7 天');
  const future = new Date(NOW + DAY_MS).toISOString();
  assert.equal(isNewAccount(future, NOW), true, '客户端时钟偏差导致创建时间在未来');
});

test('新号判定：旧服务端没有 accountCreatedAt / 值非法时退化成不拦新号条件', () => {
  assert.equal(isNewAccount(undefined, NOW), true, '字段缺失');
  assert.equal(isNewAccount(null, NOW), true, 'null');
  assert.equal(isNewAccount('', NOW), true, '空串');
  assert.equal(isNewAccount('not-a-date', NOW), true, '解析不了');
});

test('接没接过 Agent：在线 / 上报过计划 / 有 Agent 事件任一条即算接过', () => {
  assert.equal(hasEverConnectedAgent(null), false, '还没拿到 Agent 信息');
  assert.equal(hasEverConnectedAgent(neverConnected('2025-01-07T00:00:00.000Z')), false, '干净的新号');
  assert.equal(hasEverConnectedAgent({ ...neverConnected(null), agentOnline: true }), true, '当前在线');
  assert.equal(
    hasEverConnectedAgent({ ...neverConnected(null), plan: { nextAction: '征兵', overallPlan: null, updatedAt: 'x' } }),
    true,
    '上报过计划',
  );
  assert.equal(hasEverConnectedAgent({ ...neverConnected(null), plan: undefined }), false, '旧服务端没给 plan 字段');
  assert.equal(
    hasEverConnectedAgent({ ...neverConnected(null), recentEvents: [{ type: 'agent_connected' }] }),
    true,
    '有 Agent 发起的事件',
  );
});

test('自动弹的条件：新号且没接过 Agent 才弹', () => {
  const fresh = new Date(NOW - DAY_MS).toISOString();
  const old = new Date(NOW - 30 * DAY_MS).toISOString();
  assert.equal(shouldAutoOpenGuide(neverConnected(fresh), NOW), true, '新号 + 没接过');
  assert.equal(shouldAutoOpenGuide(neverConnected(old), NOW), false, '老号不弹');
  assert.equal(shouldAutoOpenGuide({ ...neverConnected(fresh), agentOnline: true }, NOW), false, '已接过 Agent 不弹');
  assert.equal(shouldAutoOpenGuide({ ...neverConnected(old), agentOnline: true }, NOW), false, '老号 + 已接过');
  assert.equal(shouldAutoOpenGuide(null, NOW), false, '还没有 Agent 信息时先不弹');
});

test('没有 accountCreatedAt（旧服务端）：只按没接过 Agent 判断，不报错', () => {
  assert.equal(shouldAutoOpenGuide(neverConnected(undefined), NOW), true, '没接过就弹');
  assert.equal(
    shouldAutoOpenGuide({ ...neverConnected(undefined), recentEvents: [{ type: 'build_started' }] }, NOW),
    false,
    '接过就不弹',
  );
});

test('「不再提示」：键里带账号 id，按账号分别记，读写出错不抛', () => {
  withStorage(memoryStorage());
  assert.equal(newcomerGuideOptOutKey('acc-1'), 'slg.newcomer.guide.optout.acc-1');
  assert.equal(readNewcomerGuideOptOut('acc-1'), false, '首次没有记录');
  assert.equal(readNewcomerGuideOptOut(null), false, '未登录');
  writeNewcomerGuideOptOut('acc-1');
  assert.equal(readNewcomerGuideOptOut('acc-1'), true, '记下后永久不再弹');
  assert.equal(readNewcomerGuideOptOut('acc-2'), false, '另一个账号互不影响');
  writeNewcomerGuideOptOut(null);
  assert.equal(readNewcomerGuideOptOut('acc-2'), false, '未登录不写');

  withStorage(throwingStorage);
  assert.equal(readNewcomerGuideOptOut('acc-1'), false, '读失败当没记过');
  assert.doesNotThrow(() => writeNewcomerGuideOptOut('acc-1'), '写失败不抛');
  delete globalThis.window;
  assert.equal(readNewcomerGuideOptOut('acc-1'), false, '没有 localStorage 也不崩');
  assert.doesNotThrow(() => writeNewcomerGuideOptOut('acc-1'));
});

test('提示词末尾追加：原提示词原样保留，末尾多一行', () => {
  const base = '第一行\n第二行\n令牌：abc';
  const tail = '接入后，我问你游戏规则或玩法时，请以接入文档为准回答，不要凭印象。';
  const prompt = appendNewcomerPromptTail(base, tail);
  assert.equal(prompt, `${base}\n${tail}`);
  assert.equal(prompt.startsWith(base), true, '原提示词一字不改');
  assert.equal(prompt.endsWith(tail), true, '末尾是追加的那行');
  assert.equal(prompt.split('\n').length, 4, '只多一行');
  assert.equal(appendNewcomerPromptTail(`${base}\n\n`, tail), `${base}\n${tail}`, '原提示词末尾的空行去掉');
  assert.equal(appendNewcomerPromptTail('', tail), `\n${tail}`, '空提示词也不报错');
});