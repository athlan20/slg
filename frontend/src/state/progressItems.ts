// 「进行中的事」统一模型：建造 / 征兵 / 科技研究 / 行军四条泳道的条目（文案、剩余时间、进度）。
// 底栏一行时间线与总览的「进行中」泳道共用，避免两处各算一遍。纯函数，now 由调用方（useNow）传入。

import type { CityView, InitiatorRole, MarchView, ResearchView } from '../api/protocol';
import { marchLabel } from '../components/worldPanelText';
import { BUILDING_LABEL, TROOP_LABEL } from '../copy';
import { TECH_COPY } from '../copy-tech';

export type Lane = 'build' | 'recruit' | 'tech' | 'march';

export interface ProgressItem {
  id: string;
  lane: Lane;
  text: string;
  /** 剩余秒数；排队中（还没开工）为 null */
  leftSec: number | null;
  /** 0..100 */
  pct: number;
  /** 发起者（建造 / 征兵 / 研究有；行军也有） */
  by: InitiatorRole | null;
  /** 埋伏中（截击提前到达）：金色强调 */
  ambush?: boolean;
}

function span(startedAt: string, dueAt: string | null, now: number): { leftSec: number | null; pct: number } {
  if (dueAt === null) {
    return { leftSec: null, pct: 0 };
  }
  const start = Date.parse(startedAt);
  const due = Date.parse(dueAt);
  const total = Math.max(1, due - start);
  return {
    leftSec: Math.max(0, Math.ceil((due - now) / 1000)),
    pct: Math.min(100, Math.max(0, Math.round(((now - start) / total) * 100))),
  };
}

/** 在外行军（含返程；已到达 / 已返回的不算） */
export function activeMarches(city: CityView): MarchView[] {
  return city.marches.filter((march) => march.status === 'marching');
}

export function buildProgressItems(city: CityView | null, research: ResearchView | null, now: number): ProgressItem[] {
  if (!city) {
    return [];
  }
  const items: ProgressItem[] = [];
  for (const entry of city.queue) {
    items.push({
      id: `build-${entry.id}`,
      lane: 'build',
      text: `${BUILDING_LABEL[entry.kind].name} →${entry.toLevel ?? entry.level}`,
      by: entry.initiator,
      ...span(entry.startedAt, entry.status === 'building' ? entry.dueAt : null, now),
    });
  }
  for (const entry of city.recruitQueue) {
    items.push({
      id: `recruit-${entry.id}`,
      lane: 'recruit',
      text: `${TROOP_LABEL[entry.troop].name} ×${entry.count}`,
      by: entry.initiator,
      ...span(entry.startedAt, entry.status === 'recruiting' ? entry.dueAt : null, now),
    });
  }
  if (research && research.status === 'researching') {
    items.push({
      id: `tech-${research.id}`,
      lane: 'tech',
      text: `${TECH_COPY.names[research.tech]} →${research.level}`,
      by: research.initiator,
      ...span(research.startedAt, research.dueAt, now),
    });
  }
  for (const march of activeMarches(city)) {
    items.push({
      id: `march-${march.id}`,
      lane: 'march',
      text: marchLabel(march, now),
      by: march.initiator,
      ambush: march.ambushAt !== null && now >= Date.parse(march.ambushAt),
      ...span(march.startedAt, march.arriveAt, now),
    });
  }
  return items;
}
