// QA 黑盒协议层边界测试（AISLG-207 验收 4~7）：对已占领野地打 RECALL_GARRISON
// 的非法 / 边界输入，断言错误码且数据不变；最后验证他人地块返回 TILE_NOT_OCCUPIED。
// 不做全撤（会销毁 GUI 测试夹具，全撤老行为由 GUI 用例与 smoke-world 回归覆盖）。
//   npx tsx --env-file=.env scripts/qa-recall-edges.ts

import { Op } from '../common/src/protocol';
import { Client, check, dataOf } from './smoke-client';

const username = process.argv[2] ?? '';
const password = 'qa-pass-207';
const tile = { x: 986, y: 606 };

type Tile = { garrison: number; garrisonDetail: Record<string, number> };

async function garrisonOf(client: Client): Promise<Tile> {
  const detail = await client.request(Op.GET_TILE, tile);
  const t = (dataOf(detail).tile ?? {}) as Tile;
  return { garrison: t.garrison, garrisonDetail: t.garrisonDetail };
}

async function expectError(
  client: Client,
  label: string,
  troops: unknown,
  code: string,
): Promise<void> {
  const payload = troops === undefined ? {} : { troops: troops as Record<string, unknown> };
  const res = await client.request(Op.RECALL_GARRISON, { ...tile, ...payload });
  const actual = res.ok === false ? res.error?.code : JSON.stringify(dataOf(res)).slice(0, 80);
  check(res.ok === false && res.error?.code === code, `${label} → ${actual}（期望 ${code}）`);
  const after = await garrisonOf(client);
  check(after.garrison === 27, `${label} 后驻军不变（27）`);
}

async function main(): Promise<void> {
  if (!username) throw new Error('用法：qa-recall-edges <用户名>');
  const client = await Client.connect();
  const login = await client.request(Op.LOGIN, { username, password, asAgent: false });
  check(login.ok === true, `登录 ${username}`);

  const before = await garrisonOf(client);
  check(before.garrison === 27 && before.garrisonDetail.militia === 15 && before.garrisonDetail.scout === 12,
    `前置驻军 义兵15+斥候12=27（实际 ${JSON.stringify(before.garrisonDetail)}）`);

  // 验收 4：撤空（合计=驻军总数）→ GARRISON_WOULD_EMPTY
  await expectError(client, '撤空 {militia:15, scout:12}', { militia: 15, scout: 12 }, 'GARRISON_WOULD_EMPTY');
  // 单兵种请求超过该兵种自身驻军：按超量口径先拒（INSUFFICIENT_GARRISON 优先于撤空判断）
  await expectError(client, '单兵种超自身驻军 {militia:27}', { militia: 27 }, 'INSUFFICIENT_GARRISON');

  // 验收 5：超过现有驻军 → INSUFFICIENT_GARRISON
  await expectError(client, '超量 {militia:16}', { militia: 16 }, 'INSUFFICIENT_GARRISON');
  await expectError(client, '超量 {scout:13}', { scout: 13 }, 'INSUFFICIENT_GARRISON');

  // 验收 6：空对象 / 未知兵种 / 非正整数 → INVALID_PARAMS
  await expectError(client, '空对象 {}', {}, 'INVALID_PARAMS');
  await expectError(client, '未知兵种 {dragon:1}', { dragon: 1 }, 'INVALID_PARAMS');
  await expectError(client, '零 {militia:0}', { militia: 0 }, 'INVALID_PARAMS');
  await expectError(client, '负数 {militia:-1}', { militia: -1 }, 'INVALID_PARAMS');
  await expectError(client, '小数 {militia:1.5}', { militia: 1.5 }, 'INVALID_PARAMS');
  await expectError(client, '字符串 {militia:"3"}', { militia: '3' }, 'INVALID_PARAMS');

  // 验收 7：不是本账号占领的地块 → TILE_NOT_OCCUPIED（旁边的无主野地）
  const notMine = await client.request(Op.RECALL_GARRISON, { x: 987, y: 606, troops: { militia: 1 } });
  check(notMine.ok === false && notMine.error?.code === 'TILE_NOT_OCCUPIED',
    `无主地块撤回 → ${notMine.ok === false ? notMine.error?.code : '意外成功'}（期望 TILE_NOT_OCCUPIED）`);

  // 混合合法+非法字段：整个请求应被拒（不静默截断）
  await expectError(client, '合法+未知 {militia:1, dragon:2}', { militia: 1, dragon: 2 }, 'INVALID_PARAMS');

  const end = await garrisonOf(client);
  check(end.garrison === 27 && end.garrisonDetail.militia === 15 && end.garrisonDetail.scout === 12,
    '全部边界用例后驻军仍为 义兵15+斥候12=27');
  console.log('\n== 协议层边界用例全部通过 ==');
  client.close();
}

main().catch((error) => {
  console.error('边界测试失败：', error);
  process.exit(1);
});
