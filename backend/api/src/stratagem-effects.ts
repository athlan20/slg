// 计谋（AISLG-211）的效果执行与提交后推送：CAST_STRATAGEM 事务内调用 applyStratagemEffect，
// 提交后由 collectStratagemPushes 发 PUSH_STRATAGEM / PUSH_MARCH_STATE / PUSH_NPC_ATTACK_WARNING /
// PUSH_CITY_STATE。数值换算全部走 common/src/stratagem.ts 的纯函数。

import pg from 'pg';
import {
  Op,
  type StratagemKind,
  type RandomSource,
  type SpyTrailIntel,
} from '../../common/src/protocol';
import {
  ambushDurationMs,
  burnFoodAmount,
  cicadaArriveAt,
  cicadaReducePercent,
  deceptionDurationMs,
  eightGatesArriveAt,
  eightGatesExtendPercent,
  emptyFortMultiplierPercent,
  lootFireDurationMs,
  lootFirePercent,
  phantomMultiplierPercent,
  type StratagemDef,
} from '../../common/src/stratagem';
import { upsertCityEffect } from '../../common/src/stratagem-db';
import type { HandlerContext } from './handlers';
import { marchView, type MarchRow } from './views';
import type { ResolvedStratagemTarget, StratagemNpcAttackRow } from './stratagem-target';

export interface AppliedStratagem {
  /** 施计方看到的效果（蛛丝马迹含情报列表） */
  effect: Record<string, unknown>;
  /** 目标方警报里可见的效果摘要（不含情报列表） */
  targetEffect: Record<string, unknown>;
  /** 行军时刻被改写后的整行（金蝉脱壳 / 八门金锁；提交后推 PUSH_MARCH_STATE） */
  marchUpdated: MarchRow | null;
  /** NPC 袭击时刻被改写后的行（八门金锁；提交后推 PUSH_NPC_ATTACK_WARNING） */
  npcAttackUpdated: StratagemNpcAttackRow | null;
}

export async function usernameOf(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  accountId: string,
): Promise<string> {
  const res = await client.query(`SELECT username FROM accounts WHERE id = $1`, [accountId]);
  return ((res.rows[0] as { username: string } | undefined)?.username) ?? '';
}

/** 事件 / 警报里对目标的简述（城给坐标与名字，部队给 id 与坐标） */
export function targetBriefOf(resolved: ResolvedStratagemTarget): Record<string, unknown> {
  switch (resolved.kind) {
    case 'own_city':
    case 'enemy_city':
    case 'enemy_player':
      return { kind: 'city', cityId: resolved.city.id, cityName: resolved.city.name, x: resolved.city.x, y: resolved.city.y };
    case 'enemy_march':
      return { kind: 'march', marchId: resolved.march.id, x: resolved.march.x, y: resolved.march.y };
    case 'npc_attack':
      return { kind: 'npc_attack', attackId: resolved.attack.id, x: resolved.attack.x, y: resolved.attack.y };
    case 'own_return_march':
      return { kind: 'march', marchId: resolved.march.id, x: resolved.march.x, y: resolved.march.y };
    default:
      return {};
  }
}

/** 成功施计后需要刷新城池视图（GET_STATE）的账号 → 城映射 */
export function cityIdsToRefresh(resolved: ResolvedStratagemTarget, casterAccountId: string): Array<{ accountId: string; cityId: string }> {
  switch (resolved.kind) {
    case 'own_city':
      return [{ accountId: casterAccountId, cityId: resolved.city.id }];
    case 'enemy_city':
      return [{ accountId: resolved.targetAccountId, cityId: resolved.city.id }];
    default:
      return [];
  }
}

