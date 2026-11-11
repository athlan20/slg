// 兑换码批次的列清单与「库里的行 → 对象」映射（AISLG-253 抽出，AISLG-255 加 channel）。
// 单独一个文件是为了让兑换事务（redeem-db.ts）与运营侧的查询（redeem-ops-db.ts）共用同一份列清单，
// 又不互相 import（两个模块都用它，彼此不需要知道对方）。
// rewards 是 jsonb：读回时一律走 validateRedeemRewards 重新校验，库里的奖励包被改坏时给空奖励包
// （兑换侧按 CODE_INVALID 处理，运营侧至少还能看到批次名）。

import { isRedeemBatchKind, validateRedeemRewards, type RedeemBatchKind, type RedeemRewards } from './redeem-code';

/** 批次（库里的一行） */
export interface RedeemBatchRow {
  id: string;
  name: string;
  kind: RedeemBatchKind;
  rewards: RedeemRewards;
  maxRedemptions: number | null;
  expiresAt: Date | null;
  disabled: boolean;
  /** 渠道标记（AISLG-255）：如 taobao；存量批次与内部批次为 null */
  channel: string | null;
  createdAt: Date;
}

/** SELECT 出来的原始行（jsonb / 列名都是 snake_case） */
export interface BatchLookupRow {
  id: string;
  name: string;
  kind: string;
  rewards: unknown;
  max_redemptions: number | null;
  expires_at: Date | null;
  disabled: boolean;
  channel: string | null;
  created_at: Date;
}

/** 批次的列清单（SELECT 里直接用，顺序与 BatchLookupRow 无关，靠列名映射） */
export const BATCH_COLUMNS = `id, name, kind, rewards, max_redemptions, expires_at, disabled, channel, created_at`;

/** 批次名带别名时（JOIN 查询里 b.*）：把 b. 前缀拼到列清单上 */
export function batchColumns(alias: string): string {
  return BATCH_COLUMNS.split(', ')
    .map((column) => `${alias}.${column}`)
    .join(', ');
}

export function toBatchRow(row: BatchLookupRow): RedeemBatchRow {
  const validated = validateRedeemRewards(row.rewards);
  return {
    id: row.id,
    name: row.name,
    kind: isRedeemBatchKind(row.kind) ? row.kind : 'single',
    rewards: validated.ok ? validated.rewards : {},
    maxRedemptions: row.max_redemptions,
    expiresAt: row.expires_at,
    disabled: row.disabled,
    channel: row.channel ?? null,
    createdAt: row.created_at,
  };
}