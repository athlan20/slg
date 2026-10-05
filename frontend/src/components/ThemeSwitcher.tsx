import { useEffect, useState } from 'react';
import { COPY } from '../copy';
import { THEMES, applyTheme, readStoredTheme, type ThemeId } from '../theme';

/** 皮肤四选一（账号菜单里的一行）：只写 <html data-theme>，选择存 localStorage */
export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeId>(readStoredTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  return (
    <div role="账号菜单-皮肤" className="grid grid-cols-4 gap-1 px-1 pb-1 pt-1.5">
      {THEMES.map((item) => {
        const active = item.id === theme;
        return (
          <button
            key={item.id}
            type="button"
            role={`账号菜单-皮肤-${item.label}`}
            onClick={() => setTheme(item.id)}
            aria-pressed={active}
            title={`${COPY.theme.label}：${item.label}`}
            className={`flex cursor-pointer items-center justify-center gap-1 rounded border px-1 py-1 text-[11px] transition-colors ${
              active ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-panel text-dim hover:border-accent-dim'
            }`}
          >
            <i className="h-[6px] w-[6px] shrink-0 rounded-full" style={{ background: item.swatch }} />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
