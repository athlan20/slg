/** 皮肤切换：只写 <html data-theme>，选择存 localStorage。纯视觉，不涉及游戏数据。
 *  label 双语（AISLG-137）：组件按界面语言取 label / labelEn。 */

export const THEMES = [
  { id: 'night', label: '暗夜', labelEn: 'Night', swatch: '#2dd4bf' },
  { id: 'crimson', label: '赤霄', labelEn: 'Crimson', swatch: '#e8564a' },
  { id: 'gilded', label: '鎏金', labelEn: 'Gilded', swatch: '#d9a441' },
  { id: 'paper', label: '宣纸', labelEn: 'Paper', swatch: '#b03a2e' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

const STORAGE_KEY = 'slg-city-theme';
const DEFAULT_THEME: ThemeId = 'night';

export function readStoredTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.some((theme) => theme.id === saved)) return saved as ThemeId;
  } catch {
    /* 隐私模式下 localStorage 可能不可用，回落到默认皮肤 */
  }
  return DEFAULT_THEME;
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.setAttribute('data-theme', id);
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* 存不上不影响本次切换 */
  }
}
