// 登录 / 会话令牌的账号逻辑。
// 规则（docs/phase-1-mvp.md「账号与登录」）：
// - 密码登录只对已有账号：用户名不存在返回 SIGNUP_CLOSED（v48 起关闭密码通道自动注册，
//   新账号只能经第三方登录创建：Google / GitHub / 微信扫码，见 oauth-accounts.ts / wx-accounts.ts）；
// - 已存在的用户名必须验证原密码。
// 会话令牌（长期登录，协议 v2）：
// - 密码登录成功后签发随机令牌，库里只存 SHA-256 哈希（库泄露不泄露可用令牌）；
// - 令牌登录按哈希查会话并滑动续期（每次使用把过期时间推到 now + TTL）；
// - LOGOUT 删除会话行即吊销，影响使用同一令牌的所有连接。
// 一账号多会话（浏览器 / Agent 各持一令牌），不能做成每账号单令牌互相顶替。
// v43：sessions.kind 区分浏览器会话（login）与玩家手动签发给 Agent 的令牌（agent_token）；
// 纯微信账号没有密码（password_hash 为空），密码登录对它们一律 INVALID_CREDENTIALS。
// v46（AISLG-129）：Agent 专用令牌改为每账号一个永久令牌（agent_tokens 表，sk_ 前缀，
// 登录在 handlers-auth.ts 先查 sessions 再查它）；sessions 的 agent_token 体系已废弃清空。

import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { INITIAL_BUILDINGS, INITIAL_POPULATION, INITIAL_RESOURCES } from '../../common/src/rules';
import { newbieUntilFrom } from '../../common/src/protection';
import { claimCityTile } from '../../common/src/world-db';
import { generateAgentToken, hashAgentToken } from './agent-token';
import { verifyPassword } from './password';

/** 会话默认有效期（秒）：30 天占位决策，滑动续期；调整入口在本文件 */
export const SESSION_TTL_SECONDS = 30 * 24 * 3600;

export interface LoginResult {
  ok: boolean;
  /** ok = false 时的错误码 */
  code?: 'INVALID_CREDENTIALS' | 'SIGNUP_CLOSED';
  /** ok = true 时的账号信息 */
  account?: { id: string; username: string };
}

/** 密码登录（仅玩家：Agent 禁用密码登录，在上层已拒；用户名不存在 = SIGNUP_CLOSED，v48 起不再自动注册） */
export async function loginWithPassword(
  pool: pg.Pool,
  input: { username: string; password: string; signupIp: string | null },
): Promise<LoginResult> {
  const existing = await pool.query(
    'SELECT id, username, password_hash FROM accounts WHERE username = $1',
    [input.username],
  );
  if (!existing.rowCount) {
    return { ok: false, code: 'SIGNUP_CLOSED' };
  }
  const row = existing.rows[0];
  // 纯微信 / 纯第三方账号没有密码：不能让人对它「首次设密码」就把号占了
  const valid = row.password_hash !== null && (await verifyPassword(input.password, row.password_hash));
  if (!valid) {
    return { ok: false, code: 'INVALID_CREDENTIALS' };
  }
  return { ok: true, account: { id: row.id, username: row.username } };
}

/**
 * 在调用方的事务里建账号与初始主城（密码注册与微信自动建号共用，事务由调用方开启 / 提交）。
 * passwordHash 为 null = 纯微信账号。用户名冲突抛 pg 23505，由调用方决定处理。
 */
export async function insertAccountWithCity(
  client: pg.PoolClient,
  input: { username: string; passwordHash: string | null; signupIp: string | null },
): Promise<{ id: string; username: string }> {
  const ins = await client.query(
    `INSERT INTO accounts (username, password_hash, signup_ip, newbie_until) VALUES ($1, $2, $3::inet, $4)
     RETURNING id, username`,
    [input.username, input.passwordHash, input.signupIp, newbieUntilFrom(new Date())],
  );
  const account = ins.rows[0];
  // 开号之初（rules.ts 的 INITIAL_* 常量）：初始资源与人口、自带建筑（1 级官府）
  const city = await client.query(
    `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, population)
     VALUES ($1, '主城', $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      account.id,
      INITIAL_RESOURCES.gold,
      INITIAL_RESOURCES.wood,
      INITIAL_RESOURCES.food,
      INITIAL_RESOURCES.stone,
      INITIAL_RESOURCES.iron,
      INITIAL_POPULATION,
    ],
  );
  for (const [kind, level] of Object.entries(INITIAL_BUILDINGS)) {
    await client.query(
      `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, $2, $3)`,
      [city.rows[0].id, kind, level],
    );
  }
  // v12：主城在世界中分配地块（出生区中心附近的空闲野地；世界由 API 启动时生成）
  await claimCityTile(client, city.rows[0].id as string);
  // v46（AISLG-129）：建号即生成永久 Agent 令牌（所有建号方式共用本函数；老账号惰性补）
  const agentToken = generateAgentToken();
  await client.query(
    `INSERT INTO agent_tokens (account_id, token_hash, token) VALUES ($1, $2, $3)`,
    [account.id, hashAgentToken(agentToken), agentToken],
  );
  return { id: account.id, username: account.username };
}

// ---- 会话令牌 ----

/** 生成 256 位随机会话令牌（base64url，43 字符） */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

/** 令牌的库内存储形式：SHA-256 十六进制（令牌明文只出现在给客户端的响应里） */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export interface IssuedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

/** 会话种类：浏览器登录会话 / 玩家签发给 Agent 的令牌（v43） */
export type SessionKind = 'login' | 'agent_token';

/** 为账号签发新会话；顺带清理全局已过期会话行（第一期会话表规模小，全局清理足够） */
export async function issueSessionToken(
  pool: pg.Pool,
  accountId: string,
  options: { kind?: SessionKind; label?: string | null } = {},
): Promise<IssuedSession> {
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  const token = generateSessionToken();
  const res = await pool.query(
    `INSERT INTO sessions (account_id, token_hash, expires_at, kind, label)
     VALUES ($1, $2, now() + make_interval(secs => $3), $4, $5)
     RETURNING id, expires_at`,
    [accountId, hashSessionToken(token), SESSION_TTL_SECONDS, options.kind ?? 'login', options.label ?? null],
  );
  return { sessionId: res.rows[0].id, token, expiresAt: res.rows[0].expires_at };
}

export interface ResolvedSession {
  sessionId: string;
  account: { id: string; username: string };
  expiresAt: Date;
}

/** 令牌登录：按哈希查会话与账号；未命中或已过期返回 null，命中则滑动续期并返回新过期时间 */
export async function resolveSessionToken(
  pool: pg.Pool,
  token: string,
): Promise<ResolvedSession | null> {
  const select = await pool.query(
    `SELECT s.id AS session_id, a.id AS account_id, a.username
     FROM sessions s JOIN accounts a ON a.id = s.account_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashSessionToken(token)],
  );
  if (!select.rowCount) {
    return null;
  }
  const row = select.rows[0];
  const renew = await pool.query(
    `UPDATE sessions SET last_used_at = now(), expires_at = now() + make_interval(secs => $2)
     WHERE id = $1 RETURNING expires_at`,
    [row.session_id, SESSION_TTL_SECONDS],
  );
  return {
    sessionId: row.session_id,
    account: { id: row.account_id, username: row.username },
    expiresAt: renew.rows[0].expires_at,
  };
}

/** 吊销会话（LOGOUT）；幂等，会话不存在时静默成功 */
export async function revokeSession(pool: pg.Pool, sessionId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}
