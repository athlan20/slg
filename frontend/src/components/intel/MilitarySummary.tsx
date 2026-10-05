/** 军情摘要（总览右上 / 地图页未选中时的右栏）：NPC 来袭 · 黄巾之乱 · 断粮与免战 · 流寇商队 · Agent 下一步，
 *  没有的条目不显示。条目是定高的行，走分页列表——卡片多矮都不会溢出。
 */

import type { ReactNode } from 'react';
import { formatDurationText } from '../../api/format';
import { movingIndexAt } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { tName } from '../../i18n/names';
import { recommendCell } from '../../state/interceptPlan';
import { useGame } from '../../state/GameContext';
import { useNav } from '../../state/NavContext';
import { useNow } from '../../state/useNow';
import { PagedList } from '../ui/PagedList';

interface SummaryRow {
  key: string;
  tone: 'bad' | 'warn' | 'gold' | 'normal';
  title: string;
  sub: string;
  right: ReactNode;
  /** 整行点击（NPC 来袭 → 提醒弹窗；黄巾 → 详情弹窗） */
  onClick?: () => void;
  role: string;
}

const TONE: Record<SummaryRow['tone'], string> = {
  bad: 'text-st-error',
  warn: 'text-warn',
  gold: 'text-gold',
  normal: 'text-fg',
};

