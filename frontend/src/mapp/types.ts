// Linux.do / Discourse 微应用 SDK 类型声明（独立维护，不复制、不入库平台 SDK 源码）。

export interface MiniAppUser {
  id: number;
  username: string;
  name: string;
  initials: string;
  trustLevel: number | null;
  avatarUrl: string | null;
}

export interface MiniAppTheme {
  mode: 'light' | 'dark';
  background: string;
  text: string;
  accent: string;
  border: string;
  locale: string;
  reducedMotion: boolean;
  viewport: {
    width: number;
    height: number;
  };
}

export interface StorageSnapshot {
  format: 1;
  entries: [string, string][];
}

export interface MiniAppSocket {
  readonly id: string;
  readonly readyState: 'open' | 'closing' | 'closed';
  readonly ready: Promise<void>;
  send(data: unknown): Promise<null>;
  sendText(text: string): Promise<null>;
  close(code?: number, reason?: string): Promise<null>;
  on(event: 'message', listener: (value: unknown) => void): () => void;
  on(event: 'close', listener: (value: { code: number; reason?: string }) => void): () => void;
  on(event: 'error', listener: (value: { code: string }) => void): () => void;
  on(event: string, listener: (...args: unknown[]) => void): () => void;
}

export interface MiniAppSDK {
  readonly ready: Promise<void>;
  readonly lifecycle: {
    ready(): Promise<void>;
  };
  readonly user: {
    getCurrent(): Promise<MiniAppUser | null>;
    getById(userId: number): Promise<MiniAppUser>;
  };
  readonly theme: {
    get(): Promise<MiniAppTheme>;
    onChange(listener: (theme: MiniAppTheme) => void): () => void;
  };
  readonly localStorage: {
    exportData(): Promise<StorageSnapshot>;
    importData(snapshot: StorageSnapshot): Promise<null>;
    getItem(key: unknown): Promise<string | null>;
    setItem(key: unknown, value: unknown): Promise<null>;
    removeItem(key: unknown): Promise<null>;
    clear(): Promise<null>;
  };
  readonly webSocket: {
    connect(endpoint: string, options?: { query?: Record<string, string>; textMode?: 'auto' | 'text'; timeoutMs?: number }): Promise<MiniAppSocket>;
  };
}

export interface MiniAppManifest {
  format: 1;
  id: string;
  name?: string;
  tags?: string[];
  version: string;
  entry: string;
  script: string;
  style: string;
  permissions: string[];
  websockets?: Record<string, { url: string; auth?: string; query?: string[] }>;
  assets?: string[];
  media?: Record<string, { path: string; kind: string; mime: string }>;
}
