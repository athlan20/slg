// 界面语言切换（AISLG-137）：中文 / English 两选一，账号菜单里紧挨皮肤行。
// 选择即切换（不用刷新）并持久化；默认语言跟随浏览器，见 i18n/lang.ts。

import { useCopy, useLang } from '../i18n/bundle';
import { setLang, type Lang } from '../i18n/lang';

const OPTIONS: ReadonlyArray<{ id: Lang; textKey: 'languageZh' | 'languageEn' }> = [
  { id: 'zh', textKey: 'languageZh' },
  { id: 'en', textKey: 'languageEn' },
];

export function LanguageSwitcher() {
  const copy = useCopy();
  const lang = useLang();
  const { NAV_COPY } = copy;
  return (
    <div role="账号菜单-语言" className="grid grid-cols-2 gap-1 px-1 pb-1 pt-1.5">
      {OPTIONS.map((item) => {
        const active = lang === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role={`账号菜单-语言-${item.id}`}
            onClick={() => setLang(item.id)}
            aria-pressed={active}
            title={`${NAV_COPY.language}：${NAV_COPY[item.textKey]}`}
            className={`flex cursor-pointer items-center justify-center rounded border px-1 py-1 text-[11px] transition-colors ${
              active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-panel text-dim hover:border-accent-dim'
            }`}
          >
            <span className="truncate">{NAV_COPY[item.textKey]}</span>
          </button>
        );
      })}
    </div>
  );
}
