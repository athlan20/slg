// stats 子命令（AISLG-255）：按渠道对账。按 UTC+8 自然日汇总该渠道每天的已兑换码数与折合元宝总数
// （只算奖励里的 ingot），最后一行合计；再输出渠道的批次总数、码总数、已兑换数、未兑换数、已作废数。
// 用法：`stats --channel taobao [--since 2026-11-01] [--until 2026-11-30]`（日期含边界）。
// 运营拿它和淘宝后台的订单数对：淘宝订单数应当 ≥ 已兑换码数，差额是买家还没兑换的。

import type pg from 'pg';
import { channelRedeemStats } from '../../common/src/redeem-db';
import { normalizeRedeemChannel } from '../../common/src/redeem-code';
import { checkOptions, pad, requireOption, type ParsedArgs } from './args';

export const STATS_OPTIONS = ['channel', 'since', 'until'];
const STATS_WIDTHS = [12, 12, 12];

/** `--since` / `--until` 的日期：YYYY-MM-DD，必须是真实存在的日子（2026-02-31 报错） */
export function parseStatsDay(raw: string, option: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) {
    throw new Error(`--${option} 必须是 YYYY-MM-DD，收到 ${raw}`);
  }
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new Error(`--${option} 不是真实存在的日期，收到 ${raw}`);
  }
  return `${year}-${month}-${day}`;
}

export async function stats(pool: pg.Pool, args: ParsedArgs): Promise<void> {
  checkOptions(args, STATS_OPTIONS);
  const rawChannel = requireOption(args.options, 'channel');
  const channel = normalizeRedeemChannel(rawChannel);
  if (!channel) {
    throw new Error(`--channel 只允许字母、数字与连字符，最长 20 个字符，收到 ${rawChannel}`);
  }
  const since = args.options.has('since') ? parseStatsDay(args.options.get('since') as string, 'since') : null;
  const until = args.options.has('until') ? parseStatsDay(args.options.get('until') as string, 'until') : null;
  if (since && until && since > until) {
    throw new Error(`--since（${since}）不能晚于 --until（${until}）`);
  }

  const result = await channelRedeemStats(pool, { channel, since, until });
  console.log(`渠道：${result.channel}　日期口径：UTC+8 自然日${since ? `　从 ${since}` : ''}${until ? `　到 ${until}` : ''}`);
  console.log(['日期', '已兑换码数', '折合元宝'].map((cell, index) => pad(cell, STATS_WIDTHS[index])).join(''));
  for (const day of result.days) {
    console.log([day.day, String(day.claims), String(day.ingot)].map((cell, index) => pad(cell, STATS_WIDTHS[index])).join(''));
  }
  console.log(
    ['合计', String(result.totalClaims), String(result.totalIngot)]
      .map((cell, index) => pad(cell, STATS_WIDTHS[index]))
      .join(''),
  );
  console.log('');
  console.log(
    `批次总数：${result.batchCount}　码总数：${result.codeCount}　已兑换数：${result.claimedCount}　` +
      `未兑换数：${result.unusedCount}　已作废数：${result.voidedCount}`,
  );
}