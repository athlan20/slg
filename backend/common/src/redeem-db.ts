// 兑换码的存取（AISLG-253，v109）：批次的创建 / 列表 / 导出 / 停用，兑换事务，失败次数与清理。
// 表结构见 redeem-schema.ts，格式与奖励校验见 redeem-code.ts，协议处理在 api/src/handlers-redeem.ts，
// 运营脚本在 scripts/redeem-codes.ts。
//
// 兑换（redeemCode）全部在一个事务里完成，失败一律回滚：
//   规范化 → 每账号一张咨询锁（同一账号的兑换串行，限流判定才准）→ 失败次数 → 按 code 找码与批次
//   （不存在 / 停用 / 已作废 → CODE_INVALID，过期 → CODE_EXPIRED）→ 通用码先 FOR UPDATE 锁批次行再数已领人数
//   （≥ max_redemptions → CODE_EXHAUSTED）→ 插 redeem_claims（ON CONFLICT DO NOTHING + 判断 rowCount：
//   同批次已领 → CODE_BATCH_CLAIMED，一次性码已被用 → CODE_USED）→ 预检道具堆叠（超上限 → ITEM_STACK_FULL，
//   整次回滚、码不作废、也不算已领）→ 发奖励（道具 grantItem、元宝 grantIngot）→ 写 CODE_REDEEMED。
// 锁序：批次行（仅通用码）→ redeem_codes 行（FOR SHARE，只有作废会改它）→ user_items（grantItem 内部锁）→
// accounts（grantIngot 的 UPDATE），与 handlers-items.ts 的「先 user_items 再 accounts」一致；
// redeem_claims 在发奖励之前插入，不引入反向等待。
// AISLG-255：客服作废（voidRedeemCode，在 redeem-ops-db.ts）与兑换同时发生时只能有一个成功。兑换事务在
// 读码时对该 redeem_codes 行加 FOR SHARE 并拿到 voided_at，作废先 SELECT ... FOR UPDATE 锁同一行、拿到锁后
// 再查 redeem_claims：两边要么先后串行（后到的看到对方的结果），要么一个等另一个提交，不会都成功。
// 第 1、3、4 步的错误在事务回滚后单独记一条 redeem_attempts(ok = false)；成功记 ok = true。
// ITEM_STACK_FULL 与 CODE_RATE_LIMITED 不计失败次数（背包满不是猜码，超限期间记账会让封禁无限延长）。

import type pg from 'pg';
import { EventType } from './protocol-city';
import { insertEvent } from './events';
import { grantItem, loadItems, lockItemStack } from './items-db';
import { itemDef, type ItemId } from './items';
import { grantIngot, loadIngot } from './ingot-db';
import type { InitiatorRole } from './protocol';
import { BATCH_COLUMNS, toBatchRow, type BatchLookupRow, type RedeemBatchRow } from './redeem-batch-row';
import { normalizeRedeemChannel } from './redeem-code';
import {
  REDEEM_BATCH_MAX_CODES,
  REDEEM_FAIL_LIMIT,
  REDEEM_FAIL_WINDOW_MS,
  REDEEM_ATTEMPT_RETENTION_MS,
  codeTail,
  generateRedeemCode,
  normalizeRedeemCode,
  validateRedeemRewards,
  type RedeemBatchKind,
  type RedeemItemReward,
  type RedeemRewards,
} from './redeem-code';

type Queryable = pg.Pool | pg.PoolClient;

/** 兑换可能返回的错误码（与 protocol.ts 的 ErrorCode 同名） */
export const REDEEM_ERROR_CODES = [
  'CODE_INVALID',
  'CODE_EXPIRED',
  'CODE_USED',
  'CODE_BATCH_CLAIMED',
  'CODE_EXHAUSTED',
  'CODE_RATE_LIMITED',
  'ITEM_STACK_FULL',
] as const;
export type RedeemErrorCode = (typeof REDEEM_ERROR_CODES)[number];

// 批次的行结构、列清单与映射在 redeem-batch-row.ts（运营侧的查询也要用）；AISLG-253 时它在本文件里。
export type { RedeemBatchRow } from './redeem-batch-row';
// AISLG-255 的运营侧查询（lookup / void / stats）在 redeem-ops-db.ts；这里转出，调用方与测试只用本文件。
export {
  lookupRedeemCode,
  channelRedeemStats,
  voidRedeemCode,
  voidRedeemCodes,
  isRedeemVoidFailure,
  type RedeemCodeLookup,
  type RedeemCodeState,
  type RedeemChannelDayStat,
  type RedeemChannelStats,
  type RedeemVoidOutcome,
} from './redeem-ops-db';

