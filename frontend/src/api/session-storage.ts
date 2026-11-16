// 登录状态的浏览器持久化：会话令牌与上次登录的用户名。
// 键名与后端无关，属于前端自己的存储约定；只存令牌，绝不存密码。

import { appStorage } from '../storage';

const TOKEN_KEY = 'slg.sessionToken';
const LAST_USERNAME_KEY = 'slg.lastUsername';

function safeGet(key: string): string | null {
  try {
    return appStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    appStorage.setItem(key, value);
  } catch {
    // 隐私模式等存储不可用场景：静默降级为不持久化
  }
}

export function readStoredToken(): string | null {
  return safeGet(TOKEN_KEY);
}

export function saveStoredToken(token: string): void {
  safeSet(TOKEN_KEY, token);
}

export function clearStoredToken(): void {
  try {
    appStorage.removeItem(TOKEN_KEY);
  } catch {
    // 忽略
  }
}

export function readLastUsername(): string {
  return safeGet(LAST_USERNAME_KEY) ?? '';
}

export function saveLastUsername(username: string): void {
  safeSet(LAST_USERNAME_KEY, username);
}
