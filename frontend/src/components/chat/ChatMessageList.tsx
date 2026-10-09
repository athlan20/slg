// 聊天消息列表（AISLG-138）：最新的消息在最下面；按面板可用高度算每页条数，不出现竖向滚动条。
// 做法同 ui/PagedList（先量一行的真实高度，再定每页条数，渲染后仍溢出就少放一条），区别是页码从最新端数起：
// 第 1 页就是最新的一批；翻到最旧一页后，「更早」向服务端取一页（hasMore）接到前面。

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useCopy } from '../../i18n/bundle';

const GAP = 6;

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

export function ChatMessageList<T>({ role, items, keyOf, renderRow, empty, hasMore, loading, onLoadOlder }: ChatMessageListProps<T>) {
  const { CHAT_COPY } = useCopy();
  const listRef = useRef<HTMLDivElement | null>(null);
  /** 每页条数；null = 尚未测量（此时只渲染最新一条量行高） */
  const [per, setPer] = useState<number | null>(null);
  /** 从最新一页往前翻了几页（0 = 最新） */
  const [back, setBack] = useState(0);
  const count = items.length;

  // 列表区高度变化 → 重新测量
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    let last = el.clientHeight;
    const observer = new ResizeObserver(() => {
      if (Math.abs(el.clientHeight - last) >= 1) {
        last = el.clientHeight;
        setPer(null);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 测量态：最新一条的真实行高 → 每页条数
  useLayoutEffect(() => {
    const el = listRef.current;
    if (per !== null || !el || count === 0) {
      return;
    }
    const first = el.firstElementChild as HTMLElement | null;
    const rowHeight = first ? first.getBoundingClientRect().height : 0;
    setPer(rowHeight > 0 ? Math.max(1, Math.floor((el.clientHeight + GAP) / (rowHeight + GAP))) : 1);
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
  const pages = Math.max(1, Math.ceil(count / size));
  const maxBack = pages - 1;
  const current = Math.min(back, maxBack);
  useEffect(() => {
    if (back !== current) {
      setBack(current);
    }
  }, [back, current]);
  const end = count - current * size;
  const start = Math.max(0, end - size);
  const visible = items.slice(start, end);
  const atOldest = current >= maxBack;

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
        {pages > 1 ? (
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
              {pages - current} / {pages}
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
