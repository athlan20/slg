/** 底栏（docs 第 3 节）：所有进行中的事排成一行（建造 / 征兵 / 科技研究 / 行军，每项带剩余时间和底部进度条，
 *  放不下的截断），右侧一行最新全服播报，点开看播报历史（弹窗，分页）。< 1280 隐藏播报，< 1024 整个底栏隐藏。
 */

import { useState } from 'react';
import type { CityView, ResearchView, ServerBroadcastView } from '../../api/protocol';
import { formatDurationText, formatReportTime } from '../../api/format';
import { serverBroadcastText } from '../../api/mapping';
import { FOOT_COPY } from '../../copy-ui';
import { buildProgressItems } from '../../state/progressItems';
import { useNow } from '../../state/useNow';
import { Modal } from '../ui/Modal';
import { PagedList } from '../ui/PagedList';

interface BottomBarProps {
  city: CityView | null;
  research: ResearchView | null;
  broadcasts: ServerBroadcastView[];
  onOpenBroadcasts: () => void;
}

export function BottomBar({ city, research, broadcasts, onOpenBroadcasts }: BottomBarProps) {
  const [open, setOpen] = useState(false);
  const now = useNow(true);
  const items = buildProgressItems(city, research, now).sort((a, b) => (a.leftSec ?? Infinity) - (b.leftSec ?? Infinity));
  const latest = broadcasts[0];

  return (
    <footer
      role="导航-底栏"
      className="nav-foot flex min-w-0 items-center gap-2.5 rounded-panel border border-line bg-panel px-2.5 text-[11.5px] max-lg:hidden"
    >
      <span className="shrink-0 text-faint">{FOOT_COPY.running}</span>
      <div role="导航-单行时间线" className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
        {items.length === 0 ? (
          <span className="rounded border border-dashed border-line px-2 py-0.5 text-faint">{FOOT_COPY.idle}</span>
        ) : (
          items.map((item) => (
            <span
              key={item.id}
              role={`导航-时间线-${FOOT_COPY.lane[item.lane]}`}
              title={`${FOOT_COPY.lane[item.lane]}：${item.text}`}
              className="relative inline-flex shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap rounded border border-line bg-panel-2 px-2 py-0.5"
            >
              <span className="text-faint">{FOOT_COPY.lane[item.lane]}</span>
              <span>{item.text}</span>
              <span className={`font-mono tabular-nums ${item.ambush ? 'text-gold' : 'text-accent'}`}>
                {item.leftSec === null ? '排队' : formatDurationText(item.leftSec)}
              </span>
              <i className="absolute bottom-0 left-0 h-0.5 bg-accent" style={{ width: `${item.pct}%` }} />
            </span>
          ))
        )}
      </div>
      <button
        type="button"
        role="导航-全服播报"
        title={FOOT_COPY.feedOpen}
        onClick={() => {
          onOpenBroadcasts();
          setOpen(true);
        }}
        className="w-[340px] shrink-0 cursor-pointer truncate text-left text-dim hover:text-fg max-xl:hidden"
      >
        <b className="mr-1.5 font-medium text-gold">{FOOT_COPY.feedTag}</b>
        {latest ? serverBroadcastText(latest) : FOOT_COPY.feedEmpty}
      </button>
      {open ? (
        <Modal role="全服播报弹窗" title={FOOT_COPY.feedTitle} accent="gold" fill onClose={() => setOpen(false)}>
          <PagedList
            role="全服播报弹窗-列表"
            items={broadcasts.slice(0, 20)}
            keyOf={(item) => item.id}
            empty={<p className="py-6 text-center text-[13px] text-faint">{FOOT_COPY.feedEmpty}</p>}
            renderRow={(item) => (
              <p className="truncate border-b border-line-soft py-1 text-[12.5px] text-dim" title={serverBroadcastText(item)}>
                <span className="mr-1.5 font-mono text-[11px] text-faint">{formatReportTime(item.createdAt)}</span>
                {serverBroadcastText(item)}
              </p>
            )}
          />
        </Modal>
      ) : null}
    </footer>
  );
}
