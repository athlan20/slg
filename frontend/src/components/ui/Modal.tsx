/** 通用弹窗外壳（只读详情用，docs/frontend-nav-layout.md 第 7 节）：Esc / 点遮罩关闭；
 *  宽度 ≤ 640px（size="sm" 为确认框 ≤ 400px）；高度不超过视口；内容不滚动——长列表由内容用 PagedList 分页。
 *  fill=true 时面板取固定高度（视口内最大 560px），让内部的分页列表有确定的可用高度可量。
 */

import { useEffect, type ReactNode } from 'react';
import { useCopy } from '../../i18n/bundle';

interface ModalProps {
  /** 弹窗 role：外层遮罩用它，面板为「{role}-面板」，关闭按钮为「{role}-关闭按钮」 */
  role: string;
  title: ReactNode;
  onClose: () => void;
  size?: 'md' | 'sm';
  /** 顶部色带：胜负 / 类别主题色 */
  accent?: 'accent' | 'gold' | 'warn' | 'none';
  /** 固定高度（内含分页列表的弹窗） */
  fill?: boolean;
  /** 标题右侧（关闭按钮左边）的附加内容 */
  headExtra?: ReactNode;
  children: ReactNode;
}

const ACCENT_BAR: Record<NonNullable<ModalProps['accent']>, string> = {
  accent: 'bg-accent',
  gold: 'bg-gold',
  warn: 'bg-warn',
  none: 'hidden',
};

export function Modal({ role, title, onClose, size = 'md', accent = 'accent', fill = false, headExtra, children }: ModalProps) {
  const copy = useCopy();
  const { MODAL_COPY } = copy;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div role={role} className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-3" onClick={onClose}>
      <div
        role={`${role}-面板`}
        className={`flex min-h-0 w-full flex-col overflow-hidden rounded-lg border border-line bg-panel shadow-2xl ${
          size === 'sm' ? 'max-w-[400px]' : 'max-w-[640px]'
        } ${fill ? 'h-[min(560px,calc(100dvh-24px))]' : 'max-h-[calc(100dvh-24px)]'}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`h-[2px] w-full shrink-0 ${ACCENT_BAR[accent]}`} />
        <header role={`${role}-标题栏`} className="flex shrink-0 items-center gap-2 px-4 pb-1 pt-3">
          <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{title}</h3>
          {headExtra}
          <button
            type="button"
            role={`${role}-关闭按钮`}
            aria-label={MODAL_COPY.close}
            className="cursor-pointer px-1 text-sm text-faint transition-colors hover:text-accent"
            onClick={onClose}
          >
            ✕
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden px-4 pb-3 pt-1">{children}</div>
      </div>
    </div>
  );
}
