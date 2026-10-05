// 每账号一个永久 Agent 令牌（v46，AISLG-129）：建号时生成、永不过期、原文可反复显示
//（复制给 AI 的提示词里自动带上）。格式 sk_ + 32 字节随机数（base64url），前缀便于识别与日志脱敏。
// 登录按 token_hash（SHA-256）查——与 sessions.token_hash 同算法但各自建表索引，互不相干。
// 老账号（建表前注册）没有令牌：GET_AGENT_TOKEN 惰性补一个（ensureAgentToken）。

import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';

export const AGENT_TOKEN_PREFIX = 'sk_';

export function generateAgentToken(): string {
  return AGENT_TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

/** 令牌的库内索引形式（登录查询用；原文单独一列，供再显示） */
export function hashAgentToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface AgentTokenRow {
  id: string;
  accountId: string;
  username: string;
  token: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

interface RawRow {
  id: string;
  account_id: string;
  username: string;
  token: string;
  created_at: Date;
  last_used_at: Date | null;
}

const SELECT_COLUMNS = `t.id, t.account_id, a.username, t.token, t.created_at, t.last_used_at`;
const fromRow = (row: RawRow): AgentTokenRow => ({
  id: row.id,
  accountId: row.account_id,
  username: row.username,
  token: row.token,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

/** 登录：按令牌哈希查（联表取 username）；不存在返回 null */
export async function findAgentTokenByToken(pool: pg.Pool, token: string): Promise<AgentTokenRow | null> {
  const res = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM agent_tokens t JOIN accounts a ON a.id = t.account_id
     WHERE t.token_hash = $1`,
    [hashAgentToken(token)],
  );
  return res.rowCount ? fromRow(res.rows[0]) : null;
}

/** 读取账号令牌，没有就补生成（老账号惰性补；并发补生成时靠唯一约束回落重查） */
export async function ensureAgentToken(pool: pg.Pool, accountId: string): Promise<AgentTokenRow> {
  const select = async (): Promise<AgentTokenRow | null> => {
    const res = await pool.query(
      `SELECT ${SELECT_COLUMNS} FROM agent_tokens t JOIN accounts a ON a.id = t.account_id
       WHERE t.account_id = $1`,
      [accountId],
    );
    return res.rowCount ? fromRow(res.rows[0]) : null;
  };
  const existing = await select();
  if (existing) {
    return existing;
  }
  const token = generateAgentToken();
  try {
    await pool.query(
      `INSERT INTO agent_tokens (account_id, token_hash, token) VALUES ($1, $2, $3)`,
      [accountId, hashAgentToken(token), token],
    );
  } catch (err) {
    if ((err as { code?: string }).code !== '23505') {
      throw err;
    }
  }
  const ensured = await select();
  if (!ensured) {
    throw new Error('agent token ensure failed');
  }
  return ensured;
}

/**
 * 重置：换一个新的随机令牌（不支持自填）。返回新行与旧行 id——旧行 id 用于断开
 * 正在用旧令牌登录的在线连接。账号从没有过令牌时（理论上不该发生）等同补生成。
 */
export async function replaceAgentToken(pool: pg.Pool, accountId: string): Promise<{ fresh: AgentTokenRow; oldId: string | null }> {
  const existing = await pool.query(`SELECT id FROM agent_tokens WHERE account_id = $1`, [accountId]);
  const oldId: string | null = existing.rowCount ? existing.rows[0].id : null;
  const token = generateAgentToken();
  const res = await pool.query(
    `INSERT INTO agent_tokens (account_id, token_hash, token)
     VALUES ($1, $2, $3)
     ON CONFLICT (account_id) DO UPDATE
       SET token_hash = EXCLUDED.token_hash, token = EXCLUDED.token, created_at = now(), last_used_at = NULL
     RETURNING id`,
    [accountId, hashAgentToken(token), token],
  );
  const fresh = await ensureAgentToken(pool, accountId);
  // ON CONFLICT 更新保留原行 id：旧令牌登录的连接 sessionId 就是它，按 id 断开依然正确
  return { fresh, oldId };
}

/** 令牌登录成功后记录最近使用（不阻塞登录流程，失败忽略） */
export async function touchAgentToken(pool: pg.Pool, tokenId: string): Promise<void> {
  await pool.query(`UPDATE agent_tokens SET last_used_at = now() WHERE id = $1`, [tokenId]).catch(() => undefined);
}
