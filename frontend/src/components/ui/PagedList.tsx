/** 分页列表：长列表不滚动，按容器可用高度算每页条数（AGENTS 前端规范 / docs/frontend-nav-layout.md 第 6 节）。
 *  做法：先只渲染第一条量真实行高 → 按列表区高度算每页条数；翻页器永远占位（量高之前就占好，否则会多算一行）；
 *  容器尺寸变化（ResizeObserver）时重算；渲染后若仍溢出（行高不一）逐条减少直至放下。
 *  只有一页时翻页器显示「共 N 条」。行内文本请自行 truncate，避免撑高行。
 */

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { PAGED_COPY } from '../../copy-ui';

interface PagedListProps<T> {
  /** 分页列表的 role 名（翻页器自动命名为「{role}-分页器」） */
  role: string;
  items: T[];
  renderRow: (item: T, index: number) => ReactNode;
  keyOf: (item: T, index: number) => string | number;
  /** 行间距（像素，需与 gapClass 一致） */
  gap?: number;
  gapClass?: string;
  /** 没有条目时显示的空态 */
  empty?: ReactNode;
  /** 还有更早的数据可向服务端翻页（事件流等）：最后一页的翻页器显示「更早」 */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  className?: string;
}

export function PagedList<T>({
  role,
  items,
  renderRow,
  keyOf,
  gap = 4,
  gapClass = 'gap-1',
  empty = null,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  className = '',
}: PagedListProps<T>) {
  const listRef = useRef<HTMLDivElement | null>(null);
  /** 每页条数；null = 尚未测量（此时只渲染第一条量行高） */
  const [per, setPer] = useState<number | null>(null);
  const [page, setPage] = useState(0);
  /** 列表区高度变化计数：变了就重新测量 */
  const [heightTick, setHeightTick] = useState(0);
  const hasItems = items.length > 0;

  // 列表区尺寸变化 → 重新测量
  useEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    let last = el.clientHeight;
    const observer = new ResizeObserver(() => {
      if (Math.abs(el.clientHeight - last) >= 1) {
        last = el.clientHeight;
        setHeightTick((tick) => tick + 1);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 条目从无到有 / 高度变化：回到测量态
  useLayoutEffect(() => {
    setPer(null);
  }, [heightTick, hasItems]);

  // 测量态：第一条的真实行高 → 每页条数
  useLayoutEffect(() => {
    const el = listRef.current;
    if (per !== null || !el || !hasItems) {
      return;
    }
    const first = el.firstElementChild as HTMLElement | null;
    const rowHeight = first ? first.getBoundingClientRect().height : 0;
    const next = rowHeight > 0 ? Math.max(1, Math.floor((el.clientHeight + gap) / (rowHeight + gap))) : 1;
    setPer(next);
  });

  // 渲染后仍溢出（行高不一）：每次少放一条，直到放下
  useLayoutEffect(() => {
    const el = listRef.current;
    if (per === null || per <= 1 || !el) {
      return;
    }
    if (el.scrollHeight > el.clientHeight + 1) {
      setPer(per - 1);
    }
  });

  const size = per ?? 1;
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages - 1);
  useEffect(() => {
    if (page !== current) {
      setPage(current);
    }
  }, [page, current]);
  const visible = items.slice(current * size, current * size + size);

  return (
    <div role={role} className={`flex min-h-0 flex-1 flex-col ${className}`}>
      <div ref={listRef} className={`flex min-h-0 flex-1 flex-col overflow-hidden ${gapClass}`}>
        {hasItems
          ? visible.map((item, i) => <Row key={keyOf(item, current * size + i)}>{renderRow(item, current * size + i)}</Row>)
          : empty}
      </div>
      <div role={`${role}-分页器`} className="flex h-6 shrink-0 items-center justify-end gap-1.5 pt-1 text-[11.5px] text-faint">
        {pages <= 1 ? (
          <span>{PAGED_COPY.total(items.length)}</span>
        ) : (
          <>
            <button
              type="button"
              role={`${role}-上一页`}
              aria-label={PAGED_COPY.prev}
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              className="grid h-5 w-5 cursor-pointer place-items-center rounded border border-line bg-panel-2 text-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              ‹
            </button>
            <span className="font-mono tabular-nums">
              {current + 1} / {pages}
            </span>
            <button
              type="button"
              role={`${role}-下一页`}
              aria-label={PAGED_COPY.next}
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
              className="grid h-5 w-5 cursor-pointer place-items-center rounded border border-line bg-panel-2 text-dim disabled:cursor-not-allowed disabled:opacity-40"
            >
              ›
            </button>
          </>
        )}
        {hasMore && current >= pages - 1 ? (
          <button
            type="button"
            role={`${role}-更早`}
            disabled={loadingMore}
            onClick={onLoadMore}
            className="h-5 cursor-pointer rounded border border-line bg-panel-2 px-1.5 text-dim disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loadingMore ? PAGED_COPY.loading : PAGED_COPY.older}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** 行外壳：禁止被 flex 压缩（保证量到的行高就是实占高度） */
function Row({ children }: { children: ReactNode }) {
  return <div className="shrink-0">{children}</div>;
}
