// 竞技场面板（v53，AISLG-145）：养成页的一个区块。上方是我的名次与今日次数，中间是 3 个号位的阵容编辑，
// 下方用分段切换「对手 / 榜单 / 战报」，三个列表都用分页（不滚动）。规则与数值见服务端 arena.ts。

import { useState } from 'react';
import type { HeroView } from '../api/protocol-hero';
import type { ArenaFighterView, ArenaMatchView, ArenaOpponentView, ArenaTopEntryView } from '../api/protocol';
import { useCopy } from '../i18n/bundle';
import type { ArenaSession } from '../state/arenaSession';
import { LineupEditor } from './LineupEditor';
import { Card } from './ui/Card';
import { PagedList } from './ui/PagedList';

type ArenaTab = 'opponents' | 'top' | 'reports';

interface ArenaPanelProps {
  /** 我的武将（阵容下拉的候选） */
  heroes: HeroView[];
  session: ArenaSession;
}

/** 冷却按服务端下发的秒数显示：服务端已按时间倍率缩放，倍率高时可能只有几秒，不能四舍五入成 0 分钟 */
function cooldownText(seconds: number, copy: { cooldown: { seconds: (n: number) => string; minutes: (n: number) => string } }): string {
  return seconds >= 60 ? copy.cooldown.minutes(Math.round(seconds / 60)) : copy.cooldown.seconds(seconds);
}

