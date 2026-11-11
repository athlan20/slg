// void 子命令（AISLG-255）：买家退款时作废还**没被兑换**的码（之后兑换返回 CODE_INVALID）。
// 已兑换的码不能作废——已兑换的不收回元宝（与商品页「不支持 7 天无理由退货」一致），
// 命令输出「已被兑换，不能作废」与兑换时间，由运营自己决定怎么和买家沟通。
// 支持 `--code A --code B`（可重复）或 `--file codes.txt`（每行一个，空行忽略）。
// 一个码失败不影响其余；退出码：全部成功 0，有任意一个失败 1（不存在 / 已被兑换算失败，
// 本来就已经作废算成功——目标状态已经达成，重复执行同一批文件不会报错）。

import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { isRedeemVoidFailure, voidRedeemCodes } from '../../common/src/redeem-db';
import { formatRedeemCode, formatUtc8DateTime } from '../../common/src/redeem-code';
import { checkOptions, type ParsedArgs } from './args';

export const VOID_OPTIONS = ['code', 'file'];

/** 收集要作废的码：--code（可多次）+ --file（每行一个，去掉空白行） */
function collectCodes(args: ParsedArgs): string[] {
  const codes = [...(args.repeatable.get('code') ?? [])];
  const file = args.options.get('file');
  if (file !== undefined) {
    const text = readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed !== '') {
        codes.push(trimmed);
      }
    }
  }
  if (codes.length === 0) {
    throw new Error('缺少 --code 或 --file（至少给一个要作废的码）');
  }
  return codes;
}

export async function voidCommand(pool: pg.Pool, args: ParsedArgs): Promise<boolean> {
  checkOptions(args, VOID_OPTIONS);
  const codes = collectCodes(args);
  const outcomes = await voidRedeemCodes(pool, codes);
  const counts = { voided: 0, already: 0, claimed: 0, missing: 0 };
  for (const outcome of outcomes) {
    const shown = outcome.code ? formatRedeemCode(outcome.code) : outcome.input;
    switch (outcome.status) {
      case 'voided':
        counts.voided += 1;
        console.log(`已作废：${shown}`);
        break;
      case 'already_voided':
        counts.already += 1;
        console.log(`本来就已作废（${formatUtc8DateTime(outcome.voidedAt)} UTC+8）：${shown}`);
        break;
      case 'claimed':
        counts.claimed += 1;
        console.log(`已被兑换，不能作废（兑换时间 ${formatUtc8DateTime(outcome.claimedAt)} UTC+8）：${shown}`);
        break;
      default:
        counts.missing += 1;
        console.log(`不存在：${shown}`);
        break;
    }
  }
  console.error(
    `共 ${outcomes.length} 个：作废 ${counts.voided}、本来就已作废 ${counts.already}、` +
      `已被兑换 ${counts.claimed}、不存在 ${counts.missing}`,
  );
  return outcomes.every((outcome) => !isRedeemVoidFailure(outcome));
}