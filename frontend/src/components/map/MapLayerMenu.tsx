/** 手机端图层菜单（AISLG-231）：卡片标题栏右侧的「图层」按钮 + 展开的复选面板。
 *  MapCard 只在宽度 < 640px 时渲染本组件，>= 640px 仍渲染横排复选框，DOM 里同一时刻只有一份带 role 的复选框。
 *  面板绝对定位浮在地图上方（不占布局、不改变地图可视格数），最大宽 240px、不超出屏幕。
 *  关闭方式：再点按钮、点面板外（含地图格子）、按 Esc。点面板外用 pointerdown 判定、不加遮罩，
 *  所以点地图格子时面板关掉的同时格子照常被选中。勾选立刻生效，面板不自动关闭，方便连着开关几项。
 */

import { useEffect, useRef, useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import type { MapLayers } from '../../state/NavContext';
import { useLayerOptions } from './mapLayerOptions';

interface MapLayerMenuProps {
  /** 地图卡片的 role 前缀，按钮 / 面板 / 复选框的 role 都由它拼出来 */
  role: string;
  layers: MapLayers;
  onToggle: (key: keyof MapLayers) => void;
}

const BTN_CLASS =
  'cursor-pointer rounded border border-line bg-panel-2 px-2 py-1 text-[12px] leading-none text-dim transition-colors hover:border-accent-dim hover:text-fg aria-expanded:border-accent-dim aria-expanded:text-accent';

export function MapLayerMenu({ role, layers, onToggle }: MapLayerMenuProps) {
  const { EXTRA_MAP } = useCopy();
  const options = useLayerOptions();
  const [open, setOpen] = useState(false);
  // 按钮和面板都在这个容器里：点按钮不算“面板外”，否则 pointerdown 先关、click 立刻又打开
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const wrap = wrapRef.current;
      if (wrap !== null && event.target instanceof Node && wrap.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} role={`${role}-图层菜单`} className="relative ml-auto shrink-0">
      <button
        type="button"
        role={`${role}-图层按钮`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((prev) => !prev)}
        className={BTN_CLASS}
      >
        {EXTRA_MAP.layers.button}
      </button>
      {open ? (
        <div
          role={`${role}-图层面板`}
          aria-label={EXTRA_MAP.layers.panelAria}
          className="absolute right-0 top-full z-30 mt-1 flex w-[min(240px,calc(100vw-16px))] flex-col rounded-md border border-line bg-panel-2 py-1 shadow-2xl"
        >
          {options.map((option) => (
            <label
              key={option.key}
              role={`${role}-图层行-${option.roleLabel}`}
              className="flex min-h-[44px] w-full cursor-pointer items-center gap-2 px-3 text-[13px] text-dim hover:bg-panel hover:text-fg"
            >
              <input
                type="checkbox"
                role={`${role}-图层-${option.roleLabel}`}
                checked={layers[option.key]}
                onChange={() => onToggle(option.key)}
                className="h-4 w-4 shrink-0 accent-accent"
              />
              <span className="min-w-0 truncate">{option.label}</span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
