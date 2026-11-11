// 运维脚本：兑换码的批量生成、查看、导出与停用（AISLG-253，v109）。没有网页后台，所有操作走这里。
// 码只在 create 的输出与 export 里可见；库里存的是明文（规范化后的 16 位大写），数据库权限要按敏感数据对待。
//
// 运行（在 backend/ 目录）：
//   npx tsx --env-file=.env scripts/redeem-codes.ts create --name "11月补偿" --kind single --count 100 --ingot 500 --item city_order:2 --expires 2026-12-31
//   npx tsx --env-file=.env scripts/redeem-codes.ts create --name "社群口令" --kind shared --max 200 --ingot 100 --expires 2026-11-30
//   npx tsx --env-file=.env scripts/redeem-codes.ts list
//   npx tsx --env-file=.env scripts/redeem-codes.ts export --batch <id> > codes.csv
//   npx tsx --env-file=.env scripts/redeem-codes.ts disable --batch <id>
//
// 选项：
//   --name <批次名>        必填（create），运营看的名字，如「11月补偿」
//   --kind single|shared  码类型，缺省 single
//   --count <N>           create + single：生成多少个一次性码（1..10000）
//   --max <N>             create + shared：最多兑换人数（必填）
//   --ingot <N>           元宝奖励（1..100000，可省；与 --item 至少给一项）
//   --item <id:count>     道具奖励（1..99，可重复；道具必须是在售的）
//   --expires <日期>      过期时间：2026-12-31 = 当天 UTC 结束（23:59:59.999Z），也可给 ISO 时间；不给则不过期
//   --batch <id>          export / disable 的批次 id
//
// 连库：与 scripts/ 下其他脚本一致（读 backend/.env 的 DATABASE_URL，进程环境变量优先）。
// 自测时用 DATABASE_URL 覆盖指向临时库，不要在需求目录直接连共用库。

import { createPool, ensureSchema } from '../common/src/db';
import {
  createRedeemBatch,
  disableRedeemBatch,
  listRedeemBatches,
  listRedeemCodes,
  loadRedeemBatch,
} from '../common/src/redeem-db';
import {
  REDEEM_BATCH_KINDS,
  REDEEM_BATCH_MAX_CODES,
  REDEEM_BATCH_NAME_MAX,
  REDEEM_INGOT_MAX,
  REDEEM_INGOT_MIN,
  REDEEM_MAX_REDEMPTIONS_LIMIT,
  formatRedeemCode,
  formatRedeemRewards,
  isRedeemBatchKind,
  parseRedeemItemSpec,
  parseRedeemExpiresAt,
  validateRedeemRewards,
  type RedeemBatchKind,
  type RedeemItemReward,
  type RedeemRewards,
} from '../common/src/redeem-code';

const USAGE = [
  '用法：redeem-codes.ts <create|list|export|disable> [选项]（见文件头注释）',
  '  create  --name "11月补偿" --kind single --count 100 --ingot 500 --item city_order:2 [--expires 2026-12-31]',
  '  create  --name "社群口令" --kind shared --max 200 --ingot 100 [--expires 2026-11-30]',
  '  list',
  '  export  --batch <id>',
  '  disable --batch <id>',
].join('\n');

interface ParsedArgs {
  positional: string[];
  options: Map<string, string>;
  repeatable: Map<string, string[]>;
}

/** 手写参数解析：--key value 与可重复的 --item（不装依赖） */
function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string>();
  const repeatable = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${key} 缺少值`);
    }
    i += 1;
    if (key === 'item') {
      const list = repeatable.get(key) ?? [];
      list.push(value);
      repeatable.set(key, list);
    } else {
      if (options.has(key)) {
        throw new Error(`--${key} 重复给出`);
      }
      options.set(key, value);
    }
  }
  return { positional, options, repeatable };
}

function readInt(options: Map<string, string>, key: string, min: number, max: number): number | null {
  const raw = options.get(key);
  if (raw === undefined) {
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--${key} 必须是整数，收到 ${raw}`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new Error(`--${key} 必须在 ${min}..${max} 之间，收到 ${value}`);
  }
  return value;
}

