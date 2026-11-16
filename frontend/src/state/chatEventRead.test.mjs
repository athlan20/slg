// 「活动」页签的已读位置（v112，AISLG-260）与播报分类镜像的单元测试（纯函数 / 不连库、不连网）。
// Node 原生去除类型直接跑 .ts（见 package.json 的 test 脚本）；localStorage 用内存桩模拟，另有一份会抛错的桩。

import test from 'node:test';
import assert from 'node:assert/strict';
import { hasUnseenEvent, readEventSeenId, writeEventSeenId } from './chatEventRead.ts';
import { serverBroadcastCategory, SERVER_BROADCAST_EVENT_TYPES } from '../api/protocol-server.ts';

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

test('已读位置：首次 / 无记录 / 非法值 / 存储不可用都视为全部已读', () => {
  withStorage(memoryStorage());
  assert.equal(readEventSeenId(null), null, '未登录');
  assert.equal(readEventSeenId('acc-1'), null, '首次登录没有记录');
  writeEventSeenId('acc-1', 0);
  writeEventSeenId('acc-1', -5);
  writeEventSeenId('acc-1', Number.NaN);
  assert.equal(readEventSeenId('acc-1'), null, '非法 id 不写');
  globalThis.window.localStorage.setItem('slg.chat.event.seen.acc-1', 'oops');
  assert.equal(readEventSeenId('acc-1'), null, '存的不是数字');
  writeEventSeenId(null, 12);
  assert.equal(readEventSeenId('acc-1'), null, '未登录不写');
});

test('已读位置：按账号分别记；读写出错不抛', () => {
  withStorage(memoryStorage());
  writeEventSeenId('acc-1', 42);
  writeEventSeenId('acc-2', 7);
  assert.equal(readEventSeenId('acc-1'), 42);
  assert.equal(readEventSeenId('acc-2'), 7, '两个账号互不影响');
  writeEventSeenId('acc-1', 43.9);
  assert.equal(readEventSeenId('acc-1'), 43, 'id 取整');

  withStorage(throwingStorage);
  assert.equal(readEventSeenId('acc-1'), null, '读失败按全部已读');
  assert.doesNotThrow(() => writeEventSeenId('acc-1', 99), '写失败不抛');
  delete globalThis.window;
  assert.equal(readEventSeenId('acc-1'), null, '没有 localStorage 也不崩');
});

test('未读判定：没有记录视为已读，只有更新的 id 才亮红点', () => {
  assert.equal(hasUnseenEvent(null, 100), false, '首次登录一片红点是错误的');
  assert.equal(hasUnseenEvent(100, null), false, '还没有播报');
  assert.equal(hasUnseenEvent(null, null), false);
  assert.equal(hasUnseenEvent(100, 100), false, '看过最新一条');
  assert.equal(hasUnseenEvent(100, 99), false, '旧记录不算新消息');
  assert.equal(hasUnseenEvent(100, 101), true, '来了一条更新的');
});

test('播报分类镜像与后端清单一致：活动类 -> event，其余 -> war', () => {
  for (const type of SERVER_BROADCAST_EVENT_TYPES) {
    assert.equal(serverBroadcastCategory(type), 'event', `${type} 应归活动页签`);
  }
  for (const type of ['npc_city_emptied', 'win_streak', 'hero_granted', 'announcement', 'legendary_relic_claimed']) {
    assert.equal(serverBroadcastCategory(type), 'war', `${type} 应留在系统播报`);
  }
  assert.equal(serverBroadcastCategory('unknown_type'), 'war', '未知类型按 war 兜底');
});