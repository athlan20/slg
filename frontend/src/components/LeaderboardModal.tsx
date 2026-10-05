/** 全服排行榜弹窗（v23，AISLG-61）：三榜切换（综合战力 / 领地数量 / 累计掠夺）。
 *  显示前 50 名与本账号名次；数值来自服务端每 10 分钟整榜重算的快照，页面标注
 *  快照时间并提供手动刷新；托管中的账号带 Agent 标注（成绩记在同一账号上）。
 *  v50（AISLG-133）：玩家榜名字旁显示 Agent 自报模型（标注「自报」，不验证）；
 *  新增「模型榜」：按自报模型归类分组，排名 = 该模型实力前 10 名的平均战力，
 *  只统计最近 7 天 Agent 上线过的账号，口径说明展示在弹窗底部。
 *  数据经 GET_LEADERBOARD（op 43）按需拉取；入口在顶栏。
 */

import { useState } from 'react';
import { Modal } from './ui/Modal';
import { PagedList } from './ui/PagedList';
import { LEADERBOARD_KINDS, type LeaderboardKind, type LeaderboardView } from '../api/protocol';
import { formatReportTime } from '../api/mapping';
// role 定位值取静态中文文案源（AISLG-137 约定：role 不随界面语言变）
import { COPY as COPY_ZH } from '../copy';
import { useCopy } from '../i18n/bundle';
import { tName } from '../i18n/names';

export type { LeaderboardView } from '../api/protocol';

interface LeaderboardModalProps {
  view: LeaderboardView | null;
  loading: boolean;
  onClose: () => void;
  onSelectKind: (kind: LeaderboardKind) => void;
}

export function LeaderboardModal({ view, loading, onClose, onSelectKind }: LeaderboardModalProps) {
  const copy = useCopy();
  const { COPY } = copy;
  // 榜名随语言取用（原为模块级常量表，改在组件内构造）
  const KIND_LABEL: Record<LeaderboardKind, string> = {
    power: COPY.leaderboard.power,
    territory: COPY.leaderboard.territory,
    plunder: COPY.leaderboard.plunder,
    model: COPY.leaderboard.model,
  };
  const [tab, setTab] = useState<LeaderboardKind>(view?.kind ?? 'power');
  // 列头与行渲染以已到手的快照为准（切榜后快照未回时维持上一榜展示，与 v23 行为一致）
  const isModelView = (view?.kind ?? 'power') === 'model';
  const valueColumn = isModelView ? COPY.leaderboard.modelValueColumn : view ? KIND_LABEL[view.kind] : '';

  return (
    <Modal role="排行榜弹窗" title={COPY.leaderboard.title} accent="gold" fill onClose={onClose}>
      <div role="排行榜弹窗-榜切换" className="flex shrink-0 items-center gap-1">
        {LEADERBOARD_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role={`排行榜弹窗-切换-${COPY_ZH.leaderboard[kind]}`}
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
          <span>{isModelView ? COPY.leaderboard.modelColumn : COPY.leaderboard.playerColumn}</span>
          <span className="text-right">{valueColumn}</span>
        </div>
        {isModelView ? (
          <PagedList
            role="模型榜-列表"
            items={view?.modelEntries ?? []}
            keyOf={(entry) => entry.modelId}
            gap={2}
            gapClass="gap-0.5"
            empty={<p className="py-6 text-center text-[13px] text-faint">{COPY.leaderboard.empty}</p>}
            renderRow={(entry) => (
              <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-2 border-t border-line-soft px-1 py-1 text-[13px] text-dim">
                <span className="font-mono">{entry.rank}</span>
                <span className="min-w-0">
                  <span className="text-fg">{entry.label}</span>
                  <span className="ml-1.5 text-faint">{COPY.leaderboard.modelPlayers(entry.players)}</span>
                  {entry.topPlayer ? (
                    <span className="ml-1.5 hidden truncate text-faint sm:inline">{COPY.leaderboard.modelTop(entry.topPlayer.username, entry.topPlayer.value)}</span>
                  ) : null}
                </span>
                <span className="font-mono">{entry.value}</span>
              </div>
            )}
          />
        ) : (
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
                  <span className="min-w-0 truncate">
                    <span className="text-fg">{entry.username}</span>
                    <span className="ml-1.5 text-faint">{tName(entry.cityName)}</span>
                    {entry.agentOnline ? <span className="tag actor-system ml-1.5">{COPY.leaderboard.agentBadge}</span> : null}
                    {entry.agentModel ? (
                      <span role="排行榜-自报模型标注" className="tag ml-1.5" title={COPY.leaderboard.modelRule}>
                        {COPY.leaderboard.agentModelBadge(entry.agentModel)}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono">{entry.value}</span>
                </div>
              );
            }}
          />
        )}
      </div>

      <div role="排行榜弹窗-我的名次" className="flex shrink-0 items-center justify-between gap-2 border-t border-line-soft pt-2">
        {isModelView ? (
          <span role="排行榜弹窗-模型榜口径" className="min-w-0 text-[11px] leading-snug text-faint">{COPY.leaderboard.modelRule}</span>
        ) : (
          <span className="truncate text-[13px] text-dim">{view?.me ? COPY.leaderboard.myRank(view.me.rank, view.me.value) : COPY.leaderboard.myRankNone}</span>
        )}
        <span className={`shrink-0 text-[12px] ${loading ? 'text-faint' : 'text-accent'}`}>{loading ? COPY.leaderboard.refreshing : COPY.leaderboard.refresh}</span>
      </div>
    </Modal>
  );
}
