// 联盟榜（AISLG-185，F2）：排行榜弹窗的「联盟榜」页签。顶部固定「我的联盟」一行（名次与势力来自 GET_LEADERBOARD 的 me，
// 名称取自我的联盟状态）；下方分页列出前 50 个联盟，点一条进入它的公开信息（公告、成员）——复用联盟面板的 DetailView，
// 在弹窗内切换视图，不叠第二层弹窗。没有联盟的玩家也能看，只是不出「申请加入」（已有联盟的看别的联盟同样不出）。

import { allianceErrorText } from '../api/errorText';
import { ALLIANCE_RANK_MIN_MEMBERS, type GetLeaderboardResponseData } from '../api/protocol';
import { useCopy } from '../i18n/bundle';
import type { AllianceSession } from '../state/allianceSession';
import { useNow } from '../state/useNow';
import { DetailView } from './alliance/AllianceNoPanel';
import { PagedList } from './ui/PagedList';

const ROW_GRID = 'grid grid-cols-[2.5rem_minmax(0,1fr)_auto] gap-2';

interface AllianceBoardListProps {
  view: GetLeaderboardResponseData;
  alliance: AllianceSession;
  onOpen: (allianceId: string) => void;
}

export function AllianceBoardList({ view, alliance, onOpen }: AllianceBoardListProps) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const mine = alliance.state?.alliance ?? null;
  const me = view.me;
  const entries = view.allianceEntries ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div role="排行榜弹窗-我的联盟" className={`${ROW_GRID} shrink-0 rounded border border-accent-dim/60 bg-panel-2 px-1.5 py-1 text-[13px]`}>
        <span className="font-mono text-accent">{me ? me.rank : mine ? COPY.board.notRanked : '—'}</span>
        <span className="min-w-0 truncate">
          {mine ? (
            <>
              <b className="text-fg">{mine.name}</b>
              <span className="ml-1.5 text-faint">{COPY.board.myAlliance}</span>
              {!me && mine.memberCount < ALLIANCE_RANK_MIN_MEMBERS ? <span className="ml-1.5 text-faint">{COPY.board.unrankedHint(ALLIANCE_RANK_MIN_MEMBERS)}</span> : null}
            </>
          ) : (
            <span className="text-faint">{COPY.board.noAlliance}</span>
          )}
        </span>
        <span className="text-right font-mono text-accent">{me ? me.value : '—'}</span>
      </div>
      <PagedList
        role="排行榜弹窗-联盟列表"
        items={entries}
        keyOf={(entry) => entry.allianceId}
        gap={2}
        gapClass="gap-0.5"
        empty={<p className="py-6 text-center text-[13px] text-faint">{COPY.board.empty}</p>}
        renderRow={(entry) => (
          <button
            type="button"
            role="排行榜弹窗-联盟条目"
            title={`${entry.name} · ${COPY.detail.leader(entry.leader.username)}`}
            onClick={() => onOpen(entry.allianceId)}
            className={`${ROW_GRID} w-full cursor-pointer border-t border-line-soft px-1 py-1 text-left text-[13px] hover:text-accent ${
              mine?.id === entry.allianceId ? 'text-accent' : 'text-dim'
            }`}
          >
            <span className="font-mono">{entry.rank}</span>
            <span className="min-w-0 truncate">
              <span className="text-fg">{entry.name}</span>
              <span className="ml-1.5 text-faint">{COPY.detail.leader(entry.leader.username)}</span>
              <span className="ml-1.5 text-faint">{COPY.board.members(entry.memberCount)}</span>
            </span>
            <span className="font-mono">{entry.value}</span>
          </button>
        )}
      />
    </div>
  );
}

interface AllianceBoardDetailProps {
  alliance: AllianceSession;
  allianceId: string;
  onBack: () => void;
}

/** 点开的联盟公开信息（公告、成员、势力与名次）；申请按钮只在我没有联盟时出现 */
export function AllianceBoardDetail({ alliance, allianceId, onBack }: AllianceBoardDetailProps) {
  const { ALLIANCE_COPY: COPY } = useCopy();
  const { state, error } = alliance;
  const cooldownUntil = state?.cooldownUntil ?? null;
  const now = useNow(cooldownUntil !== null);
  const cooling = cooldownUntil !== null && Date.parse(cooldownUntil) > now;
  if (state === null) {
    return <p className="py-6 text-center text-[13px] text-faint">{COPY.modal.loading}</p>;
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <DetailView
        alliance={alliance}
        state={state}
        cooling={cooling}
        allianceId={allianceId}
        onBack={onBack}
        fetchPublic={alliance.fetchPublic}
        canApply={state.alliance === null}
      />
      {error ? (
        <p role="排行榜弹窗-联盟错误" className="shrink-0 truncate text-[12px] text-st-error" title={allianceErrorText(error.code, error.message, error.data, error.scene)}>
          {allianceErrorText(error.code, error.message, error.data, error.scene)}
        </p>
      ) : null}
    </div>
  );
}
