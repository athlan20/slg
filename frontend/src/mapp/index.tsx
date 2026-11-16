// Linux.do 微应用入口文件（仅在 rsbuild.mapp.config.ts 构建微应用时作为 entry 打包）。
// 普通构建不包含本模块。

import { createRoot } from 'react-dom/client';
import App from '../App';
import { setStorageProvider } from '../storage';
import { MappStorageProvider } from './storage';
import { createMappTransportFactory } from './transport';
import { setTransportFactory } from '../api/client';
import { initMappTheme, onPlatformThemeChange } from './theme';
import { MappStatusScreen } from './MappStatusScreen';
import { getMiniAppSDK } from './sdk';
import { KNOWN_STORAGE_KEYS, MAPP_BUNDLE_MARKER } from './constants';
import type { MiniAppSDK } from './types';
import '../styles/index.css';

/** 注入标记常数以确保微应用产物包含独特标记（供隔离验证 grep） */
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, string>).__SLG_MAPP_MARKER__ = MAPP_BUNDLE_MARKER;
}

async function bootstrap(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) {
    throw new Error('Root container #root not found');
  }
  const root = createRoot(container);

  let sdk: MiniAppSDK;
  try {
    sdk = getMiniAppSDK();
    await sdk.ready;
  } catch {
    root.render(
      <MappStatusScreen
        mode="error"
        message="无法连接平台 SDK，请在 Linux.do 微应用沙箱或社区客户端中运行。"
      />,
    );
    return;
  }

  // 1. 存储层接入
  const storage = new MappStorageProvider(sdk);
  await storage.init(KNOWN_STORAGE_KEYS);
  setStorageProvider(storage);

  // 2. 传输层接入
  const transportFactory = createMappTransportFactory(sdk, 'game');
  setTransportFactory(transportFactory);

  // 3. 主题接入
  try {
    const theme = await sdk.theme.get();
    initMappTheme(theme);
    sdk.theme.onChange((t) => onPlatformThemeChange(t));
  } catch {
    initMappTheme(null);
  }

  // 4. 用户登录检查（未登录论坛则不创建任何 WebSocket 连接）
  let user = null;
  try {
    user = await sdk.user.getCurrent();
  } catch (err) {
    console.warn('[MAPP] user.getCurrent error:', err);
  }

  if (!user) {
    root.render(<MappStatusScreen mode="forum-login-required" />);
    void sdk.lifecycle.ready().catch(() => {});
    return;
  }

  // 5. 挂载主游戏应用并通知平台
  root.render(<App />);
  void sdk.lifecycle.ready().catch(() => {});
}

void bootstrap();
