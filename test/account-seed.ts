// 预建测试账号（v48 起密码登录不再自动注册，新用户名走 LOGIN 只会拿到 SIGNUP_CLOSED）：
// 用后端同一套建号逻辑（insertAccountWithCity）直插数据库，再走真实 LOGIN。
// Playwright e2e（test/e2e）与 node 联调（test/wechat、test/github）共用；
// pg 取自 backend 的依赖（同 test/wechat/harness.ts 的 createRequire 模式）。

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hashPassword } from '../backend/api/src/password';
import { insertAccountWithCity } from '../backend/api/src/auth';

const backendDir = path.resolve(__dirname, '../backend');
const requireFromBackend = createRequire(path.join(backendDir, 'package.json'));
const pg = requireFromBackend('pg') as typeof import('pg');

/** 测试连的数据库：与 api 进程同一个（进程环境优先，否则读 backend/.env） */
export function databaseUrl(): string {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }
  const env = readFileSync(path.join(backendDir, '.env'), 'utf8');
  const line = env.split('\n').find((item) => item.trim().startsWith('DATABASE_URL='));
  if (!line) {
    throw new Error('预建账号需要 DATABASE_URL（环境变量或 backend/.env）');
  }
  return line.trim().slice('DATABASE_URL='.length).replace(/^["']|["']$/g, '');
}

/** 预建测试账号；同名已存在时视为成功（对同一账号可重复调用） */
export async function seedAccount(username: string, password: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertAccountWithCity(client, { username, passwordHash: await hashPassword(password), signupIp: null });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    if ((err as { code?: string }).code !== '23505') {
      throw err;
    }
  } finally {
    client.release();
    await pool.end();
  }
}