export function MilitarySummary({ role }: { role: string }) {
  const copy = useCopy();
  const { EXTRA_PANEL, SUMMARY_COPY } = copy;
  const { session, incoming, openWarning, openYellowTurban, marchOrigin } = useGame();
  const { go } = useNav();
  const city = session.city;
  const now = useNow(true);
  const world = session.world;

  const rows: SummaryRow[] = [];

  const first = incoming[0];
  if (first) {
    rows.push({
      key: `npc-${first.attackId}`,
      tone: 'bad',
      role: '军情摘要-NPC来袭',
      title: SUMMARY_COPY.npc(first.target === 'city' ? SUMMARY_COPY.npcCity : SUMMARY_COPY.npcWild(first.x, first.y), first.level),
      sub: `${SUMMARY_COPY.npcSub(first.armyMin, first.armyMax, first.beaconLevel)}${incoming.length > 1 ? ` · ${EXTRA_PANEL.militarySummary.wavesTotal(incoming.length)}` : ''}`,
      right: <b className="font-mono tabular-nums text-st-error">{formatDurationText(Math.max(0, Math.ceil((Date.parse(first.arriveAt) - now) / 1000)))}</b>,
      onClick: openWarning,
    });
  }

  const yt = session.yellowTurban.state;
  if (yt?.event && yt.event.status === 'active') {
    const event = yt.event;
    rows.push({
      key: 'yt',
      tone: 'warn',
      role: '军情摘要-黄巾之乱',
      title: SUMMARY_COPY.yt(event.bossAppearedAt ? SUMMARY_COPY.ytStageBoss : SUMMARY_COPY.ytStageOuter),
      sub: SUMMARY_COPY.ytSub(event.clearedCamps, event.totalCamps, yt.me ? SUMMARY_COPY.ytMine(yt.me.killed, yt.me.rank) : SUMMARY_COPY.ytMineNone),
      right: <span className="font-mono tabular-nums text-dim">{formatDurationText(Math.max(0, Math.ceil((Date.parse(event.endsAt) - now) / 1000)))}</span>,
      onClick: openYellowTurban,
    });
  }

  if (city) {
    const net = city.production.food - city.armyFoodUsePerHour;
    const starveLeft = city.starveAt ? Math.max(0, Math.ceil((Date.parse(city.starveAt) - now) / 1000)) : null;
    const truceLeft = city.truceUntil ? Math.ceil((Date.parse(city.truceUntil) - now) / 1000) : 0;
    if (city.mutinyNextAt !== null || (starveLeft !== null && starveLeft * 1000 <= 3_600_000 / Math.max(1, city.timeScale)) || truceLeft > 0) {
      const starving = city.mutinyNextAt !== null || (starveLeft !== null && starveLeft * 1000 <= 3_600_000 / Math.max(1, city.timeScale));
      rows.push({
        key: 'starve-truce',
        tone: starving ? 'warn' : 'normal',
        role: '军情摘要-断粮免战',
        title: [starving ? SUMMARY_COPY.starve : null, truceLeft > 0 ? SUMMARY_COPY.truce : null].filter(Boolean).join(' · '),
        sub: [starving ? SUMMARY_COPY.starveSub(net, starveLeft !== null ? formatDurationText(starveLeft) : null) : null, truceLeft > 0 ? SUMMARY_COPY.truceSub(formatDurationText(truceLeft)) : null]
          .filter(Boolean)
          .join(' · '),
        right: starving ? (
          <button type="button" className="btn" onClick={() => go('army')}>
            {SUMMARY_COPY.goRecruit}
          </button>
        ) : null,
      });
    }
  }

  const alive = session.moving.targets.filter((target) => now < Date.parse(target.endsAt));
  if (alive.length > 0) {
    const nearest = alive
      .map((target) => {
        const index = movingIndexAt(target, now);
        const cell = index === null ? null : target.route[index];
        const dist = cell && marchOrigin ? Math.abs(cell.x - marchOrigin.x) + Math.abs(cell.y - marchOrigin.y) : null;
        return { target, cell, dist };
      })
      .filter((item) => item.cell !== null)
      .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity))[0];
    if (nearest && nearest.cell) {
      const rec = city ? recommendCell(nearest.target, marchOrigin, city.army, city, now) : null;
      const cell = nearest.cell;
      rows.push({
        key: 'moving',
        tone: 'gold',
        role: '军情摘要-流寇商队',
        title: SUMMARY_COPY.moving(alive.length),
        sub: `${SUMMARY_COPY.movingNearest(tName(nearest.target.label), nearest.target.level, nearest.dist)}${rec ? ` · ${SUMMARY_COPY.movingRecommend(rec.x, rec.y)}` : ''}`,
        right: (
          <button
            type="button"
            className="btn"
            onClick={() => {
              world.centerOn(cell.x, cell.y);
              world.selectTile(cell.x, cell.y);
              go('map');
            }}
          >
            {SUMMARY_COPY.locate}
          </button>
        ),
      });
    }
  }

  const agent = session.agent;
  rows.push({
    key: 'agent',
    tone: 'normal',
    role: '军情摘要-Agent下一步',
    title: SUMMARY_COPY.agentNext,
    sub: agent?.plan?.nextAction ?? SUMMARY_COPY.agentNone,
    right: <span className={`rounded border px-1.5 text-[10.5px] ${agent?.agentOnline ? 'border-accent-dim text-accent' : 'border-line text-faint'}`}>{agent?.agentOnline ? SUMMARY_COPY.agentOnline : SUMMARY_COPY.agentOffline}</span>,
  });

  return (
    <PagedList
      role={role}
      items={rows}
      keyOf={(row) => row.key}
      empty={<p className="py-4 text-center text-[12px] text-faint">{SUMMARY_COPY.empty}</p>}
      renderRow={(row) => {
        const Tag = row.onClick ? 'button' : 'div';
        return (
          <Tag
            role={row.role}
            type={row.onClick ? 'button' : undefined}
            onClick={row.onClick}
            className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[5px] border bg-panel-2 px-2 py-1 text-left ${
              row.tone === 'bad' ? 'border-st-error/60' : 'border-line-soft'
            } ${row.onClick ? 'cursor-pointer hover:border-accent-dim' : ''}`}
          >
            <span className="min-w-0">
              <b className={`block truncate text-[12px] font-semibold ${TONE[row.tone]}`} title={row.title}>
                {row.title}
              </b>
              <small className="block truncate text-[11px] text-faint" title={row.sub}>
                {row.sub}
              </small>
            </span>
            <span className="shrink-0 text-[12px]">{row.right}</span>
          </Tag>
        );
      }}
    />
  );
}
