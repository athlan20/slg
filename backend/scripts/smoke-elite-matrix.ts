// AISLG-168 黑盒验收的「数值倍率矩阵」段（从 smoke-famous-elite.ts 拆出以控制单文件行数）：
// 逐一切换承载城的名城标记，各征 1 名专属兵，与同类普通兵对照成本 ×2、人口 ×2、耗粮 ×1.5。
// 断言仍全部走协议（RECRUIT / GET_STATE），数据库只用于切换 cities.famous_name 与预置等级 / 人口。

import type pg from 'pg';

export interface EliteDef {
  troop: string;
  base: string;
  barracks: number;
}

export interface EliteMatrixDeps {
  query: (text: string, params?: unknown[]) => Promise<pg.QueryResult>;
  /** GET_STATE 的城市视图 */
  cityOf: (cityId: string) => Promise<Record<string, any>>;
  recruit: (cityId: string, troop: string, count: number) => Promise<Record<string, any>>;
  /** 等到该兵种数量达到 minCount（按「现有 +1」的绝对数传参，避免城里已有同类兵时立即返回） */
  waitArmy: (cityId: string, troop: string, minCount: number) => Promise<number>;
  verify: (label: string, ok: boolean, detail?: string) => void;
  eq: (label: string, actual: unknown, expected: unknown) => void;
}

const COST_KEYS = ['gold', 'wood', 'food', 'stone', 'iron'] as const;

export async function runEliteMatrix(
  deps: EliteMatrixDeps,
  hostCityId: string,
  eliteOf: Record<string, EliteDef>,
): Promise<void> {
  const { query, cityOf, recruit, waitArmy, verify, eq } = deps;
  const baseCosts: Record<string, Record<string, number>> = {};
  const baseFood: Record<string, number> = {};

  for (const base of ['swordsman', 'pikeman', 'archer', 'cavalry']) {
    const before = await cityOf(hostCityId);
    const res = await recruit(hostCityId, base, 1);
    verify(`对照：征募 ${base} ×1 成功`, res.ok === true, JSON.stringify((res.error as Record<string, unknown>) ?? {}));
    if (!res.ok) continue;
    const after = await cityOf(hostCityId);
    baseCosts[base] = Object.fromEntries(COST_KEYS.map((k) => [k, Number(before.resources[k]) - Number(after.resources[k])]));
    await waitArmy(hostCityId, base, Number(before.army[base] ?? 0) + 1);
    baseFood[base] = Number((await cityOf(hostCityId)).armyFoodUsePerHour) - Number(before.armyFoodUsePerHour);
    console.log(`  · ${base}：成本 ${JSON.stringify(baseCosts[base])}，耗粮 +${baseFood[base]}/h`);
  }

  for (const [name, def] of Object.entries(eliteOf)) {
    await query(`UPDATE cities SET famous_name=$2 WHERE id=$1`, [hostCityId, name]);
    const before = await cityOf(hostCityId);
    eq(`承载城 famousName = ${name}`, before.famousName, name);
    const res = await recruit(hostCityId, def.troop, 1);
    verify(`${name}：本城可征募 ${def.troop}`, res.ok === true, JSON.stringify((res.error as Record<string, unknown>) ?? {}));
    if (!res.ok) continue;
    const after = await cityOf(hostCityId);
    const cost = Object.fromEntries(COST_KEYS.map((k) => [k, Number(before.resources[k]) - Number(after.resources[k])]));
    const pop = Number(before.population.current) - Number(after.population.current);
    const stableKeys = COST_KEYS.filter((k) => k !== 'food');
    eq(`${name}：成本 = 同类普通兵（${def.base}）× 2（金木石铁）`, stableKeys.map((k) => cost[k]), stableKeys.map((k) => baseCosts[def.base][k] * 2));
    verify(
      `${name}：成本（粮）同样 × 2，容 ±2 结算噪声`,
      Math.abs(cost.food - baseCosts[def.base].food * 2) <= 2,
      `${cost.food} vs ${baseCosts[def.base].food * 2}`,
    );
    eq(`${name}：占用人口 = ${def.base} × 2`, pop, 2);
    await waitArmy(hostCityId, def.troop, Number(before.army[def.troop] ?? 0) + 1);
    const food = Number((await cityOf(hostCityId)).armyFoodUsePerHour) - Number(before.armyFoodUsePerHour);
    verify(
      `${name}：耗粮 = ${def.base} × 1.5`,
      Math.abs(food - baseFood[def.base] * 1.5) <= 1,
      `${def.base} ${baseFood[def.base]} → ${def.troop} ${food}`,
    );
  }
}