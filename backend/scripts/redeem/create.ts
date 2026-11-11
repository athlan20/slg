// create 子命令（AISLG-253，AISLG-255 加 --channel）：批量生成一次性码 / 一个通用码。
// 输出格式不能乱改：运营照抄，test/redeem/harness.ts 也从这里解析批次 id 与码（`批次 id：` 开头、
// 码是 XXXX-XXXX-XXXX-XXXX 的行）。

import type pg from 'pg';
import { createRedeemBatch } from '../../common/src/redeem-db';
import {
  REDEEM_BATCH_KINDS,
  REDEEM_BATCH_MAX_CODES,
  REDEEM_BATCH_NAME_MAX,
  REDEEM_CHANNEL_MAX,
  REDEEM_INGOT_MAX,
  REDEEM_INGOT_MIN,
  REDEEM_MAX_REDEMPTIONS_LIMIT,
  formatRedeemCode,
  formatRedeemRewards,
  isRedeemBatchKind,
  normalizeRedeemChannel,
  parseRedeemExpiresAt,
  parseRedeemItemSpec,
  validateRedeemRewards,
  type RedeemBatchKind,
  type RedeemItemReward,
  type RedeemRewards,
} from '../../common/src/redeem-code';
import { checkOptions, formatDate, readInt, requireOption, type ParsedArgs } from './args';

export const CREATE_OPTIONS = ['name', 'kind', 'count', 'max', 'ingot', 'item', 'expires', 'channel'];

export interface CreateInput {
  name: string;
  kind: RedeemBatchKind;
  rewards: RedeemRewards;
  maxRedemptions: number | null;
  expiresAt: Date | null;
  count: number;
  channel: string | null;
}

/** 校验 create 的参数并组装成 createRedeemBatch 的输入（与库无关） */
export function buildCreateInput(args: ParsedArgs): CreateInput {
  checkOptions(args, CREATE_OPTIONS);
  const { options, repeatable } = args;
  const name = requireOption(options, 'name');
  if (name.length > REDEEM_BATCH_NAME_MAX) {
    throw new Error(`--name 不能超过 ${REDEEM_BATCH_NAME_MAX} 个字`);
  }
  const rawKind = options.get('kind') ?? 'single';
  if (!isRedeemBatchKind(rawKind)) {
    throw new Error(`--kind 只能是 ${REDEEM_BATCH_KINDS.join(' / ')}，收到 ${rawKind}`);
  }
  const kind: RedeemBatchKind = rawKind;

  const rawChannel = options.get('channel');
  let channel: string | null = null;
  if (rawChannel !== undefined) {
    // AISLG-255：渠道只允许字母、数字与连字符（最长 20 个字符），统一存小写
    channel = normalizeRedeemChannel(rawChannel);
    if (!channel) {
      throw new Error(`--channel 只允许字母、数字与连字符，最长 ${REDEEM_CHANNEL_MAX} 个字符，收到 ${rawChannel}`);
    }
  }

  const ingot = readInt(options, 'ingot', REDEEM_INGOT_MIN, REDEEM_INGOT_MAX) ?? undefined;
  const items: RedeemItemReward[] = [];
  for (const spec of repeatable.get('item') ?? []) {
    const parsed = parseRedeemItemSpec(spec);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    items.push(parsed.item);
  }
  const validated = validateRedeemRewards({
    ...(ingot === undefined ? {} : { ingot }),
    ...(items.length === 0 ? {} : { items }),
  });
  if (!validated.ok) {
    throw new Error(`奖励不合法：${validated.error}`);
  }

  let maxRedemptions: number | null = null;
  let count = 0;
  if (kind === 'shared') {
    if (options.has('count')) {
      throw new Error('通用码一个批次只有一个码，不要给 --count，用 --max 设最多兑换人数');
    }
    maxRedemptions = readInt(options, 'max', 1, REDEEM_MAX_REDEMPTIONS_LIMIT);
    if (maxRedemptions === null) {
      throw new Error('通用码必须用 --max 设最多兑换人数');
    }
  } else {
    if (options.has('max')) {
      throw new Error('一次性码不需要 --max（每个码只能被兑换一次），去掉它');
    }
    const parsedCount = readInt(options, 'count', 1, REDEEM_BATCH_MAX_CODES);
    if (parsedCount === null) {
      throw new Error('一次性码必须用 --count 指定生成数量');
    }
    count = parsedCount;
  }
  return {
    name,
    kind,
    rewards: validated.rewards,
    maxRedemptions,
    expiresAt: options.has('expires') ? parseRedeemExpiresAt(options.get('expires') as string) : null,
    count,
    channel,
  };
}

export async function create(pool: pg.Pool, args: ParsedArgs): Promise<void> {
  const input = buildCreateInput(args);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await createRedeemBatch(client, input);
    await client.query('COMMIT');
    console.log(`批次 id：${created.batchId}`);
    console.log(
      `名称：${input.name}　类型：${input.kind}　渠道：${input.channel ?? '（无）'}　奖励：${formatRedeemRewards(input.rewards)}　过期：${formatDate(input.expiresAt)}` +
        (input.maxRedemptions === null ? '' : `　最多兑换人数：${input.maxRedemptions}`),
    );
    console.log(`码（${created.codes.length} 个，只有这次和 export 能看到）：`);
    for (const code of created.codes) {
      console.log(formatRedeemCode(code));
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
