// 世界地图缩放手势（AISLG-103）：滚轮（MKB）与双指捏合（触屏）。键盘 / 按钮 / 手柄在组件里直接调 onZoom。
// - 滚轮：只响应 Ctrl / ⌘ + 滚轮（触控板双指捏合浏览器也会发 ctrlKey 滚轮）；不带修饰键的滚轮 / 上下滑动
//   一律放行给页面滚动，不拦截。原生非被动监听（缩放时要 preventDefault 阻止浏览器页面缩放）；
//   累计滚动量，每满一档走 zoomStep 格，向上滚 = 放大（窗口格数减少），向下滚 = 缩小；缩放中心取光标位置；
// - 捏合：两个触点的间距变化折算窗口边长（间距变大 = 放大 = 格数减少），中心取两指中点；
//   捏合期间 pinchingRef 为 true，拖曳逻辑据此让路（缩放后仍可正常拖曳）。

import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { clampZoom, zoomStep } from './mapZoom';

/** 每满这个滚动量算一档（像素；触控板高频小增量会累计，鼠标滚轮一格约 100） */
const WHEEL_NOTCH = 80;

export type ZoomHandler = (nextSize: number, focus: { fx: number; fy: number }) => void;

export function useMapZoomGestures(
  viewportRef: RefObject<HTMLElement | null>,
  currentSize: number,
  onZoom: ZoomHandler,
): { pinchingRef: MutableRefObject<boolean> } {
  const sizeRef = useRef(currentSize);
  const onZoomRef = useRef(onZoom);
  const pinchingRef = useRef(false);
  sizeRef.current = currentSize;
  onZoomRef.current = onZoom;

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) {
      return undefined;
    }
    const focusOf = (clientX: number, clientY: number) => {
      const rect = el.getBoundingClientRect();
      return {
        fx: Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width))),
        fy: Math.min(1, Math.max(0, (clientY - rect.top) / Math.max(1, rect.height))),
      };
    };

    // 滚轮
    let accumulated = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      accumulated += event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      const notches = Math.trunc(accumulated / WHEEL_NOTCH);
      if (notches === 0) {
        return;
      }
      accumulated -= notches * WHEEL_NOTCH;
      // deltaY < 0（向上滚）= 放大 = 窗口边长减少
      const next = clampZoom(sizeRef.current + notches * zoomStep(sizeRef.current));
      if (next !== sizeRef.current) {
        onZoomRef.current(next, focusOf(event.clientX, event.clientY));
      }
    };

    // 双指捏合
    const touches = new Map<number, { x: number; y: number }>();
    let startDistance = 0;
    let startSize = 0;
    const distance = (): number => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') {
        return;
      }
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size === 2) {
        pinchingRef.current = true;
        startDistance = Math.max(1, distance());
        startSize = sizeRef.current;
      }
    };
    const onMove = (event: PointerEvent) => {
      if (!touches.has(event.pointerId)) {
        return;
      }
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.size !== 2 || !pinchingRef.current) {
        return;
      }
      // 间距变大 = 放大 = 格数减少：边长 = 起始边长 × 起始间距 ÷ 当前间距
      const next = clampZoom((startSize * startDistance) / Math.max(1, distance()));
      if (next !== sizeRef.current) {
        const [a, b] = [...touches.values()];
        onZoomRef.current(next, focusOf((a.x + b.x) / 2, (a.y + b.y) / 2));
      }
    };
    const onUp = (event: PointerEvent) => {
      touches.delete(event.pointerId);
      // 捏合结束：等剩下的手指也抬起后才允许拖曳，避免松手瞬间被当作拖曳跳窗
      if (touches.size === 0) {
        pinchingRef.current = false;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [viewportRef]);

  return { pinchingRef };
}
