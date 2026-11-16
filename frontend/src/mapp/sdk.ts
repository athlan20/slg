// 运行时获取平台注入的 miniApp SDK 实例。
import type { MiniAppSDK } from './types';

export function getMiniAppSDK(): MiniAppSDK {
  const sdk = (globalThis as unknown as { miniApp?: MiniAppSDK }).miniApp;
  if (!sdk) {
    throw new Error('Linux.do MiniApp SDK is not available in the current environment');
  }
  return sdk;
}
