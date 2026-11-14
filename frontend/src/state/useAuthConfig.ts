// 登录入口配置（v44 GET /auth/config）：{ googleClientId, wechatEnabled, githubEnabled, passwordLogin }。
// 登录页与账号设置共用；模块级缓存一次（Client ID 只在服务端配一处，经此下发）。
// 拉取失败按「密码登录可用、第三方入口未配置」处理（v47：旧后端没有 passwordLogin 字段时
// 前端按 true 处理，行为与 v46 一致），调用方可手动 retry。

import { useCallback, useEffect, useState } from 'react';
import { AUTH_CONFIG_URL } from '../api/client';
import { parseAuthConfig, FALLBACK } from './authConfig';
export type { AuthConfig } from './authConfig';
import type { AuthConfig } from './authConfig';

let cached: AuthConfig | null = null;
let inflight: Promise<AuthConfig> | null = null;

async function fetchAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch(AUTH_CONFIG_URL);
    if (!res.ok) {
      return FALLBACK;
    }
    return parseAuthConfig(await res.json());
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