function requireOption(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (value === undefined || value.trim() === '') {
    throw new Error(`缺少 --${key}`);
  }
  return value.trim();
}

/** `2026-12-31` = 当天 UTC 结束；其他形式按 ISO 解析。返回 null 表示不过期 */
function parseExpiresAt(raw: string | undefined): Date | null {
  return raw === undefined ? null : parseRedeemExpiresAt(raw);
}

/** 校验 create 的参数并组装成 createRedeemBatch 的输入（与库无关） */
function buildCreateInput(args: ParsedArgs): {
  name: string;
  kind: RedeemBatchKind;
  rewards: RedeemRewards;
  maxRedemptions: number | null;
  expiresAt: Date | null;
  count: number;
} {
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
    expiresAt: parseExpiresAt(options.get('expires')),
    count,
  };
}

function formatDate(date: Date | null): string {
  if (!date) {
    return '不过期';
  }
  return date.toISOString();
}

async function create(pool: ReturnType<typeof createPool>, args: ParsedArgs): Promise<void> {
  const input = buildCreateInput(args);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await createRedeemBatch(client, input);
    await client.query('COMMIT');
    console.log(`批次 id：${created.batchId}`);
    console.log(
      `名称：${input.name}　类型：${input.kind}　奖励：${formatRedeemRewards(input.rewards)}　过期：${formatDate(input.expiresAt)}` +
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

// list 的列宽（按终端显示宽度估算：中日韩字符算 2，其余算 1）
const LIST_WIDTHS = [36, 20, 8, 28, 14, 26, 8];

function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 2 : 1;
  }
  return width;
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(1, width - displayWidth(text)));
}

async function list(pool: ReturnType<typeof createPool>): Promise<void> {
  const batches = await listRedeemBatches(pool);
  if (batches.length === 0) {
    console.log('还没有兑换码批次');
    return;
  }
  const header = ['批次 id', '名称', '类型', '奖励', '已兑换/总数', '过期时间', '状态'];
  console.log(header.map((cell, index) => pad(cell, LIST_WIDTHS[index])).join(''));
  for (const batch of batches) {
    // 通用码的总数是人数上限，一次性码的总数是生成了多少个码
    const total = batch.kind === 'shared' ? (batch.maxRedemptions ?? 0) : batch.codeCount;
    const row = [
      batch.id,
      batch.name,
      batch.kind,
      formatRedeemRewards(batch.rewards),
      `${batch.claimCount}/${total}`,
      formatDate(batch.expiresAt),
      batch.disabled ? '已停用' : '启用中',
    ];
    console.log(row.map((cell, index) => pad(cell, LIST_WIDTHS[index])).join(''));
  }
}

async function exportCodes(pool: ReturnType<typeof createPool>, args: ParsedArgs): Promise<void> {
  const batchId = requireOption(args.options, 'batch');
  const batch = await loadRedeemBatch(pool, batchId);
  if (!batch) {
    throw new Error(`找不到批次 ${batchId}`);
  }
  const codes = await listRedeemCodes(pool, batchId);
  // CSV：码用显示格式（带横线，运营直接发给玩家），每行一个
  console.log('code');
  for (const code of codes) {
    console.log(formatRedeemCode(code));
  }
  console.error(`批次 ${batch.name}（${batchId}）：导出 ${codes.length} 个码${batch.disabled ? '（已停用）' : ''}`);
}

async function disable(pool: ReturnType<typeof createPool>, args: ParsedArgs): Promise<void> {
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

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return;
  }
  const args = command === 'list' ? { positional: [], options: new Map(), repeatable: new Map() } : parseArgs(rest);
  const pool = createPool('slg-redeem-codes', 2, { maintenance: true });
  try {
    await ensureSchema(pool);
    switch (command) {
      case 'create':
        await create(pool, args);
        break;
      case 'list':
        await list(pool);
        break;
      case 'export':
        await exportCodes(pool, args);
        break;
      case 'disable':
        await disable(pool, args);
        break;
      default:
        throw new Error(`未知子命令 ${command}`);
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    console.error(USAGE);
    process.exitCode = 1;
  });
}