// AISLG-168 黑盒验收的共用协议工具（从 smoke-famous-elite.ts 拆出以控制单文件行数）：
// 只封装 docs/agent-api.md 的调用与等待，不含任何业务断言；数据库相关的前置造状态留在主脚本。

import { Op } from '../common/src/protocol';
import { Client, dataOf } from './smoke-client';

export interface State { city: Record<string, any>; cities: Array<Record<string, any>> }

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitUntil(label: string, timeoutMs: number, cond: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await sleep(700);
  }
  throw new Error(`等待超时：${label}`);
}

export async function state(client: Client, cityId?: string): Promise<State> {
  const res = await client.request(Op.GET_STATE, cityId ? { cityId } : {});
  if (!res.ok) throw new Error(`GET_STATE 失败：${JSON.stringify(res.error)}`);
  const data = dataOf(res);
  return { city: data.city as Record<string, any>, cities: (data.cities ?? []) as Array<Record<string, any>> };
}

export async function tile(client: Client, x: number, y: number): Promise<Record<string, any>> {
  const res = await client.request(Op.GET_TILE, { x, y });
  if (!res.ok) throw new Error(`GET_TILE 失败：${JSON.stringify(res.error)}`);
  return dataOf(res).tile as Record<string, any>;
}

/** 等一条行军（出征 + 返程）走完 */
export async function marchSettle(client: Client, cityId: string, timeoutMs = 240_000): Promise<void> {
  await sleep(1500);
  await waitUntil('行军结束', timeoutMs, async () => ((await state(client, cityId)).city.marches as unknown[]).length === 0);
}

export async function march(
  client: Client,
  cityId: string,
  x: number,
  y: number,
  troops: Record<string, number>,
  task?: string,
): Promise<Record<string, any>> {
  const res = (await client.request(Op.MARCH, task ? { cityId, x, y, troops, task } : { cityId, x, y, troops })) as unknown as Record<string, any>;
  if (!res.ok) throw new Error(`MARCH${task ? `(${task})` : ''} 失败：${JSON.stringify(res.error)}`);
  await marchSettle(client, cityId);
  return res;
}

/** 用城内现有兵力出征（排除给定兵种；避免编队超过现有兵力） */
export async function marchAll(
  client: Client,
  cityId: string,
  x: number,
  y: number,
  task: string,
  exclude: string[] = [],
): Promise<void> {
  const army = (await state(client, cityId)).city.army as Record<string, number>;
  const troops: Record<string, number> = {};
  for (const [troop, count] of Object.entries(army)) {
    if (count > 0 && !exclude.includes(troop)) troops[troop] = count;
  }
  await march(client, cityId, x, y, troops, task);
}

export async function recruit(client: Client, cityId: string, troop: string, count: number): Promise<Record<string, any>> {
  return (await client.request(Op.RECRUIT, { cityId, troop, count })) as unknown as Record<string, any>;
}

/** 等该兵种数量达到 minCount（传「现有 + N」的绝对数，避免城里已有同类兵时立即返回） */
export async function waitArmy(client: Client, cityId: string, troop: string, minCount: number, timeoutMs = 90_000): Promise<number> {
  let count = 0;
  await waitUntil(`${troop} 达到 ${minCount}`, timeoutMs, async () => {
    count = Number((await state(client, cityId)).city.army[troop] ?? 0);
    return count >= minCount;
  });
  return count;
}

export async function waitArmyPlus(
  client: Client,
  cityId: string,
  troop: string,
  before: number,
  delta: number,
  timeoutMs = 90_000,
): Promise<number> {
  let count = before;
  await waitUntil(`${troop} 从 ${before} 增加到 ${before + delta}`, timeoutMs, async () => {
    count = Number((await state(client, cityId)).city.army[troop] ?? 0);
    return count >= before + delta;
  });
  return count;
}

export function errCode(res: Record<string, any>): string {
  return String((res.error as { code?: string } | undefined)?.code ?? '(无错误码)');
}