/** 运营脚本 list 用的批次摘要 */
export interface RedeemBatchSummary extends RedeemBatchRow {
  /** 这批一共多少个码 */
  codeCount: number;
  /** 已兑换人数（一次性码是已用掉的码数，通用码是已领人数） */
  claimCount: number;
  /** 已作废的码数（AISLG-255） */
  voidedCount: number;
}

export interface CreateRedeemBatchInput {
  name: string;
  kind: RedeemBatchKind;
  rewards: RedeemRewards;
  /** 通用码必填（最多兑换人数）；一次性码必须为 null */
  maxRedemptions: number | null;
  expiresAt: Date | null;
  /** 一次性码的生成数量（1..10000）；通用码固定 1 */
  count: number;
  /** 渠道标记（AISLG-255，可省）：字母、数字、连字符，最长 20 个字符；对账按渠道汇总 */
  channel?: string | null;
}

export interface CreatedRedeemBatch {
  batchId: string;
  /** 规范化后的码（库里的存储形式） */
  codes: string[];
}

/** 错误响应附带的数据（前端展示用） */
export interface RedeemErrorDetail {
  retryAfterSeconds?: number;
  itemId?: ItemId;
  stackMax?: number;
  have?: number;
  canGrant?: number;
  limit?: number;
  used?: number;
}

export type RedeemResult =
  | { ok: true; rewards: RedeemRewards; ingot: number; items: Record<ItemId, number> }
  | { ok: false; code: RedeemErrorCode; detail?: RedeemErrorDetail };

function requireChannel(channel: string | null | undefined): string | null {
  if (channel === undefined || channel === null) {
    return null;
  }
  const normalized = normalizeRedeemChannel(channel);
  if (!normalized) {
    throw new Error(`createRedeemBatch: 渠道只允许字母、数字与连字符（最长 20 位），收到 ${channel}`);
  }
  return normalized;
}

/**
 * 创建批次并生成码（调用方事务内）。一次性码按 count 随机生成，遇到唯一约束冲突就重新生成
 * （32^16 的空间里实际上不会撞）；通用码只生成 1 个。
 */
export async function createRedeemBatch(
  client: pg.PoolClient,
  input: CreateRedeemBatchInput,
): Promise<CreatedRedeemBatch> {
  if (input.kind === 'single' && input.maxRedemptions !== null) {
    throw new Error('createRedeemBatch: 一次性码不能设 maxRedemptions');
  }
  if (input.kind === 'shared' && (input.maxRedemptions === null || input.maxRedemptions <= 0)) {
    throw new Error('createRedeemBatch: 通用码必须设 maxRedemptions');
  }
  const count = input.kind === 'shared' ? 1 : input.count;
  if (!Number.isInteger(count) || count < 1 || count > REDEEM_BATCH_MAX_CODES) {
    throw new Error(`createRedeemBatch: 码数量必须是 1..${REDEEM_BATCH_MAX_CODES}，收到 ${input.count}`);
  }
  const res = await client.query(
    `INSERT INTO redeem_batches (name, kind, rewards, max_redemptions, expires_at, channel)
     VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING id`,
    [input.name, input.kind, JSON.stringify(input.rewards), input.maxRedemptions, input.expiresAt, requireChannel(input.channel)],
  );
  const batchId = (res.rows[0] as { id: string }).id;

  // 随机生成不重复的码，撞库（已存在）时重新生成；最多三轮，正常一轮就够
  let pending = new Set<string>();
  while (pending.size < count) {
    pending.add(generateRedeemCode());
  }
  const codes: string[] = [];
  for (let round = 0; round < 3 && codes.length < count; round += 1) {
    const list = [...pending];
    const inserted = await client.query(
      `INSERT INTO redeem_codes (code, batch_id)
       SELECT unnest($2::text[]), $1
       ON CONFLICT (code) DO NOTHING
       RETURNING code`,
      [batchId, list],
    );
    const done = new Set(inserted.rows.map((row) => (row as { code: string }).code));
    codes.push(...done);
    pending = new Set(list.filter((code) => !done.has(code)));
    while (pending.size < count - codes.length) {
      pending.add(generateRedeemCode());
    }
  }
  if (codes.length !== count) {
    throw new Error(`createRedeemBatch: 只生成了 ${codes.length}/${count} 个码，稍后重试`);
  }
  return { batchId, codes };
}

