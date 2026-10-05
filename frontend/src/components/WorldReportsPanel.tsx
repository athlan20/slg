/** 战报列表卡（v13 起；导航重构后在情报页左）：首屏自动拉取 + 推送置顶 + beforeId 翻页。
 *  v23（AISLG-62）起并入侦察记录：与战斗战报同一个列表按时间混排（新→旧），
 *  用「侦察」标签与战报类别标签区分，点开即侦察报告弹窗（ScoutReportModal）——
 *  玩家只需要看一个地方。行点击弹出对应详情弹窗（BattleReportModal /
 *  ScoutReportModal，弹窗宿主在 App 根部）；列表只保留一行摘要。
 *  从 WorldDetailPanel 拆出以控制单文件行数；数据来自会话切片 worldSession。
 */

import { useEffect } from 'react';
import { TROOP_KINDS, type BattleReportView, type TroopKind } from '../api/protocol';
import { formatReportTime } from '../api/mapping';
import { getCopy, useCopy } from '../i18n/bundle';
import { Card } from './ui/Card';
import { PagedList } from './ui/PagedList';
import { useBattleReportModal } from '../state/battleReportModal';
import { useScoutReportModal } from '../state/scoutReportModal';
import type { ScoutRecord, WorldSession } from '../state/worldSession';

interface WorldReportsPanelProps {
  world: WorldSession;
  /** 战报行已看到的最大 id 变化时回调（情报页进入后角标清零用） */
  onSeen?: (maxId: number) => void;
}

/** 非零损失的编队摘要（战报列表行用）：「义兵×10 弓箭兵×2」 */
function armyLosses(army: Record<TroopKind, number>): string {
  const { TROOP_LABEL, EXTRA_MAP } = getCopy();
  const parts = TROOP_KINDS.filter((kind) => army[kind] > 0).map((kind) => `${TROOP_LABEL[kind].name}×${army[kind]}`);
  return parts.length > 0 ? parts.join(' ') : EXTRA_MAP.reports.lossesNone;
}

function reportKindLabel(report: BattleReportView): string {
  const { COPY, MOVING_COPY, YT_COPY } = getCopy();
  if (report.kind === 'intercept') {
    return MOVING_COPY.report.kind;
  }
  if (report.kind === 'yellow_turban') {
    return YT_COPY.report.kind;
  }
  if (report.kind === 'wilderness') {
    return COPY.worldMap.reportKindWilderness;
  }
  if (report.kind === 'city_raid') {
    return COPY.worldMap.reportKindCityRaid;
  }
  return report.kind === 'npc_city' ? COPY.worldMap.reportKindNpcCity : COPY.worldMap.reportKindNpcRaid;
}

/** 侦察记录行摘要的目标描述：「森林 Lv3」/「NPC 城池 Lv2」 */
function scoutTargetLabel(record: ScoutRecord): string {
  const { COPY, TERRAIN_LABEL } = getCopy();
  const base = record.intel.kind === 'npc_city' ? COPY.worldMap.reportKindNpcCity : TERRAIN_LABEL[record.intel.terrain];
  return record.intel.level > 0 ? `${base} Lv${record.intel.level}` : base;
}

export function WorldReportsPanel({ world, onSeen }: WorldReportsPanelProps) {
  const copy = useCopy();
  const { COPY, INTEL_COPY, EXTRA_MAP } = copy;
  const { openBattleReport } = useBattleReportModal();
  const { openScoutReport } = useScoutReportModal();

  // 首屏拉一次首页对齐（推送只在在线期间到达，断线期间的战报靠拉取兜底）；侦察记录一并拉取（v23 AISLG-62）
  useEffect(() => {
    if (world.battleReports === null) {
      void world.fetchBattleReports();
    }
    if (world.scoutRecords === null) {
      void world.fetchScoutRecords();
    }
  }, [world.battleReports, world.fetchBattleReports, world.scoutRecords, world.fetchScoutRecords]);

  // 看到的最大战报 id（进入情报页即视为已读）
  const maxId = (world.battleReports ?? []).reduce((max, report) => Math.max(max, report.id), 0);
  useEffect(() => {
    if (maxId > 0) {
      onSeen?.(maxId);
    }
  }, [maxId, onSeen]);

  // 合并列表（新→旧）：战报按 createdAt、侦察记录按事件时间各带时间戳排序
  type ReportRow =
    | { key: string; time: number; kind: 'battle'; battle: BattleReportView }
    | { key: string; time: number; kind: 'scout'; scout: ScoutRecord };
  const battleRows: ReportRow[] = (world.battleReports ?? []).map((report) => ({ key: `battle-${report.id}`, time: Date.parse(report.createdAt), kind: 'battle' as const, battle: report }));
  const scoutRows: ReportRow[] = (world.scoutRecords ?? []).map((record) => ({ key: `scout-${record.id}`, time: Date.parse(record.at), kind: 'scout' as const, scout: record }));
  const rows = [...battleRows, ...scoutRows].sort((a, b) => b.time - a.time).slice(0, 50);

  return (
    <Card
      role="左列-战报列表"
      title={INTEL_COPY.reportsTitle}
      actions={
        <button
          type="button"
          role="左列-战报刷新按钮"
          disabled={world.reportsLoading}
          onClick={() => {
            void world.fetchBattleReports();
            void world.fetchScoutRecords();
          }}
          className="ml-auto cursor-pointer rounded border border-line px-1.5 text-[11.5px] text-dim disabled:cursor-not-allowed disabled:opacity-40"
        >
          {COPY.worldMap.reportsRefresh}
        </button>
      }
    >
      <PagedList
        role="战报-列表"
        items={rows}
        keyOf={(row) => row.key}
        hasMore={!world.reportsExhausted && world.battleReports !== null}
        loadingMore={world.reportsLoadingOlder}
        onLoadMore={() => void world.loadOlderBattleReports()}
        empty={<p className="py-3 text-center text-[12.5px] text-faint">{world.battleReports === null && world.reportsLoading ? COPY.worldMap.reportsLoading : COPY.worldMap.reportsEmpty}</p>}
        renderRow={(row) => {
          if (row.kind === 'battle') {
            const report = row.battle;
            // attacker/defender 是绝对攻守身份；列表展示按 role 选边后的「对方」与我方损失
            const opponent = report.role === 'attacker' ? report.defender : report.attacker;
            const myLosses = report.role === 'attacker' ? report.attacker.losses : report.defender.losses;
            const result = report.endReason === 'no_contact' ? (report.contact === 'gone' ? EXTRA_MAP.reports.resultGone : EXTRA_MAP.reports.resultMissed) : report.won ? COPY.worldMap.reportWon : COPY.worldMap.reportLost;
            const sub = `(${report.x},${report.y}) · ${COPY.battleReport.roundsMeta(report.rounds)} · ${COPY.worldMap.reportMyLosses(armyLosses(myLosses))}`;
            return (
              <button
                type="button"
                role="左列-战报行"
                title={`${opponent.name}\n${sub}\n${COPY.worldMap.reportOpenHint}`}
                onClick={() => openBattleReport(report)}
                className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-1 text-left transition-colors hover:border-accent-dim hover:bg-accent-soft"
              >
                <span className="min-w-0">
                  <span className="flex min-w-0 items-baseline gap-1.5 text-[12.5px]">
                    <span className="tag shrink-0">{reportKindLabel(report)}</span>
                    <span className="truncate">{opponent.name}</span>
                    <span className="shrink-0 font-mono text-[10.5px] text-faint">{COPY.battleReport.idBadge(report.id)}</span>
                  </span>
                  <small className="block truncate text-[11px] text-dim">{sub}</small>
                </span>
                <span className="flex shrink-0 flex-col items-end leading-tight">
                  <b className={`font-mono text-[12px] ${report.won ? 'text-ok' : 'text-warn'}`}>{result}</b>
                  <span className="font-mono text-[10.5px] text-faint">{formatReportTime(report.createdAt)}</span>
                </span>
              </button>
            );
          }
          const record = row.scout;
          const garrisonTotal = TROOP_KINDS.reduce((sum, kind) => sum + Math.max(0, record.intel.garrison[kind] ?? 0), 0);
          const sub = `(${record.intel.x},${record.intel.y})${record.intel.wallDefensePercent > 0 ? ` · ${EXTRA_MAP.reports.wallShort(record.intel.wallDefensePercent)}` : ''}`;
          return (
            <button
              type="button"
              role="左列-侦察记录行"
              title={`${scoutTargetLabel(record)}\n${sub}\n${COPY.worldMap.reportScoutHint}`}
              onClick={() => openScoutReport(record.intel)}
              className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-1 text-left transition-colors hover:border-accent-dim hover:bg-accent-soft"
            >
              <span className="min-w-0">
                <span className="flex min-w-0 items-baseline gap-1.5 text-[12.5px]">
                  <span className="tag actor-system shrink-0">{COPY.worldMap.reportKindScout}</span>
                  <span className="truncate">{scoutTargetLabel(record)}</span>
                </span>
                <small className="block truncate text-[11px] text-dim">{sub}</small>
              </span>
              <span className="flex shrink-0 flex-col items-end leading-tight">
                <b className="font-mono text-[12px] font-medium text-dim">{COPY.worldMap.reportScoutGarrison(garrisonTotal)}</b>
                <span className="font-mono text-[10.5px] text-faint">{formatReportTime(record.at)}</span>
              </span>
            </button>
          );
        }}
      />
    </Card>
  );
}
