// Linux.do Connect OAuth：令牌只用于本次用户信息请求，绝不持久化或记录。
export interface LinuxdoConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  frontendUrl: string;
  apiBase: string;
}

export class LinuxdoError extends Error {
  constructor(readonly kind: 'code_invalid' | 'unavailable' | 'not_eligible') {
    super(kind);
  }
}

export function readLinuxdoMinTrustLevel(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.LINUXDO_MIN_TRUST_LEVEL?.trim();
  if (!raw) return 1;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export function createLinuxdoClient(config: LinuxdoConfig, minTrustLevel: number, fetchFn: typeof fetch = fetch) {
  async function call(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchFn(url, { ...init, signal: AbortSignal.timeout(8000) });
    } catch {
      throw new LinuxdoError('unavailable');
    }
  }
  return {
    clientId: config.clientId,
    authorizeUrl(state: string): string {
      const query = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: config.redirectUri, state, scope: 'user' });
      return `${config.apiBase}/oauth2/authorize?${query}`;
    },
    async exchangeCode(code: string): Promise<{ id: string; login: string }> {
      const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.redirectUri });
      const response = await call(`${config.apiBase}/oauth2/token`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
      const token = await response.json().catch(() => null) as { access_token?: unknown; error?: unknown } | null;
      if (!response.ok || typeof token?.access_token !== 'string' || !token.access_token) {
        throw new LinuxdoError(token?.error === 'invalid_grant' ? 'code_invalid' : 'unavailable');
      }
      const userResponse = await call(`${config.apiBase}/api/user`, { headers: { accept: 'application/json', authorization: `Bearer ${token.access_token}` } });
      if (!userResponse.ok) throw new LinuxdoError('unavailable');
      const user = await userResponse.json().catch(() => null) as Record<string, unknown> | null;
      if (!user || typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0 ||
          typeof user.username !== 'string' || !user.username.trim() ||
          typeof user.trust_level !== 'number' || !Number.isSafeInteger(user.trust_level) || user.trust_level < 0 ||
          typeof user.active !== 'boolean' || typeof user.silenced !== 'boolean') {
        throw new LinuxdoError('unavailable');
      }
      if (user.trust_level < minTrustLevel || !user.active || user.silenced) throw new LinuxdoError('not_eligible');
      return { id: String(user.id), login: user.username };
    },
  };
}