/** 批次列表（运营脚本 list）：名称 / 类型 / 奖励 / 已兑换 / 总数 / 过期时间 / 是否停用 */
export async function listRedeemBatches(q: Queryable): Promise<RedeemBatchSummary[]> {
  const res = await q.query(
    `SELECT b.id, b.name, b.kind, b.rewards, b.max_redemptions, b.expires_at, b.disabled, b.channel, b.created_at,
            (SELECT count(*) FROM redeem_codes c WHERE c.batch_id = b.id) AS code_count,
            (SELECT count(*) FROM redeem_codes c WHERE c.batch_id = b.id AND c.voided_at IS NOT NULL) AS voided_count,
            (SELECT count(*) FROM redeem_claims cl WHERE cl.batch_id = b.id) AS claim_count
     FROM redeem_batches b
     ORDER BY b.created_at DESC`,
  );
  return res.rows.map((row) => {
    const typed = row as BatchLookupRow & {
      code_count: number | string;
      claim_count: number | string;
      voided_count: number | string;
    };
    return {
      ...toBatchRow(typed),
      codeCount: Number(typed.code_count),
      claimCount: Number(typed.claim_count),
      voidedCount: Number(typed.voided_count),
    };
  });
}

/**
 * 某个批次的码（存储形式，运营脚本 export 用；批次不存在返回空数组）。
 * `unused = true`（AISLG-255）只给还没被兑换、也还没被作废的码：补发货 / 重新导入淘宝发货工具时用，
 * 避免把已用掉或已作废的码再发出去。批次停用不在排除之列（停用是批次级操作，运营自己清楚）。
 */
export async function listRedeemCodes(
  q: Queryable,
  batchId: string,
  options: { unused?: boolean } = {},
): Promise<string[]> {
  const res = options.unused
    ? await q.query(
        `SELECT c.code FROM redeem_codes c
         WHERE c.batch_id = $1 AND c.voided_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM redeem_claims cl WHERE cl.code = c.code)
         ORDER BY c.created_at, c.code`,
        [batchId],
      )
    : await q.query(`SELECT code FROM redeem_codes WHERE batch_id = $1 ORDER BY created_at, code`, [batchId]);
  return res.rows.map((row) => (row as { code: string }).code);
}

/** 按 id 读一个批次（不存在返回 null） */
export async function loadRedeemBatch(q: Queryable, batchId: string): Promise<RedeemBatchRow | null> {
  const res = await q.query(`SELECT ${BATCH_COLUMNS} FROM redeem_batches WHERE id = $1`, [batchId]);
  const row = res.rows[0] as BatchLookupRow | undefined;
  return row ? toBatchRow(row) : null;
}

/** 停用批次（未兑换的码立即失效；已领的奖励不收回）。返回是否改动了行 */
export async function disableRedeemBatch(q: Queryable, batchId: string): Promise<boolean> {
  const res = await q.query(`UPDATE redeem_batches SET disabled = true WHERE id = $1 AND NOT disabled`, [batchId]);
  return (res.rowCount ?? 0) > 0;
}

/** 最近 1 小时内的失败次数（以及最早那次失败的时刻，用来算 retryAfterSeconds） */
export async function countRecentFailures(
  q: Queryable,
  accountId: string,
  now: Date,
): Promise<{ count: number; oldest: Date | null }> {
  const since = new Date(now.getTime() - REDEEM_FAIL_WINDOW_MS);
  const res = await q.query(
    `SELECT count(*) AS count, min(attempted_at) AS oldest FROM (
       SELECT attempted_at FROM redeem_attempts
       WHERE account_id = $1 AND NOT ok AND attempted_at > $2
       ORDER BY attempted_at DESC
       LIMIT $3
     ) AS recent`,
    [accountId, since, REDEEM_FAIL_LIMIT],
  );
  const row = res.rows[0] as { count: number | string; oldest: Date | string | null } | undefined;
  const oldest = row?.oldest ? new Date(row.oldest) : null;
  return { count: row ? Number(row.count) : 0, oldest };
}