/** 事务内执行效果（成功才调用）：写效果行 / 扣粮 / 改行军时刻 / 查情报 */
export async function applyStratagemEffect(
  client: pg.PoolClient,
  casterAccountId: string,
  kind: StratagemKind,
  resolved: ResolvedStratagemTarget,
  wit: number,
  now: Date,
  rng: RandomSource,
): Promise<AppliedStratagem> {
  const nowMs = now.getTime();
  switch (kind) {
    // 欺敌：同城只有一行 deception，新施的覆盖旧的；倍数施计时随机定死，持续 = 智力 × 10 分钟
    case 'phantom_army':
    case 'empty_fort': {
      if (resolved.kind !== 'own_city') {
        return { effect: {}, targetEffect: {}, marchUpdated: null, npcAttackUpdated: null };
      }
      const multiplierPercent = kind === 'phantom_army' ? phantomMultiplierPercent(rng) : emptyFortMultiplierPercent(rng);
      const until = new Date(nowMs + deceptionDurationMs(wit));
      await upsertCityEffect(client, resolved.city.id, 'deception', multiplierPercent, until);
      // 欺敌不通知任何人：targetEffect 恒为空（别人只在侦察识破时看到情报标记）
      return {
        effect: { stratagem: kind, multiplierPercent, until: until.toISOString() },
        targetEffect: {},
        marchUpdated: null,
        npcAttackUpdated: null,
      };
    }
    // 焚烧粮草：立即烧掉现存粮食的 min(智力 × 0.1%, 8%)，无持续期
    case 'burn_granary': {
      if (resolved.kind !== 'enemy_city') {
        return { effect: {}, targetEffect: {}, marchUpdated: null, npcAttackUpdated: null };
      }
      const cityRes = await client.query(`SELECT id, food FROM cities WHERE id = $1 FOR UPDATE`, [resolved.city.id]);
      const food = Number((cityRes.rows[0] as { food: number | string }).food);
      const burned = burnFoodAmount(food, wit);
      await client.query(`UPDATE cities SET food = food - $2 WHERE id = $1`, [resolved.city.id, burned]);
      return {
        effect: { foodBurned: burned },
        targetEffect: { foodBurned: burned },
        marchUpdated: null,
        npcAttackUpdated: null,
      };
    }
    // 趁火打劫：仓库防掠保护降低，持续 1 小时
    case 'loot_fire': {
      if (resolved.kind !== 'enemy_city') {
        return { effect: {}, targetEffect: {}, marchUpdated: null, npcAttackUpdated: null };
      }
      const percent = lootFirePercent(wit);
      const until = new Date(nowMs + lootFireDurationMs());
      await upsertCityEffect(client, resolved.city.id, 'loot_fire', percent, until);
      return {
        effect: { protectionDownPercent: percent, until: until.toISOString() },
        targetEffect: { protectionDownPercent: percent, until: until.toISOString() },
        marchUpdated: null,
        npcAttackUpdated: null,
      };
    }
    // 十面埋伏：锁城（不能派出任何部队），持续 智力 × 1 分钟 ≤ 60
    case 'ambush_all_sides': {
      if (resolved.kind !== 'enemy_city') {
        return { effect: {}, targetEffect: {}, marchUpdated: null, npcAttackUpdated: null };
      }
      const until = new Date(nowMs + ambushDurationMs(wit));
      await upsertCityEffect(client, resolved.city.id, 'ambush_all_sides', 0, until);
      return {
        effect: { until: until.toISOString() },
        targetEffect: { until: until.toISOString() },
        marchUpdated: null,
        npcAttackUpdated: null,
      };
    }
    // 金蝉脱壳：返程剩余时间减少，同一支部队只能一次
    case 'golden_cicada': {
      if (resolved.kind !== 'own_return_march') {
        return { effect: {}, targetEffect: {}, marchUpdated: null, npcAttackUpdated: null };
      }
      const reducedPercent = cicadaReducePercent(wit);
      const arriveAt = new Date(cicadaArriveAt(nowMs, resolved.march.arrive_at.getTime(), wit));
      await client.query(`UPDATE marches SET arrive_at = $2, stratagem_used = true WHERE id = $1`, [resolved.march.id, arriveAt]);
      const row = await reloadMarch(client, resolved.march.id);
      return {
        effect: { arriveAt: arriveAt.toISOString(), reducedPercent },
        targetEffect: {},
        marchUpdated: row,
        npcAttackUpdated: null,
      };
    }
    // 八门金锁：剩余行军时间增加（玩家出征或 NPC 袭击；带埋伏的截击行军同样顺延）
    case 'eight_gates': {
      const extendedPercent = eightGatesExtendPercent(wit);
      if (resolved.kind === 'npc_attack') {
        const arriveAt = new Date(eightGatesArriveAt(nowMs, resolved.attack.arrive_at.getTime(), wit));
        await client.query(`UPDATE npc_attacks SET arrive_at = $2 WHERE id = $1`, [resolved.attack.id, arriveAt]);
        return {
          effect: { arriveAt: arriveAt.toISOString(), extendedPercent },
          targetEffect: { arriveAt: arriveAt.toISOString(), extendedPercent },
          marchUpdated: null,
          npcAttackUpdated: { ...resolved.attack, arrive_at: arriveAt },
        };
      }
      if (resolved.kind !== 'enemy_march') {
        return { effect: {}, targetEffect: {}, marchUpdated: null, npcAttackUpdated: null };
      }
      const arriveAt = new Date(eightGatesArriveAt(nowMs, resolved.march.arrive_at.getTime(), wit));
      await client.query(`UPDATE marches SET arrive_at = $2 WHERE id = $1`, [resolved.march.id, arriveAt]);
      const row = await reloadMarch(client, resolved.march.id);
      return {
        effect: { arriveAt: arriveAt.toISOString(), extendedPercent },
        targetEffect: { arriveAt: arriveAt.toISOString(), extendedPercent },
        marchUpdated: row,
        npcAttackUpdated: null,
      };
    }
    // 蛛丝马迹：目标玩家全部城池坐标 + 在外部队去向（不含兵力）
    case 'spy_trail': {
      if (resolved.kind !== 'enemy_player') {
        return { effect: {}, targetEffect: {}, marchUpdated: null, npcAttackUpdated: null };
      }
      const intel = await collectSpyTrail(client, resolved.targetAccountId);
      return {
        effect: { intel },
        targetEffect: {},
        marchUpdated: null,
        npcAttackUpdated: null,
      };
    }
    default:
      return { effect: {}, targetEffect: {}, marchUpdated: null, npcAttackUpdated: null };
  }
}

