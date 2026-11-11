// 兑换码的运营侧查询（AISLG-255，淘宝渠道配套）：客服查一个码（lookup）、买家退款时作废未兑换的码（void）、
// 按渠道对账（stats）。兑换事务本身仍在 redeem-db.ts；这里只读（除 void）且都不碰玩家侧协议。
//
// 并发约定（与 redeem-db.ts 的兑换事务配合）：兑换事务在读码时对该 redeem_codes 行加 FOR SHARE，
// 作废在这里先 SELECT ... FOR UPDATE 锁同一行。两者要么先后串行、要么一个等另一个提交，不会都成功：
// - 作废先提交 → 兑换的 FOR SHARE 等到提交后读到 voided_at 非空 → CODE_INVALID；
// - 兑换先提交（已插 redeem_claims）→ 作废拿到锁后**新起一条语句**查 claim（READ COMMITTED 每条语句
//   取新快照）→ 看到 claim →返回「已被兑换，不能作废」。
// 不用「UPDATE ... WHERE NOT EXISTS (SELECT ... FROM redeem_claims)」单语句：READ COMMITTED 下被阻塞的
// UPDATE 重新检查条件时子查询仍用语句开始时的快照，刚提交的 claim 看不见，会出现两者都成功。

import type pg from 'pg';
import { toBatchRow, type BatchLookupRow, type RedeemBatchRow } from './redeem-batch-row';
import { maskUsername, normalizeRedeemCode, type RedeemRewards } from './redeem-code';

type Queryable = pg.Pool | pg.PoolClient;

/** 一个码的运营侧状态（优先级从高到低：已兑换 > 已作废 > 批次已停用 > 已过期 > 未兑换） */
export const REDEEM_CODE_STATES = ['claimed', 'voided', 'disabled', 'expired', 'unused'] as const;
export type RedeemCodeState = (typeof REDEEM_CODE_STATES)[number];

export interface RedeemCodeLookup {
  /** 规范化后的码（库里存的形式） */
  code: string;
  batch: RedeemBatchRow;
  /** 按上面的优先级取一个 */
  state: RedeemCodeState;
  /** 全部命中的状态（按同样顺序排列，第一个等于 state），客服把其余的也念给玩家听 */
  states: RedeemCodeState[];
  /** 已兑换时的最早兑换时间 */
  claimedAt: Date | null;
  /** 已兑换账号的用户名（已打码：前 2 位 + `*` + 后 2 位；绝不返回完整用户名） */
  maskedUsername: string | null;
  /** 这个码被领了几次（一次性码是 0/1，通用码可能多人） */
  claimCount: number;
  voidedAt: Date | null;
}

const CLAIM_QUERY = `SELECT cl.claimed_at, a.username, count(*) OVER () AS claim_count
   FROM redeem_claims cl JOIN accounts a ON a.id = cl.account_id
  WHERE cl.code = $1
  ORDER BY cl.claimed_at, cl.id
  LIMIT 1`;

/**
 * 客服查一个码：批次名 / 渠道 / 奖励 / 状态 / 兑换时间 / 打码后的用户名。
 * 输入的码按 253 的规则规范化；规范化失败或库里没有这个码返回 null（脚本输出「不存在」）。
 */
export async function lookupRedeemCode(q: Queryable, rawCode: string, now: Date): Promise<RedeemCodeLookup | null> {
  const code = normalizeRedeemCode(rawCode);
  if (!code) {
    return null;
  }
  const res = await q.query(
    `SELECT b.id, b.name, b.kind, b.rewards, b.max_redemptions, b.expires_at, b.disabled, b.channel, b.created_at,
            c.voided_at
     FROM redeem_codes c JOIN redeem_batches b ON b.id = c.batch_id
     WHERE c.code = $1`,
    [code],
  );
  const row = res.rows[0] as (BatchLookupRow & { voided_at: Date | null }) | undefined;
  if (!row) {
    return null;
  }
  const batch = toBatchRow(row);
  const claim = await q.query(CLAIM_QUERY, [code]);
  const claimRow = claim.rows[0] as
    | { claimed_at: Date | string; username: string; claim_count: number | string }
    | undefined;
  const claimedAt = claimRow ? new Date(claimRow.claimed_at) : null;
  const claimCount = claimRow ? Number(claimRow.claim_count) : 0;

  // 命中的状态都收进来，按 REDEEM_CODE_STATES 的顺序排（state 取第一个）
  const hit = new Set<RedeemCodeState>();
  if (claimCount > 0) {
    hit.add('claimed');
  }
  if (row.voided_at) {
    hit.add('voided');
  }
  if (row.disabled) {
    hit.add('disabled');
  }
  if (row.expires_at && new Date(row.expires_at).getTime() <= now.getTime()) {
    hit.add('expired');
  }
  if (hit.size === 0) {
    hit.add('unused');
  }
  const states = REDEEM_CODE_STATES.filter((state) => hit.has(state));
  return {
    code,
    batch,
    state: states[0],
    states,
    claimedAt,
    maskedUsername: claimRow ? maskUsername(claimRow.username) : null,
    claimCount,
    voidedAt: row.voided_at ? new Date(row.voided_at) : null,
  };
}

