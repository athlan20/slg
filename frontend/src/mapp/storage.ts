// 微应用存储适配层：启动时预热内存缓存，同步读取，写入时同步更内存并异步落盘到 sdk.localStorage。
// 遵守规则：会话令牌 slg.sessionToken 在微应用版绝不持久化落盘。

import type { MiniAppSDK } from './types';
import type { StorageProvider } from '../storage';

export class MappStorageProvider implements StorageProvider {
  private readonly cache = new Map<string, string>();
  private readonly sdk: MiniAppSDK;

  constructor(sdk: MiniAppSDK) {
    this.sdk = sdk;
  }

  /** 启动时先将所有可能用到的键预加载到内存 */
  async init(knownKeys: string[] = []): Promise<void> {
    let exported = false;
    try {
      if (typeof this.sdk.localStorage.exportData === 'function') {
        const snapshot = await this.sdk.localStorage.exportData();
        if (snapshot && Array.isArray(snapshot.entries)) {
          for (const [key, value] of snapshot.entries) {
            if (typeof key === 'string' && typeof value === 'string') {
              this.cache.set(key, value);
            }
          }
          exported = true;
        }
      }
    } catch {
      // exportData 失败时回落到单键读取
    }

    if (!exported && Array.isArray(knownKeys)) {
      await Promise.all(
        knownKeys.map(async (key) => {
          try {
            const val = await this.sdk.localStorage.getItem(key);
            if (val !== null && val !== undefined) {
              this.cache.set(key, String(val));
            }
          } catch {
            // 忽略读取失败
          }
        }),
      );
    }
  }

  getItem(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.cache.set(key, value);
    // 会话令牌在微应用版不持久化
    if (key === 'slg.sessionToken') {
      return;
    }
    void this.sdk.localStorage.setItem(key, value).catch(() => {});
  }

  removeItem(key: string): void {
    this.cache.delete(key);
    if (key === 'slg.sessionToken') {
      return;
    }
    void this.sdk.localStorage.removeItem(key).catch(() => {});
  }
}
