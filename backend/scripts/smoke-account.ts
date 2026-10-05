// 冒烟测试账号预建（v48 起密码登录不再自动注册，新用户名走 LOGIN 只会拿到 SIGNUP_CLOSED）：
// 直连 DATABASE_URL（npm run smoke 经 --env-file=.env 注入），用后端同一套建号逻辑直插，
// 再走真实 LOGIN。表结构与世界由已启动的 API 幂等创建。

import pg from 'pg';
import { insertAccountWithCity } from '../api/src/auth';
import { hashPassword } from '../api/src/password';

export async function seedAccount(username: string, password: string): Promise<void> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertAccountWithCity(client, { username, passwordHash: await hashPassword(password), signupIp: null });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}
