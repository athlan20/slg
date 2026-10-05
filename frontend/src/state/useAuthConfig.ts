// 登录入口配置（v44 GET /auth/config）：{ googleClientId, wechatEnabled, githubEnabled, passwordLogin }。
// 登录页与账号设置共用；模块级缓存一次（Client ID 只在服务端配一处，经此下发）。
// 拉取失败按「密码登录可用、第三方入口未配置」处理（v47：旧后端没有 passwordLogin 字段时
// 前端按 true 处理，行为与 v46 一致），调用方可手动 retry。

import { useCallback, useEffect, useState } from 'react';
import { AUTH_CONFIG_URL } from '../api/client';

export interface AuthConfig {
  /** null = 服务端没配置 Google，前端不显示任何 Google 入口 */
  googleClientId: string | null;
  /** false = 服务端没配置微信，登录页不显示「微信扫码」分页 */
  wechatEnabled: boolean;
  /** false = 服务端没配置 GitHub OAuth App，前端不显示 GitHub 入口（v45） */
  githubEnabled: boolean;
  /** false = 本站在 PASSWORD_LOGIN_DISABLED_HOSTS 里（国际站），不显示用户名密码表单（v47） */
  passwordLogin: boolean;
}

const FALLBACK: AuthConfig = { googleClientId: null, wechatEnabled: false, githubEnabled: false, passwordLogin: true };

let cached: AuthConfig | null = null;
let inflight: Promise<AuthConfig> | null = null;

async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch(AUTH_CONFIG_URL);
    if (!res.ok) {
      return FALLBACK;
    }
    const body = (await res.json()) as Partial<AuthConfig>;
    return {
      googleClientId: typeof body.googleClientId === 'string' && body.googleClientId ? body.googleClientId : null,
      wechatEnabled: body.wechatEnabled === true,
      githubEnabled: body.githubEnabled === true,
      // v47：国际站返回 false；旧后端没有该字段时按 true（保持原行为）
      passwordLogin: body.passwordLogin !== false,
    };
  } catch {
    return FALLBACK;
  }
}

export function loadAuthConfig(): Promise<AuthConfig> {
  if (cached) {
    return Promise.resolve(cached);
  }
  inflight ??= fetchAuthConfig().then((config) => {
    cached = config;
    inflight = null;
    return config;
  });
  return inflight;
}

/** 供登录页 / 账号设置读取入口配置；null = 还没拿到（按全隐藏处理，不阻塞渲染） */
export function useAuthConfig(): { config: AuthConfig | null; retry: () => void } {
  const [config, setConfig] = useState<AuthConfig | null>(cached);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    void loadAuthConfig().then((value) => {
      if (alive) {
        setConfig(value);
      }
    });
    return () => {
      alive = false;
    };
  }, [nonce]);

  const retry = useCallback(() => {
    cached = null;
    setNonce((n) => n + 1);
  }, []);

  return { config, retry };
}