/** 记一条兑换尝试（ok = 是否成功）。热路径上只写一行，失败计数由 countRecentFailures 统计 */
export async function recordRedeemAttempt(q: Queryable, accountId: string, now: Date, ok: boolean): Promise<void> {
  await q.query(`INSERT INTO redeem_attempts (account_id, attempted_at, ok) VALUES ($1, $2, $3)`, [
    accountId,
    now,
    ok,
  ]);
}

/** 清理超过保留期的兑换尝试（Worker 定期调用），返回删除行数 */
export async function purgeRedeemAttempts(q: Queryable, now: Date): Promise<number> {
  const before = new Date(now.getTime() - REDEEM_ATTEMPT_RETENTION_MS);
  const res = await q.query(`DELETE FROM redeem_attempts WHERE attempted_at < $1`, [before]);
  return res.rowCount ?? 0;
}

/**
 * 事务已回滚后记一条失败尝试（写失败不影响错误返回，靠计数限制猜码）。
 * 用**同一个连接**写：失败分支仍持有事务连接，若再从池里借一个，高并发下会把池占满并互相等死。
 */
async function recordFailure(q: Queryable, accountId: string, now: Date): Promise<void> {
  await recordRedeemAttempt(q, accountId, now, false).catch(() => undefined);
}

/** 道具发放预检：锁住每行的 user_items 并确认发放后不超堆叠上限；超了返回要回给玩家的信息 */
async function precheckItems(
  client: pg.PoolClient,
  accountId: string,
  items: readonly RedeemItemReward[],
): Promise<{ ok: true } | { ok: false; detail: RedeemErrorDetail }> {
  for (const item of items) {
    const def = itemDef(item.itemId);
    if (!def) {
      throw new Error(`precheckItems: 未知道具 ${item.itemId}`);
    }
    const stack = await lockItemStack(client, accountId, item.itemId);
    if (stack.count + item.count > def.stackMax) {
      return {
        ok: false,
        detail: {
          itemId: item.itemId,
          stackMax: def.stackMax,
          have: stack.count,
          canGrant: Math.max(0, def.stackMax - stack.count),
        },
      };
    }
  }
  return { ok: true };
}

/**
 * 兑换一个码（见文件头的流程）。`now` 可注入，测试用它验证限流窗口与过期判定。
 * 事务内的任何失败都回滚（码、领取记录、奖励都不变），第 1 / 3 / 4 步的失败在回滚后单独记账。
 */
