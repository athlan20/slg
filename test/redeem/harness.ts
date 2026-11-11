// 兑换码联调设施（AISLG-253，v109）：真实 API 进程（临时端口）+ 真实运营脚本（子进程）+ 极简 WebSocket 客户端。
// 运营脚本用与线上同一条命令跑（npx tsx scripts/redeem-codes.ts ...），输出解析出来当玩家手里的码，
// 这样「脚本生成的码 → 玩家 WS 兑换」走的是真实链路，不是测试里直接插库。
// DATABASE_URL 必须显式给出（**不要**退回 backend/.env 的共用库；建议用临时集群，见 test/README.md）。

import assert from 'node:assert/strict';
import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import type { Client as WsClient } from '../wechat/harness';

const run = promisify(execFile);
const backendDir = path.resolve(__dirname, '../../backend');
const requireFromBackend = createRequire(path.join(backendDir, 'package.json'));
const pg = requireFromBackend('pg') as typeof import('pg');

export { Client } from '../wechat/harness';
export type { Client as WsClient, Frame } from '../wechat/harness';

/** v109 用到的协议号（与 common/src/protocol.ts 一致；测试里写死，防止客户端偷偷跟着服务端改） */
export const Op = {
  LOGIN: 1,
  GET_STATE: 10,
  REDEEM_CODE: 156,
  GET_AGENT_TOKEN: 64,
} as const;

export interface Harness {
  apiPort: number;
  connect: () => Promise<WsClient>;
  stop: () => void;
}

export interface HarnessOptions {
  apiPort: number;
}

/** 起真实 API 进程，等 /health 就绪；调用方负责 stop() */
export async function startHarness(options: HarnessOptions): Promise<Harness> {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, '需要 DATABASE_URL（指向临时库）');
  const api: ChildProcess = spawn('npx', ['tsx', '--env-file=.env', 'api/src/index.ts'], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: databaseUrl, PORT: String(options.apiPort), HOST: '127.0.0.1', LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${options.apiPort}/health`)).ok) {
        break;
      }
    } catch {
      // 还没起来
    }
    assert.ok(Date.now() < deadline, 'API 进程启动超时');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const { Client } = await import('../wechat/harness');
  const opened: Array<{ close: () => void }> = [];
  return {
    apiPort: options.apiPort,
    async connect() {
      const client = await Client.connect(options.apiPort);
      opened.push(client);
      return client;
    },
    stop() {
      opened.forEach((client) => client.close());
      api.kill('SIGTERM');
    },
  };
}

/** 跑一次运营脚本（与运维用同一条命令），返回标准输出 */
export async function runScript(args: string[]): Promise<string> {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, '需要 DATABASE_URL（指向临时库）');
  const { stdout } = await run('npx', ['tsx', '--env-file=.env', 'scripts/redeem-codes.ts', ...args], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

export interface CreatedBatch {
  batchId: string;
  /** 显示形式（XXXX-XXXX-XXXX-XXXX），与运营发给玩家的一样 */
  codes: string[];
  output: string;
}

/** 从 create 的输出里解析批次 id 与码清单 */
function parseCreateOutput(output: string): CreatedBatch {
  const lines = output.split('\n').map((line) => line.trim());
  const idLine = lines.find((line) => line.startsWith('批次 id：'));
  assert.ok(idLine, `create 输出里没有批次 id：\n${output}`);
  const batchId = idLine.slice('批次 id：'.length).trim();
  const codes = lines.filter((line) => /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(line));
  return { batchId, codes, output };
}

/** 用运营脚本生成一个批次（create），返回批次 id 与码 */
export async function createBatch(args: string[]): Promise<CreatedBatch> {
  return parseCreateOutput(await runScript(['create', ...args]));
}

/** 用运营脚本 list 的输出（运维看到的「已兑换/总数」就在里面） */
export async function listBatches(): Promise<string> {
  return runScript(['list']);
}

/** 用运营脚本 export 的输出（CSV：header + 每行一个码） */
export async function exportBatch(batchId: string): Promise<string[]> {
  const stdout = await runScript(['export', '--batch', batchId]);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(line));
}

/** 用运营脚本停用批次 */
export async function disableBatch(batchId: string): Promise<string> {
  return runScript(['disable', '--batch', batchId]);
}

/** 直连数据库读兑换尝试记录（验证限流的落库结果） */
export async function countAttemptRows(accountId: string): Promise<{ ok: number; failed: number }> {
  const databaseUrl = process.env.DATABASE_URL as string;
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const res = await pool.query(
      `SELECT ok, count(*) AS count FROM redeem_attempts WHERE account_id = $1 GROUP BY ok`,
      [accountId],
    );
    const result = { ok: 0, failed: 0 };
    for (const row of res.rows as Array<{ ok: boolean; count: string }>) {
      if (row.ok) {
        result.ok = Number(row.count);
      } else {
        result.failed = Number(row.count);
      }
    }
    return result;
  } finally {
    await pool.end();
  }
}