// 计谋（AISLG-211）的目标解析、PvP 保护门与出兵拦截：CAST_STRATAGEM / GET_STRATAGEMS
// 与所有「从这座城派部队」的入口（MARCH / SCOUT / 入场 / 商队）共用。
// 施计主流程在 handlers-stratagem.ts；规则与数值在 common/src/stratagem.ts。

import pg from 'pg';
import { inNewbieProtection, inTruce } from '../../common/src/protection';
import { cannotAttack } from '../../common/src/alliance-db';
import { ambushRemainingSeconds } from '../../common/src/stratagem-db';
import type { StratagemDef } from '../../common/src/stratagem';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StratagemCityRow {
  id: string;
  account_id: string;
  name: string;
  x: number | null;
  y: number | null;
}

export interface StratagemMarchRow {
  id: string;
  account_id: string;
  from_city_id: string;
  x: number;
  y: number;
  purpose: string;
  status: string;
  arrive_at: Date;
  ambush_at: Date | null;
  stratagem_used?: boolean;
}

export interface StratagemNpcAttackRow {
  id: string;
  account_id: string;
  target_city_id: string;
  x: number;
  y: number;
  target: string;
  level: number;
  arrive_at: Date;
}

export type ResolvedStratagemTarget =
  | { kind: 'own_city'; city: StratagemCityRow }
  | { kind: 'enemy_city'; city: StratagemCityRow; targetAccountId: string }
  | { kind: 'enemy_player'; city: StratagemCityRow; targetAccountId: string }
  | { kind: 'own_return_march'; march: StratagemMarchRow }
  | { kind: 'enemy_march'; march: StratagemMarchRow; targetAccountId: string }
  | { kind: 'npc_attack'; attack: StratagemNpcAttackRow }
  | { kind: 'invalid'; reason: 'INVALID_TARGET' };

