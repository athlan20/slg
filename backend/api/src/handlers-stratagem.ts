// 计谋（AISLG-211，v86）：GET_STRATAGEMS（op 145）与 CAST_STRATAGEM（op 146）。
// 通用施计流程（一个事务内）：锁施计武将 → 校验在家 / 冷却 → 解析目标 + PvP 门 →
// 扣 1 张令 → 查免疫 → 掷成功率（会失败的计谋）→ 成功则执行效果并写免疫行 →
// 写武将冷却 → 写双方事件 → 提交后推送。目标解析与出兵拦截见 stratagem-target.ts，
// 效果执行与推送见 stratagem-effects.ts，规则与数值见 common/src/stratagem.ts。

import {
  isStratagemKind,
  stratagemDef,
  stratagemSuccessPercent,
  stratagemImmunityMs,
  STRATAGEM_DEFS,
  STRATAGEM_TOKENS,
  STRATAGEM_HERO_COOLDOWN_MS,
  ambushDurationMs,
  ambushMinutes,
  burnFoodPercent,
  cicadaReducePercent,
  deceptionDurationMs,
  eightGatesExtendPercent,
  lootFireDurationMs,
  lootFirePercent,
  type RandomSource,
  type StratagemKind,
} from '../../common/src/stratagem';
import {
  EventType,
  type InitiatorRole,
  ErrorCode,
  CastStratagemResponseData,
  GetStratagemsResponseData,
  StratagemDefView,
  StratagemEffectPreview,
  StratagemHeroView,
  StratagemTargetView,
} from '../../common/src/protocol';
import { scaledMs } from '../../common/src/time-scale';
import { insertEvent } from '../../common/src/events';
import { heroBusyMarchMap, loadHeroes } from '../../common/src/hero-db';
import {
  loadStratagemTokens,
  lockStratagemTarget,
  lockStratagemTokenCount,
  spendStratagemToken,
  stratagemImmuneUntil,
  setStratagemImmunity,
} from '../../common/src/stratagem-db';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { breakNewbieProtection } from './pvp';
import {
  guardWitForTarget,
  immunityTargetOf,
  resolveStratagemTarget,
  stratagemPvpGate,
  UUID_RE,
} from './stratagem-target';
import {
  applyStratagemEffect,
  cityIdsToRefresh,
  collectStratagemPushes,
  targetBriefOf,
  usernameOf,
} from './stratagem-effects';

/** 施计判定的随机源（成功率 / 欺敌倍数；单测注入固定种子，缺省 Math.random） */
let castRandom: RandomSource = Math.random;
export function setStratagemRandomSource(rng: RandomSource): void {
  castRandom = rng;
}
export function stratagemRandom(): RandomSource {
  return castRandom;
}

function defViews(): StratagemDefView[] {
  return STRATAGEM_DEFS.map((def) => ({
    kind: def.kind,
    name: def.name,
    nameEn: def.nameEn,
    category: def.category,
    tokenKind: def.tokenKind,
    targetType: def.targetType,
    canFail: def.canFail,
    notifiesTarget: def.notifiesTarget,
    offensive: def.offensive,
    immunitySeconds: def.immunityBaseMs === null ? null : Math.round(scaledMs(def.immunityBaseMs) / 1000),
  }));
}

/** 按智力算好的效果预览（GET_STRATAGEMS 与前端确认框展示） */
export function effectPreviewOf(kind: StratagemKind, wit: number): StratagemEffectPreview {
  switch (kind) {
    case 'phantom_army':
      return { multiplierPercent: [300, 500], durationMs: deceptionDurationMs(wit) };
    case 'empty_fort':
      return { multiplierPercent: [10, 20, 30], durationMs: deceptionDurationMs(wit) };
    case 'burn_granary':
      return { burnFoodPercent: burnFoodPercent(wit) };
    case 'loot_fire':
      return { protectionDownPercent: lootFirePercent(wit), durationMs: lootFireDurationMs() };
    case 'ambush_all_sides':
      return { ambushMinutes: ambushMinutes(wit), durationMs: ambushDurationMs(wit) };
    case 'golden_cicada':
      return { returnFasterPercent: cicadaReducePercent(wit) };
    case 'eight_gates':
      return { marchSlowerPercent: eightGatesExtendPercent(wit) };
    default:
      return {};
  }
}