async function reloadMarch(client: pg.PoolClient, marchId: string): Promise<MarchRow | null> {
  const res = await client.query(`SELECT * FROM marches WHERE id = $1`, [marchId]);
  return res.rowCount ? (res.rows[0] as MarchRow) : null;
}

async function collectSpyTrail(client: pg.PoolClient, targetAccountId: string): Promise<SpyTrailIntel> {
  const citiesRes = await client.query(
    `SELECT id, name, x, y FROM cities WHERE account_id = $1 ORDER BY created_at`,
    [targetAccountId],
  );
  const marchesRes = await client.query(
    `SELECT id, x, y, purpose, arrive_at FROM marches WHERE account_id = $1 AND status = 'marching' ORDER BY arrive_at`,
    [targetAccountId],
  );
  return {
    cities: (citiesRes.rows as Array<{ id: string; name: string; x: number | null; y: number | null }>).map((row) => ({
      cityId: row.id,
      name: row.name,
      x: row.x ?? 0,
      y: row.y ?? 0,
    })),
    marches: (marchesRes.rows as Array<{ id: string; x: number; y: number; purpose: string; arrive_at: Date }>).map((row) => ({
      marchId: row.id,
      x: row.x,
      y: row.y,
      purpose: row.purpose,
      arriveAt: row.arrive_at.toISOString(),
    })),
  };
}

/** 收集提交后要发的推送（事务提交后逐个执行） */
export function collectStratagemPushes(
  ctx: HandlerContext,
  info: {
    def: StratagemDef;
    resolved: ResolvedStratagemTarget;
    success: boolean;
    targetEffect: Record<string, unknown>;
    targetAccountId: string | null;
    casterName: string;
    /** 施计方账号（八门金锁改的是对方行军，施计方也要看到新的到达时刻） */
    casterAccountId: string;
    heroName: string;
    marchUpdated: MarchRow | null;
    npcAttackUpdated: StratagemNpcAttackRow | null;
    npcAccountId: string | null;
    cityPushIds: Array<{ accountId: string; cityId: string }>;
  },
): Array<() => void> {
  const pushes: Array<() => void> = [];
  const { def, resolved } = info;
  // 会失败的计谋：不论成败，目标玩家都收到警报（欺敌类与金蝉脱壳不通知）
  if (def.notifiesTarget && info.targetAccountId) {
    const push = {
      op: Op.PUSH_STRATAGEM,
      push: true as const,
      data: {
        stratagem: def.kind,
        stratagemName: def.name,
        caster: { username: info.casterName, heroName: info.heroName },
        target: targetBriefOf(resolved),
        success: info.success,
        effect: info.targetEffect,
      },
    };
    pushes.push(() => ctx.registry.broadcast(info.targetAccountId as string, push));
  }
  // 行军时刻被改写：双方收到行军更新（金蝉脱壳推自己；八门金锁推对方，施计自己也刷新一份）
  if (info.marchUpdated) {
    const view = marchView(info.marchUpdated);
    const owners = new Set([info.marchUpdated.account_id, info.casterAccountId]);
    for (const owner of owners) {
      pushes.push(() =>
        ctx.registry.broadcast(owner, { op: Op.PUSH_MARCH_STATE, push: true, data: { reason: 'march_time_changed', march: view } }),
      );
    }
  }
  // NPC 袭击被延迟：按最近一条预警事件重建载荷推送给被袭击方（arriveAt 已更新）
  if (info.npcAttackUpdated && info.npcAccountId) {
    const attack = info.npcAttackUpdated;
    const accountId = info.npcAccountId;
    pushes.push(() => {
      void (async () => {
        const res = await ctx.pool.query(
          `SELECT detail FROM events WHERE account_id = $1 AND type = 'npc_attack_warning' AND detail->>'attackId' = $2 ORDER BY id DESC LIMIT 1`,
          [accountId, attack.id],
        );
        const detail = res.rows[0] as { detail: Record<string, unknown> } | undefined;
        if (detail) {
          ctx.registry.broadcast(accountId, {
            op: Op.PUSH_NPC_ATTACK_WARNING,
            push: true,
            data: { ...detail.detail, arriveAt: attack.arrive_at.toISOString() },
          });
        }
      })().catch(() => undefined);
    });
  }
  // 城池状态变化（烧粮 / 十面埋伏 / 趁火打劫 / 欺敌）：相关账号刷新城池视图
  for (const { accountId, cityId } of info.cityPushIds) {
    pushes.push(() =>
      ctx.registry.broadcast(accountId, { op: Op.PUSH_CITY_STATE, push: true, data: { reason: 'stratagem', cityId } }),
    );
  }
  return pushes;
}
