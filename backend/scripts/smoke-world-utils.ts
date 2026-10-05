// 世界冒烟（smoke-world.ts）的共用工具：窗口 / 野地查找 / 军营征兵准备 /
// 行军结果轮询。从主脚本拆出以控制单文件行数；断言与客户端能力见 smoke-client.ts。

import { Op, type TerrainKind } from '../common/src/protocol';
import { Client, check, dataOf } from './smoke-client';

/** 轮询断言的通用等待 */
const POLL_MS = 500;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntil(label: string, timeoutMs: number, cond: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) {
      console.log(`  ✓ ${label}`);
      return;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`等待超时：${label}`);
}

export interface TileLite {
  x: number;
  y: number;
  terrain: TerrainKind;
  kind: string;
  level: number;
  owner: unknown;
}

export async function fetchWindow(client: Client, x?: number, y?: number): Promise<{ size: number; tiles: TileLite[] }> {
  const res = await client.request(Op.GET_WORLD_MAP, x === undefined ? {} : { x, y });
  check(res.ok === true, `地图窗口查询成功（${x ?? '默认'}，${y ?? '默认'}）`);
  const data = dataOf(res) as unknown as { size: number; tiles: TileLite[]; x: number; y: number };
  return data;
}

/** 找一块无主的 1 级野地（在给定客户端的默认窗口内；可排除已用过的坐标——掠夺不改
 *  归属，冷却中的地块仍会出现在「无主」列表里，重复选中会撞 PLUNDER_COOLDOWN） */
export async function findFreeLevel1(client: Client, exclude: Array<{ x: number; y: number }> = []): Promise<TileLite> {
  const win = await fetchWindow(client);
  // v19：默认跳过金矿（掠夺池为空，专测另覆盖）；战利品断言按非金矿地形写
  const target = win.tiles.find(
    (tile) =>
      tile.kind === 'wilderness' &&
      tile.owner === null &&
      tile.level === 1 &&
      tile.terrain !== 'gold_mine' &&
      !exclude.some((pos) => pos.x === tile.x && pos.y === tile.y),
  );
  check(target !== undefined, '主城周边窗口内找到无主 1 级野地');
  return target as TileLite;
}

/** 军营建成并征满义兵（BUILD_SECONDS / RECRUIT_UNIT_SECONDS 由环境变量缩短；
 *  军营已建时跳过建造——同一账号可多次调用（v16 掠夺步骤复用） */
export async function prepareMilitia(client: Client, count: number): Promise<void> {
  const state = dataOf(await client.request(Op.GET_STATE)) as { city: { levels: Record<string, number> } };
  if ((state.city.levels.barracks ?? 0) <= 0) {
    const build = await client.request(Op.BUILD, { kind: 'barracks' });
    check(build.ok === true, '军营发起建造');
    await client.waitPush(Op.PUSH_BUILD_STATE, 60_000, (data) => data.reason === 'build_completed');
    console.log('  ✓ 军营建造完成');
  }
  const recruit = await client.request(Op.RECRUIT, { troop: 'militia', count });
  check(recruit.ok === true, `征募义兵 ×${count} 立即开始`);
  await client.waitPush(Op.PUSH_RECRUIT_STATE, count * 1000 + 60_000, (data) => data.reason === 'recruit_completed');
  console.log('  ✓ 征兵完成（兵力入城）');
}

/** 军营升到 Lv2 并征募斥候（侦察步骤前置；BUILD_SECONDS / RECRUIT_UNIT_SECONDS 缩短） */
export async function prepareScouts(client: Client, count: number): Promise<void> {
  const upgrade = await client.request(Op.UPGRADE, { kind: 'barracks' });
  check(upgrade.ok === true, '军营升级到 Lv2');
  await client.waitPush(Op.PUSH_BUILD_STATE, 60_000, (data) => data.reason === 'build_completed');
  console.log('  ✓ 军营升级完成（Lv2，解锁斥候）');
  const recruit = await client.request(Op.RECRUIT, { troop: 'scout', count });
  check(recruit.ok === true, `征募斥候 ×${count} 立即开始`);
  await client.waitPush(Op.PUSH_RECRUIT_STATE, count * 1000 + 60_000, (data) => data.reason === 'recruit_completed');
  console.log('  ✓ 斥候征募完成（入城）');
}

/** 等待一条 march_completed 事件出现（按 sinceId 增量拉取） */
export async function waitMarchOutcome(
  client: Client,
  sinceId: number,
  timeoutMs: number,
): Promise<{ outcome: string; detail: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await client.request(Op.GET_EVENTS, { sinceId, limit: 50 });
    if (res.ok) {
      const events = (dataOf(res).events ?? []) as Array<{ id: number; type: string; detail: Record<string, unknown> }>;
      const done = events.find((event) => event.type === 'march_completed');
      if (done) {
        return { outcome: String(done.detail.outcome), detail: done.detail };
      }
    }
    await sleep(POLL_MS);
  }
  throw new Error('等待超时：march_completed 事件');
}
