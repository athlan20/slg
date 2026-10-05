// 界面语言（AISLG-137）：中文 / 英文双语。本文件只管「当前语言是什么、怎么切换」，
// 不含任何文案；文案本体在 copy*.ts（中文）与 copy-*-en.ts（英文），经 i18n/bundle.ts 按语言取用。
//
// 语言判定（验收口径）：localStorage 手动选择优先（slg-lang），否则 navigator.language
// 以 zh 开头用中文、其余一律英文；国内站与国际站规则相同。切换即时生效（订阅者重渲染）。

export type Lang = 'zh' | 'en';

const STORAGE_KEY = 'slg-lang';
const LANGS: readonly Lang[] = ['zh', 'en'];

function isLang(value: unknown): value is Lang {
  return value === 'zh' || value === 'en';
}

/** 浏览器语言 → 默认界面语言：zh 开头（zh / zh-CN / zh-TW…）给中文，其余给英文 */
function detectLang(): Lang {
  const languages = typeof navigator !== 'undefined' ? navigator.languages ?? [navigator.language] : [];
  return languages.some((tag) => typeof tag === 'string' && tag.toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}

function readStoredLang(): Lang | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return isLang(saved) ? saved : null;
  } catch {
    /* 隐私模式下 localStorage 可能不可用，回落到浏览器语言 */
    return null;
  }
}

let current: Lang = readStoredLang() ?? detectLang();

const listeners = new Set<() => void>();

function applyHtmlLang(): void {
  document.documentElement.lang = current === 'zh' ? 'zh-CN' : 'en';
}

/** 启动时调用（main.tsx）：把 <html lang> 对齐到判定出的语言，避免首屏辅助技术读错 */
export function initLang(): void {
  applyHtmlLang();
}

export function getLang(): Lang {
  return current;
}

/** 切换语言并记住选择：立即生效（通知订阅者）、写入 <html lang>、持久化到 localStorage */
export function setLang(lang: Lang): void {
  if (!isLang(lang) || lang === current) return;
  current = lang;
  applyHtmlLang();
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* 存不上不影响本次切换 */
  }
  for (const notify of listeners) notify();
}

/** 供 useSyncExternalStore 订阅语言变化 */
export function subscribeLang(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export const ALL_LANGS = LANGS;