/** 账号武将的施计可用性与效果预览（城守可施计；历练 / 重伤 / 随行 / 冷却不可） */
async function heroViews(q: Parameters<typeof loadHeroes>[0], accountId: string, now: Date): Promise<StratagemHeroView[]> {
  const [heroes, busy] = await Promise.all([loadHeroes(q, accountId), heroBusyMarchMap(q, accountId)]);
  return heroes.map((hero): StratagemHeroView => {
    const cooldownUntil = hero.stratagem_cooldown_until ?? null;
    const reason =
      hero.train_until
        ? ('training' as const)
        : hero.wounded_until && hero.wounded_until.getTime() > now.getTime()
          ? ('wounded' as const)
          : busy.has(hero.id)
            ? ('busy' as const)
            : cooldownUntil && cooldownUntil.getTime() > now.getTime()
              ? ('cooldown' as const)
              : null;
    const effects = {} as Record<StratagemKind, StratagemEffectPreview>;
    for (const def of STRATAGEM_DEFS) {
      effects[def.kind] = effectPreviewOf(def.kind, hero.wit);
    }
    return {
      heroId: hero.id,
      name: hero.name,
      famous: hero.famous,
      wit: hero.wit,
      available: reason === null,
      unavailableReason: reason,
      cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
      effects,
    };
  });
}

