/** 工作区卡片（panel 底 + line 边 + 6px 圆角）：页面网格的基本块。内容区 min-h-0，超出由内部分页 / 截断处理。 */

import type { ReactNode } from 'react';

interface CardProps {
  role: string;
  title?: ReactNode;
  /** 标题右侧的小字（统计 / 说明） */
  meta?: ReactNode;
  /** 标题行最右侧的操作（按钮等） */
  actions?: ReactNode;
  /** 无内边距（地图卡） */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function Card({ role, title, meta, actions, flush = false, className = '', children }: CardProps) {
  return (
    <section
      role={role}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-panel border border-line bg-panel ${flush ? '' : 'gap-2 p-2.5'} ${className}`}
    >
      {title !== undefined ? (
        <div
          role={`${role}-头部`}
          className={`flex shrink-0 items-baseline gap-2 ${flush ? 'border-b border-line-soft px-2.5 py-1.5' : ''}`}
        >
          <h2 className="truncate border-l-[3px] border-accent pl-2 text-[13.5px] font-semibold">{title}</h2>
          {meta !== undefined ? <span className="ml-auto min-w-0 truncate text-[11.5px] text-faint">{meta}</span> : null}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}
