// 微信身份与账号的数据库操作（docs/wechat-qr-login.md「确认时的账号处理」）：
// - login：openid 已绑定 → 返回绑定的账号；没绑定 → 一个事务里建账号 + 初始城池 + 写 wechat_identities；
// - bind：当前账号没绑过微信、这个 openid 也没被占用才写入。
// 建号逻辑复用 auth.ts 的 insertAccountWithCity，不另写一套。

import { randomInt } from 'node:crypto';
import pg from 'pg';
import { insertAccountWithCity } from './auth';

export interface WechatIdentityInput {
  appId: string;
  openid: string;
  unionid: string | null;
}

export interface WechatLoginAccount {
  id: string;
  username: string;
  /** 本次是否新建了账号 */
  created: boolean;
}

/** 新号用户名：wx_ + 6 位 base36 随机串（如 wx_8f3k2a） */
export function randomWechatUsername(): string {
  let tail = '';
  for (let i = 0; i < 6; i += 1) {
    tail += randomInt(36).toString(36);
  }
  return `wx_${tail}`;
}

/** 随机用户名 / 并发建号冲突时的最多尝试次数 */
const MAX_CREATE_ATTEMPTS = 6;

export async function findAccountByOpenid(
  pool: pg.Pool,
  appId: string,
  openid: string,
): Promise<{ id: string; username: string } | null> {
  const res = await pool.query(
    `SELECT a.id, a.username FROM wechat_identities w JOIN accounts a ON a.id = w.account_id
     WHERE w.app_id = $1 AND w.openid = $2`,
    [appId, openid],
  );
  return res.rowCount ? { id: res.rows[0].id, username: res.rows[0].username } : null;
}

export async function accountHasWechat(pool: pg.Pool, appId: string, accountId: string): Promise<boolean> {
  const res = await pool.query(`SELECT 1 FROM wechat_identities WHERE app_id = $1 AND account_id = $2`, [
    appId,
    accountId,
  ]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * 微信登录：找到绑定账号，或自动建号。碰到唯一约束冲突（随机用户名撞了，或同一个微信被两个 ticket 并发确认）
 * 就回头重新查再试——后一种情况第二轮会直接查到先建好的账号。
 */
export async function loginWithWechat(
  pool: pg.Pool,
  identity: WechatIdentityInput,
  signupIp: string | null,
  makeUsername: () => string = randomWechatUsername,
): Promise<WechatLoginAccount> {
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const existing = await findAccountByOpenid(pool, identity.appId, identity.openid);
    if (existing) {
      return { ...existing, created: false };
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const account = await insertAccountWithCity(client, {
        username: makeUsername(),
        passwordHash: null,
        signupIp,
      });
      await client.query(
        `INSERT INTO wechat_identities (account_id, app_id, openid, unionid) VALUES ($1, $2, $3, $4)`,
        [account.id, identity.appId, identity.openid, identity.unionid],
      );
      await client.query('COMMIT');
      return { ...account, created: true };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((err as { code?: string }).code !== '23505') {
        throw err;
      }
    } finally {
      client.release();
    }
  }
  throw new Error('wechat account creation kept conflicting');
}

/** 绑定微信：当前账号没绑过、这个 openid 也没被占用才成功；否则 already_bound（含并发抢绑） */
export async function bindWechat(
  pool: pg.Pool,
  accountId: string,
  identity: WechatIdentityInput,
): Promise<'ok' | 'already_bound'> {
  try {
    await pool.query(
      `INSERT INTO wechat_identities (account_id, app_id, openid, unionid) VALUES ($1, $2, $3, $4)`,
      [accountId, identity.appId, identity.openid, identity.unionid],
    );
    return 'ok';
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return 'already_bound';
    }
    throw err;
  }
}