function clockText(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function namesOf(lineup: Array<ArenaFighterView | null>): string[] {
  return lineup.filter((f): f is ArenaFighterView => f !== null).map((f) => f.name);
}

export function ArenaPanel({ heroes, session }: ArenaPanelProps) {
  const copy = useCopy();
  const { ARENA_COPY } = copy;
  const { arena, reports, reportsHasMore, error, busy, saveLineup, challenge, fetchReports } = session;
  const [tab, setTab] = useState<ArenaTab>('opponents');
  const challengesLeft = arena?.challengesLeft ?? 0;
  const rulesLine = arena
    ? ARENA_COPY.panel.rules(arena.rules.maxRankGap, arena.rules.dailyChallenges, cooldownText(arena.rules.pairCooldownSeconds, ARENA_COPY.panel))
    : '';

  return (
    <Card role="养成页-竞技场" title={ARENA_COPY.panel.title} meta={arena ? <span role="养成页-竞技场-席位">{ARENA_COPY.panel.total(arena.totalEntries)}</span> : undefined}>
      {arena ? (
        <div role="养成页-竞技场-概况" className="flex shrink-0 flex-col gap-0.5 text-[12px]">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span role="养成页-竞技场-名次" className="font-mono text-[13px] font-semibold text-accent">
              {arena.joined && arena.rank !== null ? ARENA_COPY.panel.rank(arena.rank) : ARENA_COPY.panel.notJoined}
            </span>
            {arena.bestRank !== null ? <span className="font-mono text-faint">{ARENA_COPY.panel.best(arena.bestRank)}</span> : null}
            <span className="font-mono text-dim">{ARENA_COPY.panel.challenges(arena.challengesLeft, arena.challengesMax)}</span>
            <span className="font-mono text-dim">{ARENA_COPY.panel.defended(arena.defendedToday, arena.defendedMax)}</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-faint">
            <span className="font-mono">{ARENA_COPY.panel.nextDay(clockText(arena.nextDayAt))}</span>
            <span className="font-mono">{ARENA_COPY.panel.reward(arena.dailyReward)}</span>
          </div>
          <p className="truncate text-[11px] text-faint" title={rulesLine}>
            {rulesLine}
          </p>
        </div>
      ) : null}

      <LineupEditor
        role="养成页-竞技场-阵容"
        heroes={heroes}
        lineup={arena ? arena.lineup : null}
        busy={busy}
        copy={ARENA_COPY.panel}
        onSave={(heroIds) => void saveLineup(heroIds)}
      />

      {error ? (
        <p role="养成页-竞技场-错误" className="shrink-0 truncate text-[12px] text-warn" title={error}>
          {error}
        </p>
      ) : null}

      <div role="养成页-竞技场-分段" className="flex shrink-0 gap-1">
        {(['opponents', 'top', 'reports'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role={`养成页-竞技场-分段-${key}`}
            onClick={() => setTab(key)}
            className={`cursor-pointer rounded border px-2 py-0.5 text-[11.5px] ${tab === key ? 'border-accent text-accent' : 'border-line-soft text-dim'}`}
          >
            {ARENA_COPY.panel.tabs[key]}
          </button>
        ))}
      </div>

      {tab === 'opponents' ? (
        <PagedList<ArenaOpponentView>
          role="养成页-竞技场-对手"
          items={arena?.opponents ?? []}
          keyOf={(row) => row.entryId}
          gap={3}
          gapClass="gap-[3px]"
          empty={<p className="text-[12px] text-faint">{ARENA_COPY.panel.opponentsEmpty}</p>}
          renderRow={(row) => (
            <div role={`养成页-竞技场-对手-${row.rank}`} className="flex min-w-0 items-center gap-1.5 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-1 text-[12px]">
              <span className="shrink-0 font-mono text-accent">{ARENA_COPY.panel.rankOf(row.rank)}</span>
              <span className="min-w-0 flex-1 truncate" title={`${row.username} · ${namesOf(row.lineup).join(' · ')}`}>
                {row.username}
                {row.npc ? <span className="ml-1 text-[10.5px] text-faint">{ARENA_COPY.panel.npcTag}</span> : null}
                <span className="ml-1 text-[11px] text-faint">{namesOf(row.lineup).join(' · ')}</span>
              </span>
              {row.npc ? null : <span className="shrink-0 font-mono text-[11px] text-faint">{ARENA_COPY.panel.defendedToday(row.defendedToday, arena?.defendedMax ?? 0)}</span>}
              <button
                type="button"
                role={`养成页-竞技场-挑战-${row.rank}`}
                disabled={busy || challengesLeft === 0}
                onClick={() => void challenge(row.entryId)}
                className="btn shrink-0 truncate px-2 py-0.5 text-[11.5px]"
              >
                {busy ? ARENA_COPY.panel.challenging : ARENA_COPY.panel.challenge}
              </button>
            </div>
          )}
        />
      ) : null}

      {tab === 'top' ? (
        <PagedList<ArenaTopEntryView>
          role="养成页-竞技场-榜单"
          items={arena?.top ?? []}
          keyOf={(row) => row.rank}
          gap={3}
          gapClass="gap-[3px]"
          empty={<p className="text-[12px] text-faint">{ARENA_COPY.panel.topEmpty}</p>}
          renderRow={(row) => (
            <div role={`养成页-竞技场-榜单-${row.rank}`} className="flex min-w-0 items-center gap-1.5 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-1 text-[12px]">
              <span className="shrink-0 font-mono text-accent">{ARENA_COPY.panel.rankOf(row.rank)}</span>
              <span className="min-w-0 flex-1 truncate">{row.username}</span>
              {row.npc ? <span className="shrink-0 text-[10.5px] text-faint">{ARENA_COPY.panel.npcTag}</span> : null}
            </div>
          )}
        />
      ) : null}

      {tab === 'reports' ? (
        <PagedList<ArenaMatchView>
          role="养成页-竞技场-战报"
          items={reports ?? []}
          keyOf={(row) => row.id}
          gap={3}
          gapClass="gap-[3px]"
          hasMore={reportsHasMore}
          onLoadMore={() => void fetchReports(true)}
          empty={<p className="text-[12px] text-faint">{ARENA_COPY.panel.reportsEmpty}</p>}
          renderRow={(row) => {
            // role 指明「我」是哪一方：挑战方看 challenger，守擂方看 defender
            const iAmChallenger = row.role === 'challenger';
            const mine = iAmChallenger ? row.challenger : row.defender;
            const opponent = iAmChallenger ? row.defender.username : row.challenger.username;
            const won = iAmChallenger ? row.challengerWon : !row.challengerWon;
            const label = iAmChallenger ? ARENA_COPY.panel.asChallenger : ARENA_COPY.panel.asDefender;
            return (
              <div role={`养成页-竞技场-战报-${row.id}`} className="flex min-w-0 items-center gap-1.5 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-1 text-[12px]">
                <span className={`shrink-0 font-semibold ${won ? 'text-ok' : 'text-warn'}`}>{won ? ARENA_COPY.panel.won : ARENA_COPY.panel.lost}</span>
                <span className="min-w-0 flex-1 truncate" title={`${label} ${opponent}`}>
                  {label} {opponent}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-faint">{ARENA_COPY.panel.score(row.challengerWins, row.defenderWins)}</span>
                <span className="shrink-0 font-mono text-[11px] text-dim">{ARENA_COPY.panel.rankChange(mine.rankBefore, mine.rankAfter)}</span>
              </div>
            );
          }}
        />
      ) : null}
    </Card>
  );
}