/** GET_STRATAGEMS（op 145）：定义 + 令持有 + 逐武将预览；带 target 时附判定 */
export async function handleGetStratagems(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const nowRes = await client.query(`SELECT now() AS now`);
    const now = nowRes.rows[0].now as Date;
    const tokens = await loadStratagemTokens(client, accountId);
    const heroes = await heroViews(client, accountId, now);
    const raw = data?.target as Record<string, unknown> | undefined;
    let targetView: StratagemTargetView | null = null;
    if (raw && isStratagemKind(raw.stratagem) && typeof raw.heroId === 'string') {
      targetView = await buildTargetView(client, accountId, raw.stratagem, raw.heroId, raw, now);
    }
    await client.query('COMMIT');
    const tokenLimits = Object.fromEntries(STRATAGEM_TOKENS.map((t) => [t.kind, t.holdLimit])) as GetStratagemsResponseData['tokenLimits'];
    respondOk(ctx.registry, conn, op, seq, {
      stratagems: defViews(),
      tokens,
      tokenLimits,
      heroes,
      target: targetView,
    } satisfies GetStratagemsResponseData);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 对某目标的判定（成功率 / 免疫 / PvP 保护；只读不改） */
async function buildTargetView(
  client: Parameters<typeof resolveStratagemTarget>[0],
  accountId: string,
  kind: StratagemKind,
  heroId: string,
  target: { cityId?: unknown; marchId?: unknown; attackId?: unknown },
  now: Date,
): Promise<StratagemTargetView> {
  const def = stratagemDef(kind);
  const resolved = await resolveStratagemTarget(client, accountId, def, {
    cityId: typeof target.cityId === 'string' ? target.cityId : undefined,
    marchId: typeof target.marchId === 'string' ? target.marchId : undefined,
    attackId: typeof target.attackId === 'string' ? target.attackId : undefined,
  });
  if (resolved.kind === 'invalid') {
    return { stratagem: kind, heroId, valid: false, invalidReason: 'INVALID_TARGET', successPercent: 0, immuneUntil: null, guardWit: 0, protectedReason: null };
  }
  const heroRes = await client.query(
    `SELECT wit, train_until, wounded_until FROM account_heroes WHERE id = $1 AND account_id = $2`,
    [heroId, accountId],
  );
  const hero = heroRes.rows[0] as { wit: number } | undefined;
  const guardWit = await guardWitForTarget(client, resolved);
  if (!hero) {
    return { stratagem: kind, heroId, valid: false, invalidReason: 'HERO_NOT_FOUND', successPercent: 0, immuneUntil: null, guardWit, protectedReason: null };
  }
  const immunity = immunityTargetOf(resolved);
  const immuneUntil = immunity ? await stratagemImmuneUntil(client, immunity.type, immunity.id, kind, now) : null;
  let protectedReason: StratagemTargetView['protectedReason'] = null;
  if (def.offensive && resolved.kind !== 'npc_attack' && resolved.kind !== 'own_return_march' && resolved.kind !== 'own_city') {
    const targetAccountId =
      resolved.kind === 'enemy_city' || resolved.kind === 'enemy_player' || resolved.kind === 'enemy_march' ? resolved.targetAccountId : null;
    if (targetAccountId) {
      const gate = await stratagemPvpGate(
        client,
        accountId,
        targetAccountId,
        resolved.kind === 'enemy_city' || resolved.kind === 'enemy_player' ? resolved.city.id : null,
        now,
      );
      protectedReason = gate ? gate.code : null;
    }
  }
  return {
    stratagem: kind,
    heroId,
    valid: true,
    successPercent: def.canFail ? stratagemSuccessPercent(hero.wit, guardWit) : 100,
    immuneUntil: immuneUntil ? immuneUntil.toISOString() : null,
    guardWit,
    protectedReason,
  };
}

/** CAST_STRATAGEM（op 146） */
export async function handleCastStratagem(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const heroId = data?.heroId;
  const kind = data?.stratagem;
  const target = data?.target as Record<string, unknown> | undefined;
  if (typeof heroId !== 'string' || !UUID_RE.test(heroId) || !isStratagemKind(kind) || !target || typeof target !== 'object') {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const def = stratagemDef(kind);
  const client = await ctx.pool.connect();
  // 事务内产出、提交后使用
  let response: Record<string, unknown> | null = null;
  let pushes: Array<() => void> = [];
  try {
    await client.query('BEGIN');
    const nowRes = await client.query(`SELECT now() AS now`);
    const now = nowRes.rows[0].now as Date;

    // 1) 先解析并锁定目标（城 / 行军 / NPC 袭击）：与 Worker 的 cities → marches → heroes
    //    锁序一致，避免与行军结算互等
    const resolved = await resolveStratagemTarget(client, accountId, def, {
      cityId: typeof target.cityId === 'string' ? target.cityId : undefined,
      marchId: typeof target.marchId === 'string' ? target.marchId : undefined,
      attackId: typeof target.attackId === 'string' ? target.attackId : undefined,
    }, true);
    if (resolved.kind === 'invalid') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_TARGET');
      return;
    }

    // 2) 锁施计武将 → 在家 / 冷却校验
    const heroRes = await client.query(`SELECT * FROM account_heroes WHERE id = $1 AND account_id = $2 FOR UPDATE`, [heroId, accountId]);
    const hero = heroRes.rows[0] as
      | { id: string; name: string; wit: number; train_until: Date | null; wounded_until: Date | null; stratagem_cooldown_until: Date | null }
      | undefined;
    if (!hero) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'HERO_NOT_FOUND');
      return;
    }
    const unavailable = hero.train_until
      ? 'training'
      : hero.wounded_until && hero.wounded_until.getTime() > now.getTime()
        ? 'wounded'
        : (await heroBusyMarchMap(client, accountId)).has(hero.id)
          ? 'busy'
          : null;
    if (unavailable) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'HERO_NOT_AVAILABLE', { reason: unavailable });
      return;
    }
    if (hero.stratagem_cooldown_until && hero.stratagem_cooldown_until.getTime() > now.getTime()) {
      const retryAfterSeconds = Math.max(1, Math.ceil((hero.stratagem_cooldown_until.getTime() - now.getTime()) / 1000));
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'HERO_STRATAGEM_COOLDOWN', { retryAfterSeconds });
      return;
    }
    const targetAccountId =
      resolved.kind === 'enemy_city' || resolved.kind === 'enemy_player' || resolved.kind === 'enemy_march'
        ? resolved.targetAccountId
        : null;
    if (def.offensive && targetAccountId) {
      const gate = await stratagemPvpGate(
        client,
        accountId,
        targetAccountId,
        resolved.kind === 'enemy_city' || resolved.kind === 'enemy_player' ? resolved.city.id : null,
        now,
      );
      if (gate) {
        await client.query('ROLLBACK');
        const extra: Record<string, unknown> = {};
        if (gate.until) {
          extra.until = gate.until.toISOString();
          extra.retryAfterSeconds = Math.max(1, Math.ceil((gate.until.getTime() - now.getTime()) / 1000));
        }
        respondError(ctx.registry, conn, op, seq, gate.code as ErrorCode, Object.keys(extra).length ? extra : undefined);
        return;
      }
      // 自己在新手保护中施进攻类计谋 → 保护立即失效（同主动侦察 / 攻击玩家）
      await breakNewbieProtection(client, accountId, 'stratagem', {
        username: await usernameOf(client, targetAccountId),
        x: resolved.kind === 'enemy_city' || resolved.kind === 'enemy_player' ? resolved.city.x ?? 0 : 0,
        y: resolved.kind === 'enemy_city' || resolved.kind === 'enemy_player' ? resolved.city.y ?? 0 : 0,
      }, role);
    }

    // 3) 同一目标 + 同一种计串行化（免疫判定 → 执行 → 写免疫行必须在一个锁内，
    //    否则两人同时施同一种计会双双成功）；无免疫的计谋不需要
    const immunity = immunityTargetOf(resolved);
    if (immunity && def.immunityBaseMs !== null) {
      await lockStratagemTarget(client, immunity.type, immunity.id, kind);
    }

    // 4) 扣 1 张令（成功失败都扣；先锁行校验持有）
    const have = await lockStratagemTokenCount(client, accountId, def.tokenKind);
    if (have < 1) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'STRATAGEM_TOKEN_SHORT', { tokenKind: def.tokenKind, have });
      return;
    }
    const tokensLeft = await spendStratagemToken(client, accountId, def.tokenKind);

    // 5) 免疫（直接判失败）→ 成功率判定 → 执行效果
    let success = true;
    let failedReason: 'immune' | 'roll' | null = null;
    if (immunity && def.immunityBaseMs !== null) {
      const immuneUntil = await stratagemImmuneUntil(client, immunity.type, immunity.id, kind, now);
      if (immuneUntil) {
        success = false;
        failedReason = 'immune';
      }
    }
    if (success && def.canFail) {
      const guardWit = await guardWitForTarget(client, resolved);
      success = castRandom() * 100 < stratagemSuccessPercent(hero.wit, guardWit);
      if (!success) {
        failedReason = 'roll';
      }
    }
    const cooldownUntil = new Date(now.getTime() + scaledMs(STRATAGEM_HERO_COOLDOWN_MS));
    const applied = success
      ? await applyStratagemEffect(client, accountId, kind, resolved, hero.wit, now, castRandom)
      : { effect: {}, targetEffect: {}, marchUpdated: null, npcAttackUpdated: null };
    if (success && immunity && def.immunityBaseMs !== null) {
      const ms = stratagemImmunityMs(kind);
      if (ms !== null) {
        await setStratagemImmunity(client, immunity.type, immunity.id, kind, new Date(now.getTime() + ms));
      }
    }
    await client.query(`UPDATE account_heroes SET stratagem_cooldown_until = $2 WHERE id = $1`, [hero.id, cooldownUntil]);

    // 6) 事件（施计方 / 目标方）与提交后推送
    const casterName = await usernameOf(client, accountId);
    const targetName = targetAccountId ? await usernameOf(client, targetAccountId) : null;
    const targetBrief = targetBriefOf(resolved);
    await insertEvent(client, {
      accountId,
      cityId: resolved.kind === 'own_city' ? resolved.city.id : null,
      type: EventType.STRATAGEM_CAST,
      initiator: role,
      detail: {
        stratagem: kind,
        stratagemName: def.name,
        heroId: hero.id,
        heroName: hero.name,
        target: targetBrief,
        targetUsername: targetName,
        success,
        failedReason,
        effect: applied.effect,
        tokenKind: def.tokenKind,
        tokensLeft,
      },
    });
    if (def.notifiesTarget && targetAccountId) {
      await insertEvent(client, {
        accountId: targetAccountId,
        cityId: resolved.kind === 'enemy_city' ? resolved.city.id : null,
        type: EventType.STRATAGEM_RECEIVED,
        initiator: null,
        detail: {
          stratagem: kind,
          stratagemName: def.name,
          caster: { username: casterName, heroName: hero.name },
          target: targetBrief,
          success,
          effect: applied.targetEffect,
        },
      });
    }
    pushes = collectStratagemPushes(ctx, {
      def,
      resolved,
      success,
      targetEffect: applied.targetEffect,
      targetAccountId,
      casterName,
      casterAccountId: accountId,
      heroName: hero.name,
      marchUpdated: applied.marchUpdated,
      npcAttackUpdated: applied.npcAttackUpdated,
      npcAccountId: resolved.kind === 'npc_attack' ? resolved.attack.account_id : null,
      cityPushIds: success ? cityIdsToRefresh(resolved, accountId) : [],
    });
    await client.query('COMMIT');
    response = {
      success,
      failedReason,
      effect: applied.effect,
      tokenKind: def.tokenKind,
      tokensLeft,
      heroCooldownUntil: cooldownUntil.toISOString(),
    } satisfies CastStratagemResponseData;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  for (const push of pushes) {
    push();
  }
  respondOk(ctx.registry, conn, op, seq, response ?? {});
}