async function loadCity(client: pg.PoolClient, cityId: string, lock = false): Promise<StratagemCityRow | null> {
  const res = await client.query(
    `SELECT id, account_id, name, x, y FROM cities WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [cityId],
  );
  return res.rowCount ? (res.rows[0] as StratagemCityRow) : null;
}

/** (x, y) 是不是「本账号的一座城」或「本账号占领的野地」 */
async function isOwnDestination(client: pg.PoolClient, accountId: string, x: number, y: number): Promise<boolean> {
  const res = await client.query(
    `SELECT t.owner_city_id, c.account_id
     FROM world_tiles t LEFT JOIN cities c ON c.id = t.owner_city_id
     WHERE t.x = $1 AND t.y = $2 AND t.owner_city_id IS NOT NULL`,
    [x, y],
  );
  const row = res.rows[0] as { owner_city_id: string; account_id: string | null } | undefined;
  return !!row && row.account_id === accountId;
}

/**
 * 解析并校验施计目标（只读，不改任何数据；CAST 的事务里调用）。
 * - own_city（欺敌）：必须是本账号的城；
 * - enemy_city（攻心）：必须是其他玩家的城；
 * - enemy_player（情报）：指定敌方玩家的任意一座城；
 * - own_return_march（金蝉脱壳）：本账号 status='marching' 且 purpose='return' 的返程行军，未用过；
 * - enemy_march / npc_attack（八门金锁）：开往本账号城池或野地的敌方部队（NPC 行军按 0 智力城守）。
 */
export async function resolveStratagemTarget(
  client: pg.PoolClient,
  accountId: string,
  def: StratagemDef,
  target: { cityId?: string; marchId?: string; attackId?: string },
  /** true = 行锁（CAST 的事务内用，锁序 cities → marches → 武将）；false = 只读（GET_STRATAGEMS 判定用） */
  lock = false,
): Promise<ResolvedStratagemTarget> {
  if (def.targetType === 'own_city' || def.targetType === 'enemy_city' || def.targetType === 'enemy_player') {
    if (typeof target.cityId !== 'string' || !UUID_RE.test(target.cityId)) {
      return { kind: 'invalid', reason: 'INVALID_TARGET' };
    }
    const city = await loadCity(client, target.cityId, lock);
    if (!city) {
      return { kind: 'invalid', reason: 'INVALID_TARGET' };
    }
    if (def.targetType === 'own_city') {
      return city.account_id === accountId ? { kind: 'own_city', city } : { kind: 'invalid', reason: 'INVALID_TARGET' };
    }
    if (city.account_id === accountId) {
      return { kind: 'invalid', reason: 'INVALID_TARGET' };
    }
    return def.targetType === 'enemy_city'
      ? { kind: 'enemy_city', city, targetAccountId: city.account_id }
      : { kind: 'enemy_player', city, targetAccountId: city.account_id };
  }
  if (def.targetType === 'own_return_march') {
    if (typeof target.marchId !== 'string' || !UUID_RE.test(target.marchId)) {
      return { kind: 'invalid', reason: 'INVALID_TARGET' };
    }
    const res = await client.query(`SELECT * FROM marches WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [target.marchId]);
    const march = res.rows[0] as StratagemMarchRow | undefined;
    if (!march || march.account_id !== accountId || march.status !== 'marching' || march.purpose !== 'return') {
      return { kind: 'invalid', reason: 'INVALID_TARGET' };
    }
    if (march.stratagem_used) {
      return { kind: 'invalid', reason: 'INVALID_TARGET' };
    }
    return { kind: 'own_return_march', march };
  }
  // enemy_march（八门金锁）：玩家行军或 NPC 袭击二选一
  if (typeof target.marchId === 'string' && UUID_RE.test(target.marchId)) {
    const res = await client.query(`SELECT * FROM marches WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [target.marchId]);
    const march = res.rows[0] as StratagemMarchRow | undefined;
    if (
      !march || march.account_id === accountId || march.status !== 'marching' ||
      march.purpose === 'return' || march.purpose === 'caravan'
    ) {
      return { kind: 'invalid', reason: 'INVALID_TARGET' };
    }
    if (!(await isOwnDestination(client, accountId, march.x, march.y))) {
      return { kind: 'invalid', reason: 'INVALID_TARGET' };
    }
    return { kind: 'enemy_march', march, targetAccountId: march.account_id };
  }
  if (typeof target.attackId === 'string' && UUID_RE.test(target.attackId)) {
    const res = await client.query(`SELECT * FROM npc_attacks WHERE id = $1 AND resolved_at IS NULL${lock ? ' FOR UPDATE' : ''}`, [target.attackId]);
    const attack = res.rows[0] as StratagemNpcAttackRow | undefined;
    if (!attack || !(await isOwnDestination(client, accountId, attack.x, attack.y))) {
      return { kind: 'invalid', reason: 'INVALID_TARGET' };
    }
    return { kind: 'npc_attack', attack };
  }
  return { kind: 'invalid', reason: 'INVALID_TARGET' };
}

/** 目标城城守智力（未任城守为 0）：成功率公式用 */
export async function guardWitOf(client: pg.PoolClient, cityId: string | null): Promise<number> {
  if (!cityId) {
    return 0;
  }
  const res = await client.query(
    `SELECT h.wit FROM cities c JOIN account_heroes h ON h.id = c.guard_hero_id WHERE c.id = $1`,
    [cityId],
  );
  const row = res.rows[0] as { wit: number | string } | undefined;
  return row ? Math.max(0, Number(row.wit)) : 0;
}

/** 免疫行的目标形态：城计 → city；八门金锁 → march / npc_attack；蛛丝马迹 → account（整个玩家） */
export function immunityTargetOf(resolved: ResolvedStratagemTarget): { type: 'city' | 'march' | 'npc_attack' | 'account'; id: string } | null {
  switch (resolved.kind) {
    case 'enemy_city':
    case 'own_city':
      return { type: 'city', id: resolved.city.id };
    case 'enemy_player':
      return { type: 'account', id: resolved.targetAccountId };
    case 'enemy_march':
      return { type: 'march', id: resolved.march.id };
    case 'npc_attack':
      return { type: 'npc_attack', id: resolved.attack.id };
    default:
      return null;
  }
}

/** 成功率公式里的「城守智力」：城计 = 目标城城守；八门金锁 = 行军出发城城守（NPC 按 0） */
export async function guardWitForTarget(client: pg.PoolClient, resolved: ResolvedStratagemTarget): Promise<number> {
  if (resolved.kind === 'enemy_city' || resolved.kind === 'enemy_player') {
    return guardWitOf(client, resolved.city.id);
  }
  if (resolved.kind === 'enemy_march') {
    return guardWitOf(client, resolved.march.from_city_id);
  }
  return 0;
}

/** 进攻类计谋的 PvP 门（只读；返回错误码与截止时刻，null = 通过） */
export async function stratagemPvpGate(
  client: pg.PoolClient,
  accountId: string,
  targetAccountId: string,
  targetCityId: string | null,
  now: Date,
): Promise<{ code: 'TARGET_PROTECTED' | 'TRUCE_ACTIVE' | 'ALLY_TARGET'; until?: Date } | null> {
  // 目标在新手保护 / 被动免战 / 主动免战中：不能施进攻类计谋
  const targetRes = await client.query(
    `SELECT a.newbie_until, a.self_truce_until, c.truce_until AS city_truce_until
     FROM accounts a LEFT JOIN cities c ON c.id = $2 WHERE a.id = $1`,
    [targetAccountId, targetCityId],
  );
  const row = targetRes.rows[0] as
    | { newbie_until: Date | null; self_truce_until: Date | null; city_truce_until: Date | null }
    | undefined;
  if (row) {
    const candidates = [row.newbie_until, row.self_truce_until, row.city_truce_until].filter(
      (until): until is Date => until !== null && until.getTime() > now.getTime(),
    );
    if (
      candidates.length > 0 &&
      (inNewbieProtection(row.newbie_until, now) ||
        inTruce(row.city_truce_until, row.self_truce_until, now))
    ) {
      return { code: 'TARGET_PROTECTED', until: candidates.sort((a, b) => b.getTime() - a.getTime())[0] };
    }
  }
  // 自己的主动免战生效中：不能施进攻类计谋（同不能出兵打玩家）
  const selfRes = await client.query(`SELECT self_truce_until FROM accounts WHERE id = $1`, [accountId]);
  const selfTruce = (selfRes.rows[0] as { self_truce_until: Date | null } | undefined)?.self_truce_until ?? null;
  if (selfTruce && selfTruce.getTime() > now.getTime()) {
    return { code: 'TRUCE_ACTIVE', until: selfTruce };
  }
  // 同一联盟 / 友盟（含解除友好后的冷却）：不能施进攻类计谋
  if (await cannotAttack(client, accountId, targetAccountId)) {
    return { code: 'ALLY_TARGET' };
  }
  return null;
}

/**
 * 十面埋伏的出兵拦截（v86，AISLG-211）：所有「从这座城派出部队」的入口统一调用——
 * MARCH（出征 / 调兵 / 运输 / 侦察 / 协防）、ENTER_BATTLEFIELD、交易所商队出发。
 * 召回类入口不检查。返回 null = 可派；否则为 CITY_AMBUSHED 的剩余秒数。
 */
export async function cityDispatchBlockedSeconds(
  q: pg.Pool | pg.PoolClient,
  cityId: string,
  now: Date,
): Promise<number | null> {
  return ambushRemainingSeconds(q, cityId, now);
}