/** 作废一个码的结果（脚本按状态输出一行；claimed / not_found 算失败，退出码 1） */
export type RedeemVoidOutcome =
  | { status: 'voided'; input: string; code: string }
  | { status: 'already_voided'; input: string; code: string; voidedAt: Date }
  | { status: 'claimed'; input: string; code: string; claimedAt: Date }
  | { status: 'not_found'; input: string; code: string | null };

/** 作废的失败状态：脚本据此决定退出码（已作废算成功：目标状态已经达成） */
export function isRedeemVoidFailure(outcome: RedeemVoidOutcome): boolean {
  return outcome.status === 'claimed' || outcome.status === 'not_found';
}

/**
 * 作废一个码（买家退款时用）。**调用方必须已经在事务里**（本函数不开事务：锁与 claim 查询要在同一个事务内，
 * 见文件头的并发约定）。已被兑换的码不能作废（已兑换的不收回元宝，与商品页「不支持 7 天无理由退货」一致）。
 */
export async function voidRedeemCode(
  client: pg.PoolClient,
  rawCode: string,
  now: Date,
): Promise<RedeemVoidOutcome> {
  const code = normalizeRedeemCode(rawCode);
  if (!code) {
    return { status: 'not_found', input: rawCode, code: null };
  }
  const locked = await client.query(`SELECT voided_at FROM redeem_codes WHERE code = $1 FOR UPDATE`, [code]);
  const row = locked.rows[0] as { voided_at: Date | null } | undefined;
  if (!row) {
    return { status: 'not_found', input: rawCode, code };
  }
  if (row.voided_at) {
    return { status: 'already_voided', input: rawCode, code, voidedAt: new Date(row.voided_at) };
  }
  // 锁到手之后**新起一条语句**查 claim：阻塞期间对手提交的 claim 在这里能看到
  const claim = await client.query(`SELECT min(claimed_at) AS claimed_at FROM redeem_claims WHERE code = $1`, [code]);
  const claimedAt = (claim.rows[0] as { claimed_at: Date | string | null }).claimed_at;
  if (claimedAt) {
    return { status: 'claimed', input: rawCode, code, claimedAt: new Date(claimedAt) };
  }
  await client.query(`UPDATE redeem_codes SET voided_at = $2 WHERE code = $1 AND voided_at IS NULL`, [code, now]);
  return { status: 'voided', input: rawCode, code };
}

/**
 * 批量作废（脚本的 `void --code A --code B` / `--file`）：一个码一个事务，一个失败不影响其余。
 * 返回顺序与输入一致。
 */
