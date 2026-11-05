// 探索简报的本地存放（AISLG-224 第五步）：PUSH_EXPLORATION_REPORT 到达时入栈，地图页的简报卡片读取。
// 只保留最近几条；关闭后不再显示。模块级存储，用 useSyncExternalStore 订阅。
import { useSyncExternalStore } from 'react';

export interface ExplorationReportCell {
  x: number;
  y: number;
  kind: 'famous' | 'relic' | 'wild_hero' | 'gold_mine' | 'player_city' | 'npc_city' | 'high_wilderness';
  level?: number;
}

export interface ExplorationReport {
  eventId: number;
  marchId?: string;
  chunks: number;
  npcCities?: { total: number; byLevel: Record<string, number> };
  goldMines?: number;
  highWilderness?: number;
  wildHeroes?: number;
  playerCities?: number;
  famous?: number;
  /** 未领取的遗迹（v93，AISLG-227）：总数与按种类计数 */
  relics?: { total: number; byKind: Record<string, number> };
  cells: ExplorationReportCell[];
}

const KEEP = 5;
let reports: ExplorationReport[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** PUSH_EXPLORATION_REPORT 到达：同一事件只存一份，新的在前 */
export function pushExplorationReport(report: ExplorationReport): void {
  reports = [report, ...reports.filter((item) => item.eventId !== report.eventId)].slice(0, KEEP);
  emit();
}

/** 关闭一条简报 */
export function dismissExplorationReport(eventId: number): void {
  reports = reports.filter((item) => item.eventId !== eventId);
  emit();
}

/** 退出登录时清空，避免串到下一个账号 */
export function clearExplorationReports(): void {
  reports = [];
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useExplorationReports(): ExplorationReport[] {
  return useSyncExternalStore(subscribe, () => reports, () => reports);
}