export async function redeemCode(
  pool: pg.Pool,
  params: { accountId: string; code: unknown; now?: Date; initiator?: InitiatorRole | null },
): Promise<RedeemResult> {
  const { accountId } = params;
  const now = params.now ?? new Date();
  const normalized = typeof params.code === 'string' ? normalizeRedeemCode(params.code) : null;
  if (!normalized) {
    // 第 1 步：格式不对（规范化后不是 16 位；含字符集外的字符时也对不上任何码）
    await recordFailure(pool, accountId, now);
    return { ok: false, code: 'CODE_INVALID' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 同一账号的兑换串行：限流判定与领取唯一性都在这把咨询锁内，避免并发下多算 / 少算
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text)::bigint)`, [accountId]);

    // 第 2 步：失败次数超限 → CODE_RATE_LIMITED（本条不记账，否则超限会无限延长）
    const failures = await countRecentFailures(client, accountId, now);
    if (failures.count >= REDEEM_FAIL_LIMIT) {
      await client.query('ROLLBACK');
      const until = (failures.oldest?.getTime() ?? now.getTime()) + REDEEM_FAIL_WINDOW_MS;
      return {
        ok: false,
        code: 'CODE_RATE_LIMITED',
        detail: { retryAfterSeconds: Math.max(1, Math.ceil((until - now.getTime()) / 1000)) },
      };
    }

    // 第 3 步：按 code 找码与批次。FOR SHARE 锁住码行直到事务结束（AISLG-255）：作废（void）要 UPDATE
    // 同一行，会等到本事务提交后才看得到最新的 voided_at，反过来本事务也能看到作废后的 voided_at。
    const lookup = await client.query(
      `SELECT b.id, b.name, b.kind, b.rewards, b.max_redemptions, b.expires_at, b.disabled, b.channel,
              b.created_at, c.voided_at
       FROM redeem_codes c JOIN redeem_batches b ON b.id = c.batch_id
       WHERE c.code = $1
       FOR SHARE OF c`,
      [normalized],
    );
    const row = lookup.rows[0] as (BatchLookupRow & { voided_at: Date | null }) | undefined;
    if (!row || row.disabled || row.voided_at) {
      // 已作废的码与停用批次走同一分支：对玩家一律 CODE_INVALID，并记一次失败尝试
      await client.query('ROLLBACK');
      await recordFailure(client, accountId, now);
      return { ok: false, code: 'CODE_INVALID' };
    }
    if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) {
      await client.query('ROLLBACK');
      await recordFailure(client, accountId, now);
      return { ok: false, code: 'CODE_EXPIRED' };
    }
    const batch = toBatchRow(row);
    const validated = validateRedeemRewards(batch.rewards);
    if (!validated.ok) {
      // 库里的奖励包被改坏了（运营手改库）：按无效码处理，什么都不发
      await client.query('ROLLBACK');
      await recordFailure(client, accountId, now);
      return { ok: false, code: 'CODE_INVALID' };
    }
    const rewards = validated.rewards;

    // 第 4 步：通用码先锁批次行，再在锁内数已领人数（避免超发）；一次性码靠 claims.code 唯一索引
    if (batch.kind === 'shared') {
      await client.query(`SELECT id FROM redeem_batches WHERE id = $1 FOR UPDATE`, [batch.id]);
      const used = await client.query(`SELECT count(*) AS used FROM redeem_claims WHERE batch_id = $1`, [batch.id]);
      const usedCount = Number((used.rows[0] as { used: number | string }).used);
      const limit = batch.maxRedemptions ?? 0;
      if (usedCount >= limit) {
        await client.query('ROLLBACK');
        await recordFailure(client, accountId, now);
        return { ok: false, code: 'CODE_EXHAUSTED', detail: { limit, used: usedCount } };
      }
    }

    const claim = await client.query(
      `INSERT INTO redeem_claims (batch_id, code, kind, account_id, claimed_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [batch.id, normalized, batch.kind, accountId, now],
    );
    if (!claim.rowCount) {
      // 冲突了：先看是不是本账号已经领过这一批（一次性码被同账号的另一个码领过也走这里）
      const claimed = await client.query(
        `SELECT 1 FROM redeem_claims WHERE batch_id = $1 AND account_id = $2`,
        [batch.id, accountId],
      );
      await client.query('ROLLBACK');
      await recordFailure(client, accountId, now);
      return { ok: false, code: claimed.rowCount ? 'CODE_BATCH_CLAIMED' : 'CODE_USED' };
    }

    // 第 5 步：预检道具堆叠（超上限整单回滚：码不作废、元宝也不发），再发奖励
    const items = rewards.items ?? [];
    if (items.length > 0) {
      const precheck = await precheckItems(client, accountId, items);
      if (!precheck.ok) {
        await client.query('ROLLBACK');
        return { ok: false, code: 'ITEM_STACK_FULL', detail: precheck.detail };
      }
      for (const item of items) {
        const granted = await grantItem(client, accountId, item.itemId, item.count, 'redeem');
        if (granted < item.count) {
          // 预检已锁行，这里理论上不会发生；万一发生也整单回滚
          await client.query('ROLLBACK');
          return { ok: false, code: 'ITEM_STACK_FULL', detail: { itemId: item.itemId } };
        }
      }
    }
    let balance = await loadIngot(client, accountId);
    if (rewards.ingot !== undefined) {
      balance = await grantIngot(client, accountId, rewards.ingot, 'redeem');
    }
    const backpack = await loadItems(client, accountId);

    // 第 6 步：CODE_REDEEMED（码只记后 4 位，不记全码）
    await insertEvent(client, {
      accountId,
      type: EventType.CODE_REDEEMED,
      initiator: params.initiator ?? null,
      detail: {
        batchId: batch.id,
        codeTail: codeTail(normalized),
        kind: batch.kind,
        rewards,
        ingot: balance,
        items: backpack,
      },
    });
    await recordRedeemAttempt(client, accountId, now, true);
    await client.query('COMMIT');
    return { ok: true, rewards, ingot: balance, items: backpack };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}