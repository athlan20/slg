/** 战报详情弹窗（v13）：双方编成损益对比、输出占比、伤害走势图与逐回合明细。
 *  打开入口收敛在 state/battleReportModal（useBattleReportModal().openBattleReport），
 *  本组件只负责把一份 BattleReportView 渲染成弹窗，可在任意功能块里调出。
 *  视角规则（协议约定）：attacker/defender 字段是绝对攻守身份，「我方 / 敌方」按
 *  report.role 选边；roundLog 的攻/守数值在展示前统一换算成我方/敌方。
 */

import { MOVING_COPY } from '../copy-moving';
import { YT_COPY } from '../copy-yt';
import { DEFENSE_COPY } from '../copy-defense';
import { HERO_COPY } from '../copy-hero';
import { useState } from 'react';
import { Modal } from './ui/Modal';
import { TROOP_KINDS, type ArmyCounts, type BattleReportView, type BattleSideView } from '../api/protocol';
import { formatReportTime } from '../api/mapping';
import { COPY, TROOP_LABEL } from '../copy';
import { BattleRoundChart } from './BattleRoundChart';

interface BattleReportModalProps {
  report: BattleReportView;
  onClose: () => void;
}

function totalOf(army: ArmyCounts): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + army[kind], 0);
}

function kindTitle(report: BattleReportView): string {
  if (report.kind === 'intercept') {
    return MOVING_COPY.report.kind;
  }
  if (report.kind === 'yellow_turban') {
    return YT_COPY.report.kind;
  }
  if (report.kind === 'wilderness') {
    return COPY.battleReport.kindWilderness;
  }
  if (report.kind === 'city_raid') {
    return COPY.battleReport.kindCityRaid;
  }
  if (report.kind === 'pvp_raid') {
    return COPY.battleReport.kindPvpRaid;
  }
  if (report.kind === 'pvp_wilderness') {
    return COPY.battleReport.kindPvpWilderness;
  }
  if (report.kind === 'pvp_conquest') {
    return COPY.battleReport.kindPvpConquest;
  }
  return report.kind === 'npc_city' ? COPY.battleReport.kindNpcCity : COPY.battleReport.kindNpcRaid;
}

function endReasonText(report: BattleReportView): string {
  if (report.endReason === 'no_contact') {
    // 截击未接战（v28 AISLG-78）：扑空 / 目标消失
    return report.contact === 'gone' ? MOVING_COPY.report.endNoContactGone : MOVING_COPY.report.endNoContactMissed;
  }
  if (report.endReason === 'defender_wiped') {
    return COPY.battleReport.endWiped;
  }
  return report.endReason === 'attacker_wiped' ? COPY.battleReport.endAttackerWiped : COPY.battleReport.endRoundLimit;
}

/** 一方编成卡片：初始 → 幸存的兵种行（条形为幸存 / 损失占比），底部合计与总输出 */
function SideCard({ side, roleTag, mine, attacker }: { side: BattleSideView; roleTag: string; mine: boolean; attacker: boolean }) {
  const rows = TROOP_KINDS.filter((kind) => side.troops[kind] > 0);
  const lossesTotal = totalOf(side.losses);
  const survivorsTotal = totalOf(side.survivors);
  const barTone = mine ? 'bg-accent' : 'bg-warn';
  return (
    <div role={mine ? '战报弹窗-我方卡片' : '战报弹窗-敌方卡片'} className="flex min-w-0 flex-col gap-1">
      <p className="flex items-baseline gap-1.5">
        <span className={`tag ${mine ? '' : 'actor-system'}`}>{mine ? COPY.battleReport.sideMine : COPY.battleReport.sideEnemy} · {roleTag}</span>
        <span className="truncate text-sm font-semibold">{side.name}</span>
      </p>
      {rows.length === 0 ? (
        <p className="text-[12px] text-faint">{COPY.battleReport.noTroops}</p>
      ) : (
        rows.map((kind) => {
          const initial = side.troops[kind];
          const survived = side.survivors[kind];
          const lost = side.losses[kind];
          return (
            <div key={kind} role={`战报弹窗-兵种行-${TROOP_LABEL[kind].short}`} className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-1.5 leading-tight">
              <span className="text-[12px] text-dim">{TROOP_LABEL[kind].name}</span>
              <span className="flex h-[5px] overflow-hidden rounded bg-line">
                <i className={`block h-full ${barTone}`} style={{ width: `${(survived / initial) * 100}%` }} />
                <i className="block h-full bg-warn/50" style={{ width: `${(lost / initial) * 100}%` }} />
              </span>
              <span className="font-mono text-[12px] text-dim">
                {initial} → {survived}
                {lost > 0 ? <span className="text-warn"> −{lost}</span> : null}
              </span>
            </div>
          );
        })
      )}
      {side.hero ? (
        <p role={mine ? '战报弹窗-我方将领' : '战报弹窗-敌方将领'} className="text-[12px] text-accent">
          {(attacker ? HERO_COPY.report.attackerHero : HERO_COPY.report.defenderHero)(
            side.hero.name, side.hero.lead, side.hero.force, side.hero.wit, side.hero.atkPercent, side.hero.defPercent,
          )}
        </p>
      ) : null}
      {side.units > 0 ? (
        <p
          role={mine ? '战报弹窗-我方射程' : '战报弹窗-敌方射程'}
          title={COPY.battleReport.rangeTip}
          className="font-mono text-[12px] text-faint"
        >
          {COPY.battleReport.rangeLine(side.maxRange, side.rangedUnits)}
        </p>
      ) : null}
      <p className="mt-auto flex items-baseline justify-between border-t border-line-soft pt-1.5 font-mono text-[12px] text-dim">
        <span>
          {COPY.battleReport.statSurvivors} {survivorsTotal}
          <span className="text-warn"> −{lossesTotal}</span>
        </span>
        <span>
          {COPY.battleReport.statDamage} <span className={mine ? 'text-accent' : 'text-warn'}>{Math.round(side.damage)}</span>
        </span>
      </p>
    </div>
  );
}