export async function voidRedeemCodes(
  pool: pg.Pool,
  codes: readonly string[],
  now: Date = new Date(),
): Promise<RedeemVoidOutcome[]> {
  const outcomes: RedeemVoidOutcome[] = [];
  const client = await pool.connect();
  try {
    for (const code of codes) {
      await client.query('BEGIN');
      try {
        const outcome = await voidRedeemCode(client, code, now);
        if (outcome.status === 'voided') {
          await client.query('COMMIT');
        } else {
          await client.query('ROLLBACK');
        }
        outcomes.push(outcome);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    }
  } finally {
    client.release();
  }
  return outcomes;
}

/** 对账里的一天（UTC+8 自然日） */
export interface RedeemChannelDayStat {
  /** YYYY-MM-DD（UTC+8） */
  day: string;
  /** 当天已兑换的码数 */
  claims: number;
  /** 当天折合元宝总数（只算奖励里的 ingot） */
  ingot: number;
}

/** 一个渠道的对账结果：按天的明细（含合计）+ 渠道总量 */
export interface RedeemChannelStats {
  channel: string;
  days: RedeemChannelDayStat[];
  /** 明细的合计（= days 之和） */
  totalClaims: number;
  totalIngot: number;
  /** 渠道的总量（不受 --since / --until 限制） */
  batchCount: number;
  codeCount: number;
  claimedCount: number;
  unusedCount: number;
  voidedCount: number;
}

interface StatsParams {
  channel: string;
  /** YYYY-MM-DD（含边界）；null = 不限 */
  since: string | null;
  /** YYYY-MM-DD（含边界）；null = 不限 */
  until: string | null;
}

/**
 * 按渠道对账（AISLG-255）：按 UTC+8 自然日汇总已兑换码数与折合元宝，另附渠道的批次 / 码 / 已兑换 /
 * 未兑换 / 已作废数量。运营拿它和淘宝后台的订单数对：订单数 ≥ 已兑换码数，差额是买家还没兑换的。
 * 奖励包可能被手改坏，ingot 只认纯数字，其余按 0 计（不抛错）。
 */
export async function channelRedeemStats(q: Queryable, params: StatsParams): Promise<RedeemChannelStats> {
  const days = await q.query(
    `SELECT to_char((cl.claimed_at AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') AS day,
            count(*) AS claims,
            sum(CASE WHEN b.rewards->>'ingot' ~ '^[0-9]+$' THEN (b.rewards->>'ingot')::int ELSE 0 END) AS ingot
     FROM redeem_claims cl JOIN redeem_batches b ON b.id = cl.batch_id
     WHERE b.channel = $1
       AND ($2::date IS NULL OR (cl.claimed_at AT TIME ZONE 'Asia/Shanghai')::date >= $2::date)
       AND ($3::date IS NULL OR (cl.claimed_at AT TIME ZONE 'Asia/Shanghai')::date <= $3::date)
     GROUP BY 1
     ORDER BY 1`,
    [params.channel, params.since, params.until],
  );
  const dayRows = days.rows as Array<{ day: string; claims: number | string; ingot: number | string | null }>;
  const totals = await q.query(
    `SELECT
       (SELECT count(*) FROM redeem_batches b WHERE b.channel = $1) AS batch_count,
       (SELECT count(*) FROM redeem_codes c JOIN redeem_batches b ON b.id = c.batch_id WHERE b.channel = $1) AS code_count,
       (SELECT count(*) FROM redeem_claims cl JOIN redeem_batches b ON b.id = cl.batch_id WHERE b.channel = $1) AS claimed_count,
       (SELECT count(*) FROM redeem_codes c JOIN redeem_batches b ON b.id = c.batch_id
         WHERE b.channel = $1 AND c.voided_at IS NOT NULL) AS voided_count,
       (SELECT count(*) FROM redeem_codes c JOIN redeem_batches b ON b.id = c.batch_id
         WHERE b.channel = $1 AND c.voided_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM redeem_claims cl2 WHERE cl2.code = c.code)) AS unused_count`,
    [params.channel],
  );
  const totalRow = totals.rows[0] as Record<string, number | string>;
  const dayStats: RedeemChannelDayStat[] = dayRows.map((row) => ({
    day: row.day,
    claims: Number(row.claims),
    ingot: Number(row.ingot ?? 0),
  }));
  return {
    channel: params.channel,
    days: dayStats,
    totalClaims: dayStats.reduce((sum, row) => sum + row.claims, 0),
    totalIngot: dayStats.reduce((sum, row) => sum + row.ingot, 0),
    batchCount: Number(totalRow.batch_count),
    codeCount: Number(totalRow.code_count),
    claimedCount: Number(totalRow.claimed_count),
    unusedCount: Number(totalRow.unused_count),
    voidedCount: Number(totalRow.voided_count),
  };
}

/** 奖励包里的元宝总数（脚本展示用；只算 ingot） */
export function rewardsIngot(rewards: RedeemRewards): number {
  return rewards.ingot ?? 0;
}