// 计谋（AISLG-211）的存取：计谋令（加锁增减）、城效果行、免疫行、武将冷却与过期清理。
// 纯规则在 common/src/stratagem.ts；施计事务在 api/src/handlers-stratagem.ts。
// 兑换与施计都在同一事务里对 account_stratagem_tokens 的行加锁（FOR UPDATE），并发不会超限或变负。

import pg from 'pg';
import { STRATAGEM_TOKEN_KINDS, type StratagemTokenKind } from './stratagem';
import type { CityStratagemView } from './protocol-stratagem';

type Queryable = pg.Pool | pg.PoolClient;

/** 免疫行的目标形态：city 城 / march 玩家行军 / npc_attack NPC 袭击 / account 玩家（蛛丝马迹） */
export type StratagemImmunityTarget = 'city' | 'march' | 'npc_attack' | 'account';

/** 4 类令的持有数（无行为 0） */
export function emptyTokens(): Record<StratagemTokenKind, number> {
  return { deception: 0, march: 0, assault: 0, intel: 0 };
}

export async function loadStratagemTokens(q: Queryable, accountId: string): Promise<Record<StratagemTokenKind, number>> {
  const res = await q.query(`SELECT kind, count FROM account_stratagem_tokens WHERE account_id = $1`, [accountId]);
  const tokens = emptyTokens();
  for (const row of res.rows as Array<{ kind: string; count: number | string }>) {
    if ((STRATAGEM_TOKEN_KINDS as readonly string[]).includes(row.kind)) {
      tokens[row.kind as StratagemTokenKind] = Math.max(0, Number(row.count));
    }
  }
  return tokens;
}

/** 加锁读一行令的持有数（无行时先建行再锁，保证并发兑换 / 施计串行）；施计 / 兑换事务内使用 */
export async function lockStratagemTokenCount(client: pg.PoolClient, accountId: string, kind: StratagemTokenKind): Promise<number> {
  // 先插入占位行：FOR UPDATE 锁不到不存在的行，两人同时兑换时都会读到旧值而超上限；
  // ON CONFLICT DO NOTHING 在并发下由唯一索引串行化（后到者在锁上等前者提交）。
  await client.query(
    `INSERT INTO account_stratagem_tokens (account_id, kind, count) VALUES ($1, $2, 0)
     ON CONFLICT (account_id, kind) DO NOTHING`,
    [accountId, kind],
  );
  const res = await client.query(
    `SELECT count FROM account_stratagem_tokens WHERE account_id = $1 AND kind = $2 FOR UPDATE`,
    [accountId, kind],
  );
  const row = res.rows[0] as { count: number | string } | undefined;
  return row ? Math.max(0, Number(row.count)) : 0;
}

/** 事务内扣 1 张令（调用方先 lockStratagemTokenCount 校验 ≥ 1 并保证持锁）；返回扣后剩余 */
export async function spendStratagemToken(client: pg.PoolClient, accountId: string, kind: StratagemTokenKind): Promise<number> {
  const res = await client.query(
    `UPDATE account_stratagem_tokens SET count = GREATEST(0, count - 1), updated_at = now()
     WHERE account_id = $1 AND kind = $2 RETURNING count`,
    [accountId, kind],
  );
  return Math.max(0, Number((res.rows[0] as { count: number | string } | undefined)?.count ?? 0));
}

/** 发 N 张令（战场商店兑换；调用方已校验持有上限并持锁） */
export async function grantStratagemToken(client: pg.PoolClient, accountId: string, kind: StratagemTokenKind, delta: number): Promise<void> {
  await client.query(
    `INSERT INTO account_stratagem_tokens (account_id, kind, count) VALUES ($1, $2, $3)
     ON CONFLICT (account_id, kind) DO UPDATE SET count = account_stratagem_tokens.count + $3, updated_at = now()`,
    [accountId, kind, Math.max(0, Math.floor(delta))],
  );
}

// ---- 城效果行（deception / loot_fire / ambush_all_sides）----

export interface CityStratagemEffectRow {
  city_id: string;
  kind: string;
  param: number;
  until: Date;
}

/** 读一座城生效中的全部效果行（until > now，过期惰性忽略） */
export async function loadActiveCityEffects(q: Queryable, cityId: string, now: Date): Promise<CityStratagemEffectRow[]> {
  const res = await q.query(
    `SELECT * FROM city_stratagem_effects WHERE city_id = $1 AND until > $2`,
    [cityId, now],
  );
  return res.rows as CityStratagemEffectRow[];
}

/** 写 / 覆盖一座城的一种效果（同城同种只有一行，新施的覆盖旧的） */
export async function upsertCityEffect(client: pg.PoolClient, cityId: string, kind: string, param: number, until: Date): Promise<void> {
  await client.query(
    `INSERT INTO city_stratagem_effects (city_id, kind, param, until) VALUES ($1, $2, $3, $4)
     ON CONFLICT (city_id, kind) DO UPDATE SET param = $3, until = $4`,
    [cityId, kind, Math.floor(param), until],
  );
}