/** 逐回合明细每页格数（8 列 × 2 行）：长战报分页，不出滚动条 */
const ROUNDS_PER_PAGE = 16;

export function BattleReportModal({ report, onClose }: BattleReportModalProps) {
  const [view, setView] = useState<'chart' | 'rounds'>('chart');
  const [roundPage, setRoundPage] = useState(0);
  const mineIsAttacker = report.role === 'attacker';
  const mySide = mineIsAttacker ? report.attacker : report.defender;
  const enemySide = mineIsAttacker ? report.defender : report.attacker;
  const damageTotal = mySide.damage + enemySide.damage;
  const myDamagePct = damageTotal > 0 ? (mySide.damage / damageTotal) * 100 : 50;
  // 回合耗尽时攻方幸存者在返程行军中（协议约定：到达后才入城），给一句提示
  const showReturnNote = report.endReason === 'round_limit' && mineIsAttacker && totalOf(mySide.survivors) > 0;
  const roundPages = Math.max(1, Math.ceil(report.roundLog.length / ROUNDS_PER_PAGE));
  const page = Math.min(roundPage, roundPages - 1);
  const result =
    report.endReason === 'no_contact' ? (report.contact === 'gone' ? '目标消失' : '扑 空') : report.won ? COPY.battleReport.resultWon : COPY.battleReport.resultLost;

  return (
    <Modal
      role="战报弹窗"
      accent={report.won ? 'gold' : 'warn'}
      onClose={onClose}
      title={
        <>
          <span className="tag mr-2">{kindTitle(report)}</span>
          {mySide.name}
          <span className="mx-1.5 font-mono text-[12px] font-normal text-faint">{COPY.battleReport.versus}</span>
          {enemySide.name}
        </>
      }
      headExtra={
        <span
          role="战报弹窗-胜负徽章"
          className={`shrink-0 rounded border px-2 py-0.5 text-[14px] font-bold tracking-[0.25em] ${report.won ? 'border-gold bg-gold/10 text-gold' : 'border-warn bg-warn/10 text-warn'}`}
        >
          {result}
        </span>
      }
    >
      <p role="战报弹窗-头部" className="truncate font-mono text-[12px] text-faint">
        {COPY.battleReport.location(report.x, report.y)} · {COPY.battleReport.idBadge(report.id)} · {formatReportTime(report.createdAt)} · {COPY.battleReport.roundsMeta(report.rounds)} · {endReasonText(report)}
        {report.wallDefensePercent > 0 ? <span className="text-dim"> · {COPY.battleReport.wallBadge(report.wallDefensePercent)}</span> : null}
        {report.wallBreak ? (
          <span role="战报弹窗-冲车破墙" className="text-gold"> · {DEFENSE_COPY.report.wallBreak(report.wallBreak.from, report.wallBreak.to)}</span>
        ) : null}
        {(report.towerDamage ?? 0) > 0 ? (
          <span role="战报弹窗-箭塔伤害" className="text-gold"> · {DEFENSE_COPY.report.towerDamage(report.towerDamage ?? 0)}</span>
        ) : null}
      </p>

      {report.comment ? (
        <div role="战报弹窗-Agent点评" className="shrink-0 rounded border border-accent-dim bg-accent-soft px-2.5 py-1">
          <p className="text-[11px] font-semibold text-accent">{COPY.battleReport.commentTitle}</p>
          <p className="line-clamp-2 text-[13px] text-fg" title={report.comment.text}>{report.comment.text}</p>
          <p className="font-mono text-[11px] text-faint">{COPY.battleReport.commentAt(formatReportTime(report.comment.updatedAt))}</p>
        </div>
      ) : null}

      <div role="战报弹窗-双方编成" className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3">
        <SideCard side={mySide} roleTag={mineIsAttacker ? COPY.battleReport.roleAttacker : COPY.battleReport.roleDefender} mine attacker={mineIsAttacker} />
        <div role="战报弹窗-对阵分隔" className="flex flex-col items-center justify-center gap-1">
          <span className="w-px flex-1 bg-line-soft" />
          <span className="grid size-7 place-items-center rounded-full border border-line font-mono text-[11px] text-faint">{COPY.battleReport.versus}</span>
          <span className="w-px flex-1 bg-line-soft" />
        </div>
        <SideCard side={enemySide} roleTag={mineIsAttacker ? COPY.battleReport.roleDefender : COPY.battleReport.roleAttacker} mine={false} attacker={!mineIsAttacker} />
      </div>

      <div role="战报弹窗-输出占比" className="shrink-0">
        <div className="flex h-[6px] overflow-hidden rounded bg-line">
          <i className="block h-full bg-accent" style={{ width: `${myDamagePct}%` }} />
          <i className="block h-full bg-warn" style={{ width: `${100 - myDamagePct}%` }} />
        </div>
        <p className="mt-0.5 flex justify-between font-mono text-[11px] text-faint">
          <span>{COPY.battleReport.damageShareLabel}</span>
          <span>
            {Math.round(myDamagePct)}% / {Math.round(100 - myDamagePct)}%
          </span>
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {(
          [
            ['chart', COPY.battleReport.chartTitle],
            ['rounds', COPY.battleReport.roundsTitle(report.rounds)],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role={key === 'rounds' ? '战报弹窗-逐回合明细' : '战报弹窗-伤害走势'}
            aria-pressed={view === key}
            onClick={() => setView(key)}
            className={`cursor-pointer truncate rounded border px-2 py-0.5 text-[12px] ${view === key ? 'border-accent bg-accent-soft text-accent' : 'border-line text-dim hover:text-fg'}`}
          >
            {label}
          </button>
        ))}
        {view === 'rounds' && roundPages > 1 ? (
          <span className="ml-auto flex items-center gap-1.5 text-[11.5px] text-faint">
            <button type="button" disabled={page === 0} onClick={() => setRoundPage(page - 1)} className="grid h-5 w-5 cursor-pointer place-items-center rounded border border-line bg-panel-2 text-dim disabled:cursor-not-allowed disabled:opacity-40">‹</button>
            <span className="font-mono">{page + 1} / {roundPages}</span>
            <button type="button" disabled={page >= roundPages - 1} onClick={() => setRoundPage(page + 1)} className="grid h-5 w-5 cursor-pointer place-items-center rounded border border-line bg-panel-2 text-dim disabled:cursor-not-allowed disabled:opacity-40">›</button>
          </span>
        ) : null}
      </div>

      {view === 'chart' ? (
        <BattleRoundChart report={report} />
      ) : (
        <div className="grid grid-cols-[repeat(8,minmax(0,1fr))] gap-1">
          {report.roundLog.slice(page * ROUNDS_PER_PAGE, page * ROUNDS_PER_PAGE + ROUNDS_PER_PAGE).map((entry) => {
            const myDamage = mineIsAttacker ? entry.attackerDamage : entry.defenderDamage;
            const enemyDamage = mineIsAttacker ? entry.defenderDamage : entry.attackerDamage;
            const myKilled = mineIsAttacker ? entry.attackerKilled : entry.defenderKilled;
            const enemyKilled = mineIsAttacker ? entry.defenderKilled : entry.attackerKilled;
            return (
              <div
                key={entry.round}
                title={COPY.battleReport.roundChipTip(entry.round, myDamage, enemyDamage, myKilled, enemyKilled)}
                className="min-w-0 rounded border border-line-soft bg-panel-2 px-1.5 py-1 font-mono text-[11px]"
              >
                <p className="text-faint">R{entry.round}</p>
                <p className="truncate">
                  <span className="text-accent">{myDamage}</span>
                  <span className="text-faint"> / </span>
                  <span className="text-warn">{enemyDamage}</span>
                </p>
                <p className="truncate text-faint">{myKilled + enemyKilled > 0 ? COPY.battleReport.roundKilled(myKilled, enemyKilled) : '\u00a0'}</p>
              </div>
            );
          })}
        </div>
      )}

      {showReturnNote ? (
        <p role="战报弹窗-返程提示" className="shrink-0 text-[12px] text-faint">
          {COPY.battleReport.returnNote}
        </p>
      ) : null}
    </Modal>
  );
}
