// lookup 子命令（AISLG-255）：客服查一个码。买家说「码无效 / 已被使用」时运营先跑它，再决定怎么答复。
// 输出批次名、渠道、奖励、状态（多状态同时命中时按优先级显示一个，其余列在后面）、已兑换的兑换时间与
// **打码后**的用户名；库里的码不存在输出「不存在」（退出码 1，便于脚本判断）。
// 输入的码按 253 的规则规范化（去空格与横线、转大写），所以买家发来的任何写法都能查。

import type pg from 'pg';
import { lookupRedeemCode, type RedeemCodeLookup, type RedeemCodeState } from '../../common/src/redeem-db';
import { formatRedeemCode, formatRedeemRewards, formatUtc8DateTime } from '../../common/src/redeem-code';
import { checkOptions, type ParsedArgs } from './args';

/** 状态的中文标签（lookup / void 都用） */
export const STATE_LABEL: Record<RedeemCodeState, string> = {
  claimed: '已兑换',
  voided: '已作废',
  disabled: '批次已停用',
  expired: '已过期',
  unused: '未兑换',
};

/** 打印已兑换的信息：兑换时间 + 打码后的用户名（绝不输出完整用户名、邮箱或账号 id） */
function printClaim(found: RedeemCodeLookup): void {
  if (!found.claimedAt) {
    return;
  }
  console.log(`兑换时间：${formatUtc8DateTime(found.claimedAt)}（UTC+8）`);
  if (found.claimCount > 1) {
    console.log(`兑换人数：${found.claimCount}`);
  }
  if (found.maskedUsername) {
    console.log(`兑换账号：${found.maskedUsername}（已打码，只显示前 2 位与后 2 位）`);
  }
}

export async function lookup(pool: pg.Pool, args: ParsedArgs): Promise<boolean> {
  checkOptions(args, ['code']);
  // --code 在参数解析里是可重复参数（void 要多个），lookup 只查一个
  const codes = args.repeatable.get('code') ?? [];
  if (codes.length === 0 || codes[0].trim() === '') {
    throw new Error('缺少 --code <券号>');
  }
  if (codes.length > 1) {
    throw new Error('lookup 一次只查一个码（--code 给了多次）');
  }
  const input = codes[0].trim();
  const found = await lookupRedeemCode(pool, input, new Date());
  if (!found) {
    console.log(`不存在：${input}`);
    return false;
  }
  const others = found.states.slice(1).map((state) => STATE_LABEL[state]);
  console.log(`码：${formatRedeemCode(found.code)}`);
  console.log(`批次：${found.batch.name}（${found.batch.id}）`);
  console.log(`渠道：${found.batch.channel ?? '（无）'}`);
  console.log(`奖励：${formatRedeemRewards(found.batch.rewards)}`);
  console.log(`状态：${STATE_LABEL[found.state]}`);
  if (others.length > 0) {
    console.log(`其它命中的状态：${others.join('、')}`);
  }
  if (found.voidedAt) {
    console.log(`作废时间：${formatUtc8DateTime(found.voidedAt)}（UTC+8）`);
  }
  printClaim(found);
  return true;
}