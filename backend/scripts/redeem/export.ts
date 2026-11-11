// export 子命令（AISLG-253，AISLG-255 加 --format txt 与 --unused）。
// - CSV（默认，253 的行为）：第一行表头 code，之后每行一个码（显示格式，带横线）。
// - txt（淘宝发货工具导入）：**没有表头、没有引号、不带批次信息**，每行一个 XXXX-XXXX-XXXX-XXXX。
//   淘宝的自动发货工具把整行当券号发出去，多一行表头就会把 "code" 当成第一个券号发给买家。
// - --unused：只导出还没兑换、也还没作废的码（补发货 / 重新导入发货工具时用）。

import type pg from 'pg';
import { listRedeemCodes, loadRedeemBatch } from '../../common/src/redeem-db';
import { formatRedeemCode } from '../../common/src/redeem-code';
import { checkOptions, requireOption, type ParsedArgs } from './args';

export const EXPORT_OPTIONS = ['batch', 'format', 'unused'];

export const EXPORT_FORMATS = ['csv', 'txt'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

function readFormat(args: ParsedArgs): ExportFormat {
  const raw = args.options.get('format') ?? 'csv';
  if (raw !== 'csv' && raw !== 'txt') {
    throw new Error(`--format 只能是 ${EXPORT_FORMATS.join(' / ')}，收到 ${raw}`);
  }
  return raw;
}

export async function exportCodes(pool: pg.Pool, args: ParsedArgs): Promise<void> {
  checkOptions(args, EXPORT_OPTIONS);
  const batchId = requireOption(args.options, 'batch');
  const format = readFormat(args);
  const batch = await loadRedeemBatch(pool, batchId);
  if (!batch) {
    throw new Error(`找不到批次 ${batchId}`);
  }
  const unused = args.flags.has('unused');
  const codes = await listRedeemCodes(pool, batchId, { unused });
  if (format === 'csv') {
    // 253 的格式：表头 + 每行一个码（显示格式，运营直接发给玩家）
    console.log('code');
  }
  for (const code of codes) {
    console.log(formatRedeemCode(code));
  }
  const scope = unused ? '未兑换且未作废的码' : '全部码';
  console.error(
    `批次 ${batch.name}（${batchId}）渠道 ${batch.channel ?? '（无）'}：导出 ${scope} ${codes.length} 个（${format}）` +
      (batch.disabled ? '（批次已停用）' : ''),
  );
}