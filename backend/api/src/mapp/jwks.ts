// Linux.do 微应用 JWKS 获取与公钥缓存（AISLG-261）。
// 从固定配置的社区地址拉取公钥，单进程内存缓存，定期刷新，未知 kid 限频强刷。

import { createHash, createPublicKey, type JsonWebKey, type KeyObject } from 'node:crypto';
import { MappAuthError } from './types';

export interface JwksOptions {
  issuer: string;
  fetchFn?: typeof fetch;
  cacheTtlMs?: number;
  retryBackoffMs?: number;
  forceRefreshCooldownMs?: number;
}

export function computeSpkiSha256(key: KeyObject): string {
  const der = key.export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('hex');
}

export function parseAndValidateJwk(jwk: unknown): { keyObject: KeyObject; kid: string; sha256: string } {
  const k = jwk as Record<string, unknown> | null;
  if (
    !k ||
    k.kty !== 'EC' ||
    k.crv !== 'P-256' ||
    k.alg !== 'ES256' ||
    k.use !== 'sig' ||
    typeof k.kid !== 'string' ||
    !k.kid ||
    typeof k.x !== 'string' ||
    !k.x ||
    typeof k.y !== 'string' ||
    !k.y ||
    Object.hasOwn(k, 'd')
  ) {
    throw new MappAuthError('Invalid community JWK');
  }

  const keyObject = createPublicKey({ key: k as JsonWebKey, format: 'jwk' });
  if (
    keyObject.asymmetricKeyType !== 'ec' ||
    keyObject.asymmetricKeyDetails?.namedCurve !== 'prime256v1'
  ) {
    throw new MappAuthError('Community JWK is not EC prime256v1');
  }

  const sha256 = computeSpkiSha256(keyObject);
  return { keyObject, kid: k.kid, sha256 };
}

export class JwksCache {
  private readonly issuer: string;
  private readonly fetchFn: typeof fetch;
  private readonly cacheTtlMs: number;
  private readonly retryBackoffMs: number;
  private readonly forceRefreshCooldownMs: number;

  private keysByKid = new Map<string, KeyObject>();
  private lastFetchAttemptAt = 0;
  private lastSuccessAt = 0;
  private refreshTimer: NodeJS.Timeout | null = null;
  private inFlightRefresh: Promise<void> | null = null;
  private stopped = false;

  constructor(options: JwksOptions) {
    this.issuer = options.issuer;
    this.fetchFn = options.fetchFn ?? fetch;
    this.cacheTtlMs = options.cacheTtlMs ?? 3600_000; // 1 小时定期刷新
    this.retryBackoffMs = options.retryBackoffMs ?? 15_000; // 失败后 15 秒短退避
    this.forceRefreshCooldownMs = options.forceRefreshCooldownMs ?? 10_000; // 未知 kid 强刷冷却 10 秒
  }

  get jwksUrl(): string {
    return `${this.issuer}/mini-app-api/jwks`;
  }

  async fetchJwks(): Promise<void> {
    this.lastFetchAttemptAt = Date.now();
    const response = await this.fetchFn(this.jwksUrl, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`JWKS fetch failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as { keys?: unknown[] } | null;
    if (!body || !Array.isArray(body.keys) || body.keys.length !== 1) {
      throw new MappAuthError('JWKS must contain exactly one public key');
    }

    const { keyObject, kid, sha256 } = parseAndValidateJwk(body.keys[0]);

    // 刷新成功：更新缓存
    this.keysByKid.set(kid, keyObject);
    this.keysByKid.set(sha256, keyObject);
    this.lastSuccessAt = Date.now();
  }

  async refresh(): Promise<void> {
    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }
    this.inFlightRefresh = this.fetchJwks()
      .catch((err) => {
        // 失败时保留旧密钥，打告警日志并等待下一次重试
        console.warn(`[mapp-jwks] Failed to refresh JWKS from ${this.jwksUrl}:`, err);
        throw err;
      })
      .finally(() => {
        this.inFlightRefresh = null;
        this.scheduleNext();
      });
    return this.inFlightRefresh;
  }

  private scheduleNext(delayMs?: number): void {
    if (this.stopped) return;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    const nextMs =
      delayMs !== undefined
        ? delayMs
        : this.lastSuccessAt > 0
          ? this.cacheTtlMs
          : this.retryBackoffMs;
    this.refreshTimer = setTimeout(() => {
      void this.refresh().catch(() => {
        this.scheduleNext(this.retryBackoffMs);
      });
    }, nextMs);
  }

  async getKey(kid: string): Promise<KeyObject | null> {
    const existing = this.keysByKid.get(kid);
    if (existing) {
      return existing;
    }

    // 缓存未命中：若未在冷却期内且未停止，发起一次合并并发的强刷
    const now = Date.now();
    const elapsed = now - this.lastFetchAttemptAt;
    if (elapsed >= this.forceRefreshCooldownMs && !this.stopped) {
      try {
        await this.refresh();
      } catch {
        // 刷新失败时忽略错误，退回现有缓存查
      }
    }

    return this.keysByKid.get(kid) ?? null;
  }

  /** 手动注入已知公钥（单测或静态提供） */
  setKey(kid: string, keyObject: KeyObject): void {
    this.keysByKid.set(kid, keyObject);
    const sha256 = computeSpkiSha256(keyObject);
    this.keysByKid.set(sha256, keyObject);
    this.lastSuccessAt = Date.now();
  }

  stop(): void {
    this.stopped = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}
