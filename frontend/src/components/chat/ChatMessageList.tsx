// 聊天消息列表（AISLG-138）：最新的消息在最下面；按面板可用高度分页，不出现竖向滚动条。
// 聊天行高差别很大（表情、卡片、多行文字），所以不按固定条数分页，而是按每行的真实高度装页（AISLG-187：
// 原先「量一行定条数、溢出就少放一条」只减不增，遇到一条高行后每页会一直只剩一两条）：
// 渲染过的行把高度记进缓存，没渲染过的按已知行高的中位数估算，从最新一条往前装满一页再开下一页；
// 页码从最新端数起：第 1 页就是最新的一批；翻到最旧一页后，「更早」向服务端取一页（hasMore）接到前面。

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useCopy } from '../../i18n/bundle';

const GAP = 6;
/** 还没量过行高时，先渲染最新这么多条取样（只在首帧绘制前的布局阶段出现，量完立即按真实高度装页） */
const SAMPLE = 20;

interface ChatMessageListProps<T> {
  /** 列表的 role 名（翻页器自动命名为「{role}-分页器」） */
  role: string;
  /** 从旧到新 */
  items: T[];
  keyOf: (item: T) => string | number;
  renderRow: (item: T) => ReactNode;
  empty: ReactNode;
  hasMore: boolean;
  loading: boolean;
  onLoadOlder: () => void;
}

/** 从最新端往前装页：返回每页的 [start, end)（下标 0 = 最新一页），每页至少一条 */
export function chatPages(heights: number[], avail: number, gap: number): Array<[number, number]> {
  const pages: Array<[number, number]> = [];
  let end = heights.length;
  while (end > 0) {
    let start = end - 1;
    let used = heights[start] as number;
    while (start > 0 && used + gap + (heights[start - 1] as number) <= avail) {
      start -= 1;
      used += gap + (heights[start] as number);
    }
    pages.push([start, end]);
    end = start;
  }
  return pages;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

export function ChatMessageList<T>({ role, items, keyOf, renderRow, empty, hasMore, loading, onLoadOlder }: ChatMessageListProps<T>) {
  const { CHAT_COPY } = useCopy();
  const listRef = useRef<HTMLDivElement | null>(null);
  /** 行高缓存（key → 像素）；列表宽度变化时清空（换行方式变了） */
  const heightsRef = useRef(new Map<string | number, number>());
  /** 列表区可用高度；0 = 尚未测量（此时只渲染最新的取样行） */
  const [avail, setAvail] = useState(0);
  /** 行高缓存有变化就 +1，触发重新装页 */
  const [, setTick] = useState(0);
  /** 从最新一页往前翻了几页（0 = 最新） */
  const [back, setBack] = useState(0);
  const count = items.length;

  // 列表区尺寸：高度决定一页装多少，宽度变了行高全部作废
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) {
      return undefined;
    }
    setAvail(el.clientHeight);
    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - lastWidth) >= 1) {
        lastWidth = el.clientWidth;
        heightsRef.current.clear();
        setTick((tick) => tick + 1);
      }
      setAvail(el.clientHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const heights = heightsRef.current;
  const fallback = median([...heights.values()]);
  // 还没量到任何行（或列表区高度未知）：先渲染最新的取样行，量完再装页
  const pages =
    avail > 0 && count > 0 && heights.size > 0
      ? chatPages(
          items.map((item) => heights.get(keyOf(item)) ?? fallback),
          avail,
          GAP,
        )
      : [[Math.max(0, count - SAMPLE), count] as [number, number]];
  const maxBack = pages.length - 1;
  const current = Math.min(back, maxBack);
  useEffect(() => {
    if (back !== current) {
      setBack(current);
    }
  }, [back, current]);
  const [start, end] = pages[current] as [number, number];
  const visible = items.slice(start, end);
  const atOldest = current >= maxBack;

  // 量出这一页各行的真实高度写进缓存；有变化就按新高度重新装页（行高与在哪一页无关，几轮内收敛）
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || count === 0) {
      return;
    }
    let changed = false;
    Array.from(el.children).forEach((child, index) => {
      const item = visible[index];
      if (item === undefined) {
        return;
      }
      const key = keyOf(item);
      const height = child.getBoundingClientRect().height;
      if (height > 0 && Math.abs((heights.get(key) ?? -1) - height) >= 0.5) {
        heights.set(key, height);
        changed = true;
      }
    });
    if (changed) {
      setTick((tick) => tick + 1);
    }
  });

  return (
    <div role={role} className="flex min-h-0 flex-1 flex-col gap-1">
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col justify-end gap-1.5 overflow-hidden">
        {count === 0 ? (
          empty
        ) : (
          visible.map((item) => (
            <div key={keyOf(item)} className="shrink-0">
              {renderRow(item)}
            </div>
          ))
        )}
      </div>
      <div role={`${role}-分页器`} className="flex h-6 shrink-0 items-center justify-end gap-1.5 text-[11.5px] text-faint">
        {hasMore && atOldest ? (
          <button
            type="button"
            role={`${role}-更早`}
            disabled={loading}
            onClick={onLoadOlder}
            className="h-5 cursor-pointer rounded border border-line bg-panel-2 px-1.5 text-dim disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? CHAT_COPY.list.loading : CHAT_COPY.list.older}
          </button>
        ) : null}
        {pages.length > 1 ? (
          <>
            <button
              type="button"
              role={`${role}-更旧一页`}
              disabled={atOldest}
              onClick={() => setBack(current + 1)}
              className="grid h-5 w-5 cursor-pointer place-items-center rounded border border-line bg-panel-2 text-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              ‹
            </button>
            <span className="font-mono tabular-nums">
              {pages.length - current} / {pages.length}
            </span>
            <button
              type="button"
              role={`${role}-更新一页`}
              disabled={current === 0}
              onClick={() => setBack(current - 1)}
              className="grid h-5 w-5 cursor-pointer place-items-center rounded border border-line bg-panel-2 text-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              ›
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
