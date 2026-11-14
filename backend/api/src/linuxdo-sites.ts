import type { LinuxdoConfig } from './linuxdo';
import { normalizeHost } from './site-config';

export interface LinuxdoSites {
  byHost: Map<string, LinuxdoConfig>;
  defaultSite: LinuxdoConfig | null;
}

function parseSite(raw: unknown): LinuxdoConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const text = (key: string): string => typeof obj[key] === 'string' ? (obj[key] as string).trim() : '';
  const clientId = text('clientId');
  const clientSecret = text('clientSecret');
  const redirectUri = text('redirectUri');
  const frontendUrl = text('frontendUrl').replace(/\/+$/, '');
  if (!clientId || !clientSecret || !redirectUri || !frontendUrl) return null;
  return { clientId, clientSecret, redirectUri, frontendUrl, apiBase: (text('apiBase') || 'https://connect.linux.do').replace(/\/+$/, '') };
}

export function readLinuxdoSites(env: NodeJS.ProcessEnv = process.env): LinuxdoSites {
  const byHost = new Map<string, LinuxdoConfig>();
  if (env.LINUXDO_SITES?.trim()) {
    try {
      const parsed: unknown = JSON.parse(env.LINUXDO_SITES);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected object');
      for (const [key, raw] of Object.entries(parsed)) {
        const host = key === 'default' ? key : normalizeHost(key);
        const site = parseSite(raw);
        if (host && site) byHost.set(host, site);
      }
    } catch {
      console.error('LINUXDO_SITES 解析失败（应为 JSON，键为 Host）');
    }
  }
  const legacy = parseSite({ clientId: env.LINUXDO_CLIENT_ID, clientSecret: env.LINUXDO_CLIENT_SECRET, redirectUri: env.LINUXDO_REDIRECT_URI, frontendUrl: env.FRONTEND_URL, apiBase: env.LINUXDO_API_BASE });
  const defaultSite = byHost.get('default') ?? legacy;
  if (defaultSite) byHost.set('default', defaultSite);
  return { byHost, defaultSite };
}

export function linuxdoSiteFor(host: string | null, sites: LinuxdoSites): LinuxdoConfig | null {
  return (host ? sites.byHost.get(normalizeHost(host) ?? '') : undefined) ?? sites.defaultSite;
}
