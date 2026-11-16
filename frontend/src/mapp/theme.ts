// 微应用主题适配：保留皮肤四选一，未手动选择时随平台深浅主题（theme.read）。

import type { MiniAppTheme } from './types';
import { appStorage } from '../storage';
import { applyTheme, THEMES, type ThemeId } from '../theme';

const STORAGE_KEY = 'slg-city-theme';

export function initMappTheme(platformTheme?: MiniAppTheme | null): void {
  const stored = appStorage.getItem(STORAGE_KEY);
  if (stored && THEMES.some((t) => t.id === stored)) {
    applyTheme(stored as ThemeId);
    return;
  }
  // 平台深色用暗夜（night），浅色用宣纸（paper）
  const defaultTheme: ThemeId = platformTheme?.mode === 'light' ? 'paper' : 'night';
  applyTheme(defaultTheme);
}

export function onPlatformThemeChange(platformTheme: MiniAppTheme): void {
  const stored = appStorage.getItem(STORAGE_KEY);
  // 用户未自行定制时随平台切换
  if (!stored) {
    const nextTheme: ThemeId = platformTheme.mode === 'light' ? 'paper' : 'night';
    applyTheme(nextTheme);
  }
}
