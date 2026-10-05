// 请求级城池作用域（v24，AISLG-58）：并发请求各自独立、await 之后仍能读到

import assert from 'node:assert/strict';
import test from 'node:test';
import { CITY_SCOPED_OPS, currentCityId, runWithCity } from '../api/src/city-scope';
import { Op } from '../common/src/protocol';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('未进入作用域时 cityId 缺省（主城）', () => {
  assert.equal(currentCityId(), undefined);
});

test('并发请求各自的 cityId 不串，跨 await 仍可读', async () => {
  const seen: Record<string, Array<string | undefined>> = { a: [], b: [], main: [] };
  const run = (key: string, cityId: string | undefined, delay: number) =>
    runWithCity(cityId, async () => {
      seen[key].push(currentCityId());
      await sleep(delay);
      seen[key].push(currentCityId());
      await Promise.resolve();
      seen[key].push(currentCityId());
    });
  await Promise.all([run('a', 'city-a', 10), run('b', 'city-b', 2), run('main', undefined, 5)]);
  assert.deepEqual(seen.a, ['city-a', 'city-a', 'city-a']);
  assert.deepEqual(seen.b, ['city-b', 'city-b', 'city-b']);
  assert.deepEqual(seen.main, [undefined, undefined, undefined]);
});

test('支持 cityId 的协议：城池类建造 / 征兵 / 出征 / 侦察 / 兑换 / 状态 / 改名；取消类与账号类不在其内', () => {
  for (const op of [Op.GET_STATE, Op.BUILD, Op.UPGRADE, Op.RENAME_CITY, Op.RECRUIT, Op.MARCH, Op.SCOUT, Op.EXCHANGE]) {
    assert.ok(CITY_SCOPED_OPS.has(op), `op ${op} 应支持 cityId`);
  }
  for (const op of [Op.CANCEL_BUILD, Op.CANCEL_RECRUIT, Op.RESET_ACCOUNT, Op.GET_EVENTS, Op.RECALL_GARRISON]) {
    assert.ok(!CITY_SCOPED_OPS.has(op), `op ${op} 不应按 cityId 作用域`);
  }
});
