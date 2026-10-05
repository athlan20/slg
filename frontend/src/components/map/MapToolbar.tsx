/** 地图工具条：回主城 · 缩放 · 坐标跳转 · 方向键平移 · 当前位置。
 *  跳转：输入 (x, y) 居中定位并选中该地块；到达世界边缘的方向禁用平移，避免点了没反应。
 */

import { useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import type { WorldSession } from '../../state/worldSession';
import { MapZoomControls } from '../MapZoomControls';
import { PAN_STEP } from './WorldMapStage';

/** 坐标跳转输入解析：两个都必须是非负整数；已知世界边长时须落在 0..size-1，否则视为无效 */
function parseCoord(rawX: string, rawY: string, size: number | null): { x: number; y: number } | null {
  const parse = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) {
      return null;
    }
    const value = Number(trimmed);
    return Number.isSafeInteger(value) ? value : null;
  };
  const x = parse(rawX);
  const y = parse(rawY);
  if (x === null || y === null || (size !== null && (x >= size || y >= size))) {
    return null;
  }
  return { x, y };
}

const ctrlBtn =
  'cursor-pointer rounded border border-line bg-panel-2 text-dim transition-colors hover:border-accent-dim hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line disabled:hover:text-dim';

export function MapToolbar({ world }: { world: WorldSession }) {
  const copy = useCopy();
  const { COPY } = copy;
  const win = world.window;
  const [jumpX, setJumpX] = useState('');
  const [jumpY, setJumpY] = useState('');
  const jumpCoord = parseCoord(jumpX, jumpY, win?.size ?? null);

  const jump = () => {
    if (jumpCoord) {
      world.centerOn(jumpCoord.x, jumpCoord.y);
      world.selectTile(jumpCoord.x, jumpCoord.y);
    }
  };
  const canPan = (dx: number, dy: number): boolean => {
    if (!win) {
      return false;
    }
    if (dx < 0 || dy < 0) {
      return dx < 0 ? win.x > 0 : win.y > 0;
    }
    return dx > 0 ? win.x + win.w < win.size : win.y + win.h < win.size;
  };

  return (
    <div role="世界地图视图-控件" className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line-soft px-2.5 py-1 text-[12px] text-dim">
      <button type="button" role="世界地图视图-回主城按钮" onClick={() => world.centerMainCity()} className={`${ctrlBtn} flex items-center gap-1 px-2 py-0.5`}>
        <span aria-hidden="true" className="text-accent">
          ⌂
        </span>
        {COPY.worldMap.centerCity}
      </button>
      <MapZoomControls dims={win ? { w: win.w, h: win.h } : null} zoom={world.viewSize} onZoom={world.zoomTo} />
      <div role="世界地图视图-坐标跳转" className="flex items-center gap-1">
        {(['x', 'y'] as const).map((axis) => (
          <input
            key={axis}
            type="text"
            inputMode="numeric"
            role={`世界地图视图-坐标输入-${axis}`}
            aria-label={axis === 'x' ? COPY.worldMap.jumpX : COPY.worldMap.jumpY}
            placeholder={axis}
            value={axis === 'x' ? jumpX : jumpY}
            onChange={(event) => (axis === 'x' ? setJumpX(event.target.value) : setJumpY(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                jump();
              }
            }}
            className="w-11 rounded border border-line bg-panel-2 px-1 py-0.5 text-center font-mono text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent-dim"
          />
        ))}
        <button
          type="button"
          role="世界地图视图-跳转按钮"
          aria-label={jumpCoord ? COPY.worldMap.jumpAria(jumpCoord.x, jumpCoord.y) : COPY.worldMap.jumpInvalid}
          title={jumpCoord === null ? COPY.worldMap.jumpInvalid : undefined}
          disabled={jumpCoord === null}
          onClick={jump}
          className={`${ctrlBtn} px-2 py-0.5`}
        >
          {COPY.worldMap.jumpTo}
        </button>
      </div>
      <div role="世界地图视图-方向键" className="flex items-center gap-0.5">
        {(
          [
            { dx: -1, dy: 0, char: '←', aria: '左移' },
            { dx: 0, dy: -1, char: '↑', aria: '上移' },
            { dx: 0, dy: 1, char: '↓', aria: '下移' },
            { dx: 1, dy: 0, char: '→', aria: '右移' },
          ] as const
        ).map((btn) => (
          <button
            key={btn.aria}
            type="button"
            role={`世界地图视图-平移-${btn.aria}`}
            aria-label={COPY.worldMap.pan(btn.dx, btn.dy)}
            title={COPY.worldMap.pan(btn.dx * PAN_STEP, btn.dy * PAN_STEP)}
            disabled={!canPan(btn.dx, btn.dy)}
            onClick={() => world.pan(btn.dx * PAN_STEP, btn.dy * PAN_STEP)}
            className={`${ctrlBtn} grid h-6 w-6 place-items-center text-[13px] leading-none`}
          >
            {btn.char}
          </button>
        ))}
      </div>
      <span role="世界地图视图-位置" className="ml-auto truncate font-mono text-[11.5px] text-faint max-2xl:hidden">
        {win
          ? `${COPY.worldMap.viewCenter(win.x + Math.floor(win.w / 2), win.y + Math.floor(win.h / 2))} · ${COPY.worldMap.worldSize(win.size)}`
          : world.loading
            ? COPY.worldMap.loading
            : COPY.worldMap.loadFailed}
      </span>
    </div>
  );
}
