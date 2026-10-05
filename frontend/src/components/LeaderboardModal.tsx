/** 全服排行榜弹窗（v23，AISLG-61）：三榜切换（综合战力 / 领地数量 / 累计掠夺）。
 *  显示前 50 名与本账号名次；数值来自服务端每 10 分钟整榜重算的快照，页面标注
 *  快照时间并提供手动刷新；托管中的账号带 Agent 标注（成绩记在同一账号上）。
 *  数据经 GET_LEADERBOARD（op 43）按需拉取；入口在顶栏。
 */

import { useState } from 'react';
import { Modal } from './ui/Modal';
import { PagedList } from './ui/PagedList';
import { LEADERBOARD_KINDS, type LeaderboardKind, type LeaderboardView } from '../api/protocol';
import { formatReportTime } from '../api/mapping';
import { COPY } from '../copy';

export type { LeaderboardView } from '../api/protocol';

interface LeaderboardModalProps {
  view: LeaderboardView | null;
  loading: boolean;
  onClose: () => void;
  onSelectKind: (kind: LeaderboardKind) => void;
}

const KIND_LABEL: Record<LeaderboardKind, string> = {
  power: COPY.leaderboard.power,
  territory: COPY.leaderboard.territory,
  plunder: COPY.leaderboard.plunder,
};

export function LeaderboardModal({ view, loading, onClose, onSelectKind }: LeaderboardModalProps) {
  const [tab, setTab] = useState<LeaderboardKind>(view?.kind ?? 'power');

  return (
    <Modal role="排行榜弹窗" title={COPY.leaderboard.title} accent="gold" fill onClose={onClose}>
      <div role="排行榜弹窗-榜切换" className="flex shrink-0 items-center gap-1">
        {LEADERBOARD_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role={`排行榜弹窗-切换-${KIND_LABEL[kind]}`}
            onClick={() => {
              setTab(kind);
              onSelectKind(kind);
            }}
            className={`cursor-pointer rounded border px-2.5 py-0.5 text-[13px] transition-colors ${tab === kind ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'}`}
          >
            {KIND_LABEL[kind]}
          </button>
        ))}
        <span role="排行榜弹窗-快照时间" className="ml-auto truncate text-[11px] text-faint">
          {view ? COPY.leaderboard.updatedAt(formatReportTime(view.updatedAt)) : ''}
        </span>
      </div>

      <div role="排行榜弹窗-榜单" className="flex min-h-0 flex-1 flex-col">
        <div className="grid shrink-0 grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-2 px-1 text-[12px] text-faint">
          <span>{COPY.leaderboard.rankColumn}</span>
          <span>{COPY.leaderboard.playerColumn}</span>
          <span className="text-right">{view ? KIND_LABEL[view.kind] : ''}</span>
        </div>
        <PagedList
          role="排行榜-列表"
          items={view?.entries ?? []}
          keyOf={(entry) => entry.accountId}
          gap={2}
          gapClass="gap-0.5"
          empty={<p className="py-6 text-center text-[13px] text-faint">{COPY.leaderboard.empty}</p>}
          renderRow={(entry) => {
            const mine = view !== null && view.me !== null && view.me.rank === entry.rank;
            return (
              <div className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-2 border-t border-line-soft px-1 py-1 text-[13px] ${mine ? 'text-accent' : 'text-dim'}`}>
                <span className="font-mono">{entry.rank}</span>
                <span className="truncate">
                  <span className="text-fg">{entry.username}</span>
                  <span className="ml-1.5 text-faint">{entry.cityName}</span>
                  {entry.agentOnline ? <span className="tag actor-system ml-1.5">{COPY.leaderboard.agentBadge}</span> : null}
                </span>
                <span className="font-mono">{entry.value}</span>
              </div>
            );
          }}
        />
      </div>

      <div role="排行榜弹窗-我的名次" className="flex shrink-0 items-center justify-between gap-2 border-t border-line-soft pt-2">
        <span className="truncate text-[13px] text-dim">{view?.me ? COPY.leaderboard.myRank(view.me.rank, view.me.value) : COPY.leaderboard.myRankNone}</span>
        <span className={`shrink-0 text-[12px] ${loading ? 'text-faint' : 'text-accent'}`}>{loading ? COPY.leaderboard.refreshing : COPY.leaderboard.refresh}</span>
      </div>
    </Modal>
  );
}
