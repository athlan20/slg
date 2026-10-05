// 第三方 OAuth 身份与账号的数据库操作（v44 Google / v45 GitHub 共用，表 oauth_identities）：
// - login：subject 已绑定 → 返回绑定的账号；没绑定 → 一个事务里建账号 + 初始城池 + 写 oauth_identities；
// - bind：当前账号在该 provider 没绑过、这个 subject 也没被占用才写入。
// 建号逻辑复用 auth.ts 的 insertAccountWithCity（已含新手保护截止），不另写一套。
// 用户标识用各 provider 的永久 subject（Google sub / GitHub 数字 id），display_name 仅展示存档。

import { randomInt } from 'node:crypto';
import pg from 'pg';
import { insertAccountWithCity } from './auth';

/** 支持的第三方登录提供商（oauth_identities.provider 的取值） */
export type OauthProvider = 'google' | 'github';

export interface OauthIdentityInput {
  provider: OauthProvider;
  /** 提供商内唯一的用户标识（Google sub / GitHub 数字 id），永不变 */
  subject: string;
  /** 展示名（Google email / GitHub login），可变、仅存档 */
  displayName: string | null;
}

export interface OauthLoginAccount {
  id: string;
  username: string;
  /** 本次是否新建了账号 */
  created: boolean;
}

/** 新号用户名：<前缀>_ + 6 位 base36 随机串（如 g_8f3k2a / gh_8f3k2a） */
export function randomOauthUsername(prefix: string): string {
  let tail = '';
  for (let i = 0; i < 6; i += 1) {
    tail += randomInt(36).toString(36);
  }
  return `${prefix}_${tail}`;
}

/** 随机用户名 / 并发建号冲突时的最多尝试次数 */
const MAX_CREATE_ATTEMPTS = 6;

export async function findAccountByOauth(
  pool: pg.Pool,
  provider: OauthProvider,
  subject: string,
): Promise<{ id: string; username: string } | null> {
  const res = await pool.query(
    `SELECT a.id, a.username FROM oauth_identities o JOIN accounts a ON a.id = o.account_id
     WHERE o.provider = $1 AND o.subject = $2`,
    [provider, subject],
  );
  return res.rowCount ? { id: res.rows[0].id, username: res.rows[0].username } : null;
}

/** 账号在某 provider 的展示名（未绑定为 null）；GET_AGENT_INFO 的 githubLogin 用 */
export async function oauthDisplayName(
  pool: pg.Pool,
  provider: OauthProvider,
  accountId: string,
): Promise<string | null> {
  const res = await pool.query(
    `SELECT display_name FROM oauth_identities WHERE provider = $1 AND account_id = $2`,
    [provider, accountId],
  );
  return res.rowCount ? res.rows[0].display_name : null;
}

export async function accountHasOauth(pool: pg.Pool, provider: OauthProvider, accountId: string): Promise<boolean> {
  const res = await pool.query(`SELECT 1 FROM oauth_identities WHERE provider = $1 AND account_id = $2`, [
    provider,
    accountId,
  ]);
  return (res.rowCount ?? 0) > 0;
}

/**
 * OAuth 登录：找到绑定账号，或自动建号。碰到唯一约束冲突（随机用户名撞了，或同一个
 * 第三方身份并发登录两次）就回头重新查再试——后一种情况第二轮会直接查到先建好的账号。
 */
export async function loginWithOauth(
  pool: pg.Pool,
  identity: OauthIdentityInput,
  signupIp: string | null,
  makeUsername: () => string = () => randomOauthUsername(identity.provider === 'github' ? 'gh' : 'g'),
): Promise<OauthLoginAccount> {
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
    const existing = await findAccountByOauth(pool, identity.provider, identity.subject);
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
        `INSERT INTO oauth_identities (account_id, provider, subject, display_name) VALUES ($1, $2, $3, $4)`,
        [account.id, identity.provider, identity.subject, identity.displayName],
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
  throw new Error('oauth account creation kept conflicting');
}

/** 绑定第三方身份：当前账号没绑过、这个 subject 也没被占用才成功；否则 already_bound（含并发抢绑） */
export async function bindOauth(
  pool: pg.Pool,
  accountId: string,
  identity: OauthIdentityInput,
): Promise<'ok' | 'already_bound'> {
  try {
    await pool.query(
      `INSERT INTO oauth_identities (account_id, provider, subject, display_name) VALUES ($1, $2, $3, $4)`,
      [accountId, identity.provider, identity.subject, identity.displayName],
    );
    return 'ok';
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return 'already_bound';
    }
    throw err;
  }
}
