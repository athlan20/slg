// disable 子命令（AISLG-253）：停用批次——未兑换的码立即失效，已领的奖励不收回。
// 与 void（AISLG-255，码级作废）的区别：停用是批次级的，不逐个码记 voided_at。

import type pg from 'pg';
import { disableRedeemBatch, loadRedeemBatch } from '../../common/src/redeem-db';
import { checkOptions, requireOption, type ParsedArgs } from './args';

export async function disable(pool: pg.Pool, args: ParsedArgs): Promise<void> {
  checkOptions(args, ['batch']);
  const batchId = requireOption(args.options, 'batch');
  const batch = await loadRedeemBatch(pool, batchId);
  if (!batch) {
    throw new Error(`找不到批次 ${batchId}`);
  }
  const changed = await disableRedeemBatch(pool, batchId);
  if (changed) {
    console.log(`已停用批次 ${batch.name}（${batchId}）：未兑换的码立即失效，已领的奖励不收回`);
  } else {
    console.log(`批次 ${batch.name}（${batchId}）本来就是停用状态`);
  }
}