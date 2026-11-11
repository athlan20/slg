// 运维脚本：兑换码的批量生成、查看、导出、停用，以及淘宝渠道配套（AISLG-253 + AISLG-255）。
// 没有网页后台，所有操作走这里。码只在 create 的输出与 export 里可见；库里存的是明文（规范化后的
// 16 位大写），数据库权限要按敏感数据对待。各子命令的实现分在 scripts/redeem/ 下，本文件只做分派。
//
// 运行（在 backend/ 目录）：
//   npx tsx --env-file=.env scripts/redeem-codes.ts create --name "11月补偿" --kind single --count 100 --ingot 500 --item city_order:2 --expires 2026-12-31
//   npx tsx --env-file=.env scripts/redeem-codes.ts create --name "淘宝-1000元宝-01" --kind single --count 500 --ingot 1000 --channel taobao
//   npx tsx --env-file=.env scripts/redeem-codes.ts list
//   npx tsx --env-file=.env scripts/redeem-codes.ts export --batch <id> [--format csv|txt] [--unused] > codes.txt
//   npx tsx --env-file=.env scripts/redeem-codes.ts lookup --code XXXX-XXXX-XXXX-XXXX
//   npx tsx --env-file=.env scripts/redeem-codes.ts void --code A --code B / void --file codes.txt
//   npx tsx --env-file=.env scripts/redeem-codes.ts stats --channel taobao [--since 2026-11-01] [--until 2026-11-30]
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
//   --channel <渠道>      create / stats：渠道标记（字母、数字、连字符，最长 20），如 taobao
//   --batch <id>          export / disable 的批次 id
//   --format csv|txt      export 的格式，缺省 csv；txt = 淘宝发货工具用（无表头，每行一个券号）
//   --unused              export：只导出还没兑换且没被作废的码
//   --code <券号>         lookup（一个）/ void（可重复）
//   --file <路径>         void：每行一个券号
//   --since / --until     stats：YYYY-MM-DD（UTC+8 自然日，含边界）
//
// 连库：与 scripts/ 下其他脚本一致（读 backend/.env 的 DATABASE_URL，进程环境变量优先）。
// 自测时用 DATABASE_URL 覆盖指向临时库，不要在需求目录直接连共用库。

import { createPool, ensureSchema } from '../common/src/db';
import { parseArgs, type ParsedArgs } from './redeem/args';import { create } from './redeem/create';
import { disable } from './redeem/disable';
import { exportCodes } from './redeem/export';
import { list } from './redeem/list';
import { lookup } from './redeem/lookup';
import { stats } from './redeem/stats';
import { voidCommand } from './redeem/void';

/** 脚本的 stdout 是给运营复制 / 直接导入淘宝发货工具的（export 出来的每一行都必须是券号），
 * 而诊断日志的 info 级是走 console.log 的（见 common/src/diag-log.ts）。所以本脚本默认关掉诊断，
 * 排查脚本本身的问题时用 `DIAG_LOG=1` 显式打开。 */
if (process.env.DIAG_LOG === undefined) {
  process.env.DIAG_LOG = '0';
}

const USAGE = [
  '用法：redeem-codes.ts <create|list|export|disable|lookup|void|stats> [选项]（见文件头注释）',
  '  create  --name "11月补偿" --kind single --count 100 --ingot 500 --item city_order:2 [--expires 2026-12-31] [--channel taobao]',
  '  create  --name "社群口令" --kind shared --max 200 --ingot 100 [--expires 2026-11-30]',
  '  list',
  '  export  --batch <id> [--format csv|txt] [--unused]',
  '  disable --batch <id>',
  '  lookup  --code <券号>',
  '  void    --code <券号> [--code ...] 或 --file <路径>',
  '  stats   --channel <渠道> [--since YYYY-MM-DD] [--until YYYY-MM-DD]',
].join('\n');

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return;
  }
  const args: ParsedArgs = parseArgs(rest);
  const pool = createPool('slg-redeem-codes', 2, { maintenance: true });
  try {
    await ensureSchema(pool);
    switch (command) {
      case 'create':
        await create(pool, args);
        break;
      case 'list':
        await list(pool, args);
        break;
      case 'export':
        await exportCodes(pool, args);
        break;
      case 'disable':
        await disable(pool, args);
        break;
      case 'lookup':
        if (!(await lookup(pool, args))) {
          process.exitCode = 1;
        }
        break;
      case 'void':
        if (!(await voidCommand(pool, args))) {
          process.exitCode = 1;
        }
        break;
      case 'stats':
        await stats(pool, args);
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