/** 一座城的 GET_STATE 视图（deception.kind 还原成计谋名；param 对 deception 是倍数百分比、loot_fire 是降低百分比） */export function cityStratagemView(rows: readonly CityStratagemEffectRow[]): CityStratagemView {
  const view: CityStratagemView = { deception: null, ambushedUntil: null, lootFireUntil: null, lootFirePercent: 0 };
  for (const row of rows) {
    if (row.kind === 'deception') {
      const kind = deceptionKindOfParam(Number(row.param));
      view.deception = {
        kind,
        name: kind === 'phantom_army' ? '草木皆兵' : '空城计',
        multiplierPercent: Math.max(0, Number(row.param)),
        until: row.until.toISOString(),
      };
    } else if (row.kind === 'ambush_all_sides') {
      view.ambushedUntil = row.until.toISOString();
    } else if (row.kind === 'loot_fire') {
      view.lootFireUntil = row.until.toISOString();
      view.lootFirePercent = Math.max(0, Number(row.param));
    }
  }
  return view;
}

/** 欺敌倍数百分比 → 计谋名（≥100 = 草木皆兵放大；<100 = 空城计缩小） */
export function deceptionKindOfParam(param: number): 'phantom_army' | 'empty_fort' {
  return param <= 100 ? 'empty_fort' : 'phantom_army';
}

/** 生效中的欺敌效果（无 / 过期为 null）：Worker 生成侦察情报前用它换算驻军 */
export async function loadActiveDeception(
  q: Queryable,
  cityId: string,
  now: Date,
): Promise<{ kind: 'phantom_army' | 'empty_fort'; name: string; multiplierPercent: number } | null> {
  const res = await q.query(
    `SELECT param FROM city_stratagem_effects WHERE city_id = $1 AND kind = 'deception' AND until > $2`,
    [cityId, now],
  );
  const param = (res.rows[0] as { param: number } | undefined)?.param;
  if (param === undefined || param === null) {
    return null;
  }
  const kind = deceptionKindOfParam(Number(param));
  return {
    kind,
    name: kind === 'phantom_army' ? '草木皆兵' : '空城计',
    multiplierPercent: Math.max(0, Number(param)),
  };
}

/** 十面埋伏剩余秒数（未中计返回 null）：MARCH / 侦察 / 协防 / 商队 / 入场统一用它拦截 */
export async function ambushRemainingSeconds(q: Queryable, cityId: string, now: Date): Promise<number | null> {
  const res = await q.query(
    `SELECT until FROM city_stratagem_effects WHERE city_id = $1 AND kind = 'ambush_all_sides' AND until > $2`,
    [cityId, now],
  );
  const until = (res.rows[0] as { until: Date } | undefined)?.until;
  return until ? Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 1000)) : null;
}

/** 掠夺结算用：一座城生效中的趁火打劫降低百分比（无 / 过期为 0） */
export async function lootFirePercentOf(q: Queryable, cityId: string, now: Date): Promise<number> {
  const res = await q.query(
    `SELECT param FROM city_stratagem_effects WHERE city_id = $1 AND kind = 'loot_fire' AND until > $2`,
    [cityId, now],
  );
  const param = (res.rows[0] as { param: number } | undefined)?.param;
  return param ? Math.min(100, Math.max(0, Number(param))) : 0;
}

// ---- 免疫行 ----
/**
 * 施计串行化（同一目标 + 同一种计的事务互斥）：免疫判定 → 执行效果 → 写免疫行 必须在同一道锁内，
 * 否则两人同时施同一种计会双双成功。用事务级 advisory lock（不参与行锁顺序，避免与
 * Worker 的 cities → account_heroes 锁序死锁）。
 */
export async function lockStratagemTarget(client: pg.PoolClient, targetType: string, targetId: string, kind: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `stratagem:${targetType}:${targetId}:${kind}`,
  ]);
}

/** 该目标对某种计的免疫截止（不在免疫期为 null） */
export async function stratagemImmuneUntil(q: Queryable, targetType: StratagemImmunityTarget, targetId: string, kind: string, now: Date): Promise<Date | null> {
  const res = await q.query(
    `SELECT until FROM stratagem_immunity WHERE target_type = $1 AND target_id = $2 AND kind = $3 AND until > $4`,
    [targetType, targetId, kind, now],
  );
  return (res.rows[0] as { until: Date } | undefined)?.until ?? null;
}

/** 成功中计后写免疫行（覆盖旧值） */
export async function setStratagemImmunity(client: pg.PoolClient, targetType: StratagemImmunityTarget, targetId: string, kind: string, until: Date): Promise<void> {
  await client.query(
    `INSERT INTO stratagem_immunity (target_type, target_id, kind, until) VALUES ($1, $2, $3, $4)
     ON CONFLICT (target_type, target_id, kind) DO UPDATE SET until = $4`,
    [targetType, targetId, kind, until],
  );
}

// ---- 过期清理（Worker 周期调用；读取侧本来就惰性忽略，清理只为控表大小）----

export async function purgeExpiredStratagems(q: Queryable): Promise<number> {
  const effects = await q.query(`DELETE FROM city_stratagem_effects WHERE until <= now()`);
  const immunity = await q.query(`DELETE FROM stratagem_immunity WHERE until <= now()`);
  return (effects.rowCount ?? 0) + (immunity.rowCount ?? 0);
}
