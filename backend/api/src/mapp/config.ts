// Linux.do 微应用配置读取与校验（AISLG-261）。
// MAPP_ENABLED 默认关闭；关闭或必需配置不完整时视为功能未启用。

import { readLinuxdoMinTrustLevel } from '../linuxdo';
import type { MappChannel, MappConfig } from './types';

function normalizeUrlNoTrailingSlash(raw: string | undefined): string | null {
  if (!raw) return null;
  let str = raw.trim();
  while (str.endsWith('/')) {
    str = str.slice(0, -1);
  }
  if (!str) return null;
  try {
    const parsed = new URL(str);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return str;
  } catch {
    return null;
  }
}

function normalizeAudience(raw: string | undefined): string | null {
  if (!raw) return null;
  let str = raw.trim();
  while (str.endsWith('/')) {
    str = str.slice(0, -1);
  }
  if (!str) return null;
  if (str.startsWith('wss://')) {
    str = 'https://' + str.slice(6);
  } else if (str.startsWith('ws://')) {
    str = 'http://' + str.slice(5);
  }
  try {
    const parsed = new URL(str);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

export function readMappConfig(env: NodeJS.ProcessEnv = process.env): MappConfig | null {
  const enabledRaw = env.MAPP_ENABLED?.trim();
  const enabled = enabledRaw === 'true' || enabledRaw === '1';
  if (!enabled) {
    return null;
  }

  const issuer = normalizeUrlNoTrailingSlash(env.MAPP_ISSUER);
  const appId = env.MAPP_APP_ID?.trim() || null;
  const channelRaw = env.MAPP_CHANNEL?.trim();
  const channel: MappChannel | null =
    channelRaw === 'production' || channelRaw === 'sandbox' ? channelRaw : null;
  const audience = normalizeAudience(env.MAPP_AUDIENCE);

  const rawOrigins = env.MAPP_ORIGINS?.trim() || '';
  const origins = new Set<string>();
  for (const part of rawOrigins.split(',')) {
    const trimmed = part.trim().replace(/\/+$/, '');
    if (trimmed) {
      origins.add(trimmed);
    }
  }

  // 必须显式配置 issuer、appId、channel、audience 与至少一个允许的 origin
  if (!issuer || !appId || !channel || !audience || origins.size === 0) {
    return null;
  }

  const identityProviderRaw = env.MAPP_IDENTITY_PROVIDER?.trim();
  const identityProvider: 'linuxdo_mapp' | 'linuxdo' =
    identityProviderRaw === 'linuxdo' ? 'linuxdo' : 'linuxdo_mapp';

  const minTrustLevel = readLinuxdoMinTrustLevel(env) ?? 1;

  return {
    enabled: true,
    issuer,
    appId,
    channel,
    audience,
    origins,
    identityProvider,
    minTrustLevel,
  };
}
