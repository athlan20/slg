// OAuth 授权 state 与一次性登录码的内存存储（AISLG-128，形态对齐 wx-tickets.ts）：
// - state：网页 GITHUB_AUTH_START 时生成，10 分钟有效、一次性（回调用 take 消耗）；
// - 一次性登录码：回调成功后生成，60 秒有效、一次性（网页 OAUTH_REDEEM 用 take 消耗），
//   会话令牌不进浏览器地址栏 / 服务器日志，短时效一次性码泄露风险小得多。
// 只存 API 进程内存（与微信 ticket 同前提：API 单进程部署），API 重启只会让进行中的
// 授权失败，玩家重新点一次即可。本文件只管状态与规则（时间可注入），不碰数据库、
// HTTP 与帧收发，便于单元测试。

import { randomBytes } from 'node:crypto';

export type OauthPurpose = 'login' | 'bind';

export interface OauthState {
  state: string;
  purpose: OauthPurpose;
  /** bind 用途：发起授权的连接所登录的账号；login 为 null */
  accountId: string | null;
  /** 发起站点 Host（v47 双站点）：回调按它选 GitHub 配置套并跳回对应前端 */
  host: string | null;
  createdAt: number;
  expiresAt: number;
}

/** 一次性登录码承载的信息：OAUTH_REDEEM 成功后据此签发会话 */
export interface OauthCodePayload {
  accountId: string;
  username: string;
  /** 回调时是否新建了账号（透传给网页提示「已自动建号」） */
  created: boolean;
}

/** state 有效期：给玩家在 GitHub 页面里操作的余量 */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
/** 一次性登录码有效期：回跳页面到发 OAUTH_REDEEM 之间的一小段 */
export const OAUTH_CODE_TTL_MS = 60 * 1000;

function randomToken(): string {
  return randomBytes(24).toString('base64url');
}

export class OauthStateStore {
  private entries = new Map<string, OauthState>();

  constructor(
    private readonly ttlMs: number = OAUTH_STATE_TTL_MS,
    private readonly makeState: () => string = randomToken,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** 生成新 state（同账号可并存多个：玩家可能开了多个标签页） */
  create(purpose: OauthPurpose, accountId: string | null, now: number, host: string | null = null): OauthState {
    const entry: OauthState = {
      state: this.makeState(),
      purpose,
      accountId,
      host,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.entries.set(entry.state, entry);
    return entry;
  }

  /** 读取未过期的 state；过期的顺手删除（不消耗） */
  peek(state: string, now: number): OauthState | null {
    const entry = this.entries.get(state);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= now) {
      this.entries.delete(state);
      return null;
    }
    return entry;
  }

  /** 核对并作废 state（一次性）：成功即删除，重复回调 / 篡改拿到 null */
  take(state: string, now: number): OauthState | null {
    const entry = this.peek(state, now);
    if (entry) {
      this.entries.delete(state);
    }
    return entry;
  }

  /** 清理已过期的条目，避免 Map 无限增长（由定时器调用） */
  sweep(now: number): void {
    for (const [state, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(state);
      }
    }
  }
}

export class OneTimeCodeStore {
  private entries = new Map<string, { payload: OauthCodePayload; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number = OAUTH_CODE_TTL_MS,
    private readonly makeCode: () => string = randomToken,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  /** 生成一次性登录码 */
  create(payload: OauthCodePayload, now: number): string {
    const code = this.makeCode();
    this.entries.set(code, { payload, expiresAt: now + this.ttlMs });
    return code;
  }

  /** 核对并作废登录码（一次性）：成功即删除并返回载荷；无效 / 过期 / 已用过为 null */
  take(code: string, now: number): OauthCodePayload | null {
    const entry = this.entries.get(code);
    if (!entry) {
      return null;
    }
    this.entries.delete(code);
    if (entry.expiresAt <= now) {
      return null;
    }
    return entry.payload;
  }

  sweep(now: number): void {
    for (const [code, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(code);
      }
    }
  }
}
