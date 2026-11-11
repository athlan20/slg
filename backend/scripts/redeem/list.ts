// list 子命令（AISLG-253，AISLG-255 加渠道列与已作废列）：批次的名称 / 类型 / 渠道 / 奖励 /
// 已兑换 · 总数 / 已作废 / 过期时间 / 状态。已作废的码不算「可兑换」，单独一列显示，
// 运营看「已兑换/总数」时不会把作废的码误当成还没发出去。

import type pg from 'pg';
import { listRedeemBatches } from '../../common/src/redeem-db';
import { formatRedeemRewards } from '../../common/src/redeem-code';
import { checkOptions, formatDate, pad, type ParsedArgs } from './args';

// 列宽（按终端显示宽度估算：中日韩字符算 2，其余算 1）
const LIST_WIDTHS = [36, 20, 8, 10, 28, 14, 8, 26, 8];

export async function list(pool: pg.Pool, args: ParsedArgs): Promise<void> {
  checkOptions(args, []);
  const batches = await listRedeemBatches(pool);
  if (batches.length === 0) {
    console.log('还没有兑换码批次');
    return;
  }
  const header = ['批次 id', '名称', '类型', '渠道', '奖励', '已兑换/总数', '已作废', '过期时间', '状态'];
  console.log(header.map((cell, index) => pad(cell, LIST_WIDTHS[index])).join(''));
  for (const batch of batches) {
    // 通用码的总数是人数上限，一次性码的总数是生成了多少个码
    const total = batch.kind === 'shared' ? (batch.maxRedemptions ?? 0) : batch.codeCount;
    const row = [
      batch.id,
      batch.name,
      batch.kind,
      batch.channel ?? '-',
      formatRedeemRewards(batch.rewards),
      `${batch.claimCount}/${total}`,
      String(batch.voidedCount),
      formatDate(batch.expiresAt),
      batch.disabled ? '已停用' : '启用中',
    ];
    console.log(row.map((cell, index) => pad(cell, LIST_WIDTHS[index])).join(''));
  }
}