// 协议数据到界面文案的拼装规则（入口文件）：消耗条目、产量摘要与建筑效果行，
// 以及事件文字 / 全服播报的原名再导出。事件与播报的拼装规则在 api/mapping-world.ts、
// 错误码 → 人读提示在 api/errorText.ts、时间/时长格式化在 api/format.ts——
// 本文件原名再导出，既有 import 路径不变。
// 字面文案集中在 src/copy*.ts；文案按界面语言取用（AISLG-137）：每个拼装函数体内
// 经 getCopy() 取当前语言包并沿用原名解构——严禁在模块顶层取用（语言切换后会过期）。

import type { BuildingKind, CityView, EventView, ProductionRates, Resources } from './protocol';
import { TROOP_INFO, TROOP_KINDS, WAREHOUSE_PROTECTION_TOTAL_PER_LEVEL, warehouseProtectionPerResource } from './protocol';
import type { Actor, SessionEvent } from '../types';
import { getCopy } from '../i18n/bundle';
import { formatClock } from './format';
import { eventText } from './mapping-world';

export { formatClock, formatReportTime, formatDurationText } from './format';
export {
  loginErrorText,
  wechatErrorText,
  buildErrorText,
  recruitErrorText,
  renameErrorText,
  exchangeErrorText,
  marchErrorText,
  shortfallSuffix,
  populationShortfallSuffix,
} from './errorText';
export { eventText, serverBroadcastText, cargoText } from './mapping-world';

/** 消耗条目的展示数据：只列非零项，并对照当前资源标记不足（弹窗「消耗」行用） */
export function costParts(
  cost: Resources,
  resources: Resources | undefined,
): Array<{ label: string; value: number; insufficient: boolean }> {
  const { RESOURCE_LABEL } = getCopy();
  return (Object.keys(RESOURCE_LABEL) as Array<keyof Resources>)
    .filter((key) => cost[key] > 0)
    .map((key) => ({
      label: RESOURCE_LABEL[key],
      value: cost[key],
      insufficient: resources !== undefined && resources[key] < cost[key],
    }));
}

/** 产量摘要（顶栏用）：只列非零项（v7 起含官府产金）；粮显示净产量（毛产量 − 全军耗粮，
 *  v14，耗粮 > 0 时附耗粮明细）；无建筑或未获取时给占位文案 */
export function productionSummary(production: ProductionRates | undefined, foodUpkeep = 0): string {
  const { COPY, RESOURCE_LABEL } = getCopy();
  const fallback = COPY.topbar.productionEmpty;
  if (!production) {
    return fallback;
  }
  const parts: string[] = [];
  for (const key of Object.keys(RESOURCE_LABEL) as Array<keyof Resources>) {
    if (key === 'food') {
      // 粮有 100/h 基础产量，恒为非零项；净产量可能为负（入不敷出，粮食将持续下降）
      const net = production.food - foodUpkeep;
      parts.push(
        foodUpkeep > 0
          ? COPY.topbar.foodNet(RESOURCE_LABEL.food, net, foodUpkeep)
          : `${RESOURCE_LABEL.food} +${production.food}/h`,
      );
      continue;
    }
    if (production[key] > 0) {
      parts.push(`${RESOURCE_LABEL[key]} +${production[key]}/h`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : fallback;
}

/** 建筑详情弹窗的「效果」行：生产建筑显示小时产量；民房显示人口；军营显示可征兵种数、
 *  城墙显示守城加成（v11）、仓库显示防掠夺保护量（v16） */
export function buildingEffectText(kind: BuildingKind, city: CityView | null): string {
  const { COPY, BUILDING_LABEL, RESOURCE_LABEL, DEFENSE_COPY, HERO_COPY } = getCopy();
  const resource = BUILDING_LABEL[kind].resource;
  if (resource !== null) {
    return COPY.buildingModal.productionLine(RESOURCE_LABEL[resource], city?.production[resource] ?? 0);
  }
  if (kind === 'house' && city) {
    const pop = city.population;
    return COPY.buildingModal.populationLine(pop.current, pop.cap, pop.growthPerHour);
  }
  if (kind === 'wall') {
    return COPY.buildingModal.defenseLine(city?.defenseBonus ?? 0);
  }
  if (kind === 'barracks' && city) {
    const unlocked = TROOP_KINDS.filter(
      (troop) => TROOP_INFO[troop].barracksLevel <= city.levels.barracks,
    ).length;
    return COPY.buildingModal.barracksLine(unlocked, TROOP_KINDS.length);
  }
  if (kind === 'parade_ground') {
    return DEFENSE_COPY.building.parade(city?.deploy.count ?? 0, city?.deploy.limit ?? 1);
  }
  if (kind === 'beacon') {
    return DEFENSE_COPY.building.beacon(city?.levels.beacon ?? 0);
  }
  if (kind === 'post_station') {
    return DEFENSE_COPY.building.station(city?.levels.post_station ?? 0);
  }
  if (kind === 'tavern') {
    const level = city?.levels.tavern ?? 0;
    return HERO_COPY.building.effect(level, Math.ceil(level / 2) + 1);
  }
  if (kind === 'arrow_tower') {
    return DEFENSE_COPY.building.tower(city?.tower?.damage ?? 0, city?.tower?.range ?? 0);
  }
  if (kind === 'warehouse') {
    const level = city?.levels.warehouse ?? 0;
    return COPY.buildingModal.warehouseLine(
      WAREHOUSE_PROTECTION_TOTAL_PER_LEVEL * level,
      warehouseProtectionPerResource(level),
    );
  }
  return COPY.buildingModal.pendingFeature;
}

export function toSessionEvent(view: EventView): SessionEvent {
  const actor: Actor = view.initiator ?? 'system';
  // 战斗结局类事件（march_completed 胜负 / npc_raid / npc_city_occupied）携带 detail.reportId，
  // 是打开战报弹窗的入口 id（按 id 反查战报的游标语义见 docs/battle-report-api.md 第 6 节）；
  // 侦察完成事件（outcome='scouted'）携带 detail.intel，是打开侦察报告弹窗的入口（AISLG-62）
  const reportId = typeof view.detail.reportId === 'number' ? view.detail.reportId : undefined;
  const scoutIntel =
    view.type === 'march_completed' && view.detail.outcome === 'scouted'
      ? (view.detail.intel as SessionEvent['scoutIntel'] | undefined)
      : undefined;
  return { id: view.id, at: formatClock(view.createdAt), actor, text: eventText(view), reportId, scoutIntel };
}
