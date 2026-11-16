// 统一键值存储接口：浏览器版直接对接 window.localStorage，微应用版对接内存缓存 + sdk.localStorage。
// 既有文件通过 appStorage 同步存取，避免直接耦合全局 localStorage。

export interface StorageProvider {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const defaultBrowserStorage: StorageProvider = {
  getItem(key: string): string | null {
    try {
      return typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(key) : null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch {
      // 隐私模式等存储不可用时静默忽略
    }
  },
  removeItem(key: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // 忽略
    }
  },
};

let currentProvider: StorageProvider = defaultBrowserStorage;

export function setStorageProvider(provider: StorageProvider): void {
  currentProvider = provider;
}

export function getStorageProvider(): StorageProvider {
  return currentProvider;
}

export const appStorage = {
  getItem(key: string): string | null {
    return currentProvider.getItem(key);
  },
  setItem(key: string, value: string): void {
    currentProvider.setItem(key, value);
  },
  removeItem(key: string): void {
    currentProvider.removeItem(key);
  },
};
