/** 「？」图标浮窗（AISLG-188）：鼠标悬停、触屏点按或键盘回车 / 空格打开，移开 / 再点 / Esc / 点到外面 / 滚动即关闭。
 *  浮窗经 portal 挂到 body 并 fixed 定位，不被卡片或面板的 overflow 裁切；下方放不下时翻到上方，右侧放不下时右对齐，最后夹在视口内。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const GAP = 6;
const EDGE = 8;

interface HelpTipProps {
  triggerRole: string;
  popRole: string;
  ariaLabel: string;
  children: ReactNode;
}

export function HelpTip({ triggerRole, popRole, ariaLabel, children }: HelpTipProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // 最近一次指针类型：区分鼠标（悬停即开，点击不再切换）与触屏 / 笔（点按切换）
  const pointerRef = useRef('mouse');
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // 打开后量浮窗与触发器的尺寸再定位，布局阶段完成，不会闪动
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const trigger = triggerRef.current;
    const pop = popRef.current;
    if (!trigger || !pop) {
      return;
    }
    const t = trigger.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const fitsBelow = t.bottom + GAP + p.height <= vh - EDGE;
    const fitsAbove = t.top - GAP - p.height >= EDGE;
    const topWanted = fitsBelow || !fitsAbove ? t.bottom + GAP : t.top - GAP - p.height;
    const leftWanted = t.left + p.width > vw - EDGE ? t.right - p.width : t.left;
    setPos({
      top: Math.min(Math.max(EDGE, topWanted), Math.max(EDGE, vh - EDGE - p.height)),
      left: Math.min(Math.max(EDGE, leftWanted), Math.max(EDGE, vw - EDGE - p.width)),
    });
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    const close = () => setOpen(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    // 固定定位不随页面滚动，滚动或改变视口尺寸时直接收起，避免浮窗飘离图标
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role={triggerRole}
        aria-label={ariaLabel}
        aria-expanded={open}
        onPointerDown={(event) => {
          pointerRef.current = event.pointerType;
        }}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') {
            setOpen(true);
          }
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') {
            setOpen(false);
          }
        }}
        onClick={(event) => {
          // 鼠标已由悬停控制；触屏点按与键盘触发（detail 为 0）切换
          if (pointerRef.current !== 'mouse' || event.detail === 0) {
            setOpen((value) => !value);
          }
        }}
        className="inline-flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full border border-line text-[10px] leading-none text-dim transition-colors hover:border-accent-dim hover:text-accent"
      >
        ？
      </button>
      {open
        ? createPortal(
            <div
              ref={popRef}
              role={popRole}
              className="pointer-events-none fixed z-50 flex w-[min(260px,calc(100vw-16px))] flex-col gap-1 rounded-md border border-accent-dim bg-panel-2 px-2.5 py-2 text-[12px] leading-snug text-fg shadow-2xl"
              style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
