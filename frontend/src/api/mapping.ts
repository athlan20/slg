// 协议数据到界面文案的拼装规则：事件文字、产量摘要与建筑效果行。
// 字面文案集中在 src/copy.ts（建筑/资源名称、说明、错误提示）；本文件只做
// "从数据拼出文案"的规则，不做状态流转；数值类描述避免写死（以后端响应为准）。
// 时间/时长格式化在 api/format.ts、错误码 → 人读提示在 api/errorText.ts——
// 本文件原名再导出，既有 import 路径不变。

import type { BuildingKind, CityView, EventView, ProductionRates, Resources } from './protocol';
import { TROOP_INFO, TROOP_KINDS, WAREHOUSE_PROTECTION_TOTAL_PER_LEVEL, warehouseProtectionPerResource } from './protocol';
import { BUILDING_LABEL, RESOURCE_LABEL, TERRAIN_LABEL, TROOP_LABEL, buildActionText, COPY } from '../copy';
import type { Actor, SessionEvent } from '../types';
import { formatClock } from './format';
import { CITY_COPY } from '../copy-cities';
import { TECH_COPY } from '../copy-tech';
import { MOVING_COPY } from '../copy-moving';
import { YT_COPY } from '../copy-yt';
import { STARVE_COPY } from '../copy-starvation';
import { DEFENSE_COPY } from '../copy-defense';
import { HERO_COPY } from '../copy-hero';
import { heroEventText, heroExpSuffix } from './heroEventText';

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

/** 消耗条目的展示数据：只列非零项，并对照当前资源标记不足（弹窗「消耗」行用） */
export function costParts(
  cost: Resources,
  resources: Resources | undefined,
): Array<{ label: string; value: number; insufficient: boolean }> {
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

function buildingName(kind: unknown): string {
  return typeof kind === 'string' && kind in BUILDING_LABEL
    ? BUILDING_LABEL[kind as keyof typeof BUILDING_LABEL].name
    : '未知建筑';
}

/** 兵种的展示名（事件流用；未知兵种给占位文案） */
function troopName(troop: unknown): string {
  return typeof troop === 'string' && troop in TROOP_LABEL
    ? TROOP_LABEL[troop as keyof typeof TROOP_LABEL].name
    : '未知兵种';
}

/** 资源组的展示后缀（建造成本 / 取消返还共用）：只列非零项，如「（金 100 / 木 50）」 */
function resourcesSuffix(resources: Partial<Resources> | undefined): string {
  if (!resources) {
    return '';
  }
  const parts: string[] = [];
  for (const key of Object.keys(RESOURCE_LABEL) as Array<keyof Resources>) {
    if (typeof resources[key] === 'number' && resources[key] > 0) {
      parts.push(`${RESOURCE_LABEL[key]} ${resources[key]}`);
    }
  }
  return parts.length > 0 ? `（${parts.join(' / ')}）` : '';
}

/** 科技中文名（v27 研究事件）；未知值原样显示 */
function techLabel(tech: unknown): string {
  return (TECH_COPY.names as Record<string, string>)[String(tech)] ?? String(tech ?? '?');
}

/** 货物清单（运输 v26）：只列非零项，如「金 100 / 粮 200」；全空返回空串 */
export function cargoText(resources: Partial<Resources> | null | undefined): string {
  return resourcesSuffix(resources ?? undefined).replace(/^（|）$/g, '');
}

function costSuffix(detail: Record<string, unknown>): string {
  return resourcesSuffix(detail.cost as Partial<Resources> | undefined);
}

/** 取消事件的返还后缀：detail.refund 为按成本快照全额返还的资源（v7） */
function refundSuffix(detail: Record<string, unknown>): string {
  const suffix = resourcesSuffix(detail.refund as Partial<Resources> | undefined);
  return suffix === '' ? '' : `，返还${suffix}`;
}

/** 事件/队列条目的动作词：目标等级为 1 是建造，> 1 是升级 */
function actionOf(level: unknown): string {
  return buildActionText(typeof level === 'number' ? level : 1);
}

/** 征兵事件的批量数量（detail.count；缺失按 0 占位） */
function countOf(detail: Record<string, unknown>): number {
  return typeof detail.count === 'number' ? detail.count : 0;
}

/** 世界事件的坐标（detail.x / detail.y；缺失给占位） */
function posOf(detail: Record<string, unknown>): string {
  const x = typeof detail.x === 'number' ? detail.x : '?';
  const y = typeof detail.y === 'number' ? detail.y : '?';
  return `(${x},${y})`;
}

/** 兵种清单后缀：只列非零项，如「义兵×5、弓箭兵×2」 */
function troopsSuffix(troops: Record<string, unknown> | undefined): string {
  if (!troops) {
    return '';
  }
  const parts: string[] = [];
  for (const kind of TROOP_KINDS) {
    const count = troops[kind];
    if (typeof count === 'number' && count > 0) {
      parts.push(`${TROOP_LABEL[kind].name}×${count}`);
    }
  }
  return parts.length > 0 ? parts.join('、') : '';
}

/** 地形名（世界事件 detail.terrain；未知给占位） */
function terrainName(terrain: unknown): string {
  return typeof terrain === 'string' && terrain in TERRAIN_LABEL
    ? TERRAIN_LABEL[terrain as keyof typeof TERRAIN_LABEL]
    : '野地';
}

/** 资源键的展示名（世界事件 detail.resource） */
function terrainResourceLabel(resource: unknown): string {
  return typeof resource === 'string' && resource in RESOURCE_LABEL
    ? RESOURCE_LABEL[resource as keyof Resources]
    : '';
}

/** 侦察完成事件的一句话摘要（v23 AISLG-62）：「侦察 (30,6) 完成：守军 义兵×120、弓箭兵×30，城墙减伤 15%」；
 *  完整报告（战力对比 / 库存 / 占领者 / 侦察时间）在弹窗里展开 */
function scoutCompletedText(detail: Record<string, unknown>): string {
  const pos = posOf(detail);
  const intel = detail.intel as Record<string, unknown> | undefined;
  if (!intel) {
    return `侦察 ${pos} 完成`;
  }
  const range = intel.garrisonTotal as { min?: number; max?: number } | undefined;
  if (intel.detail === 'rough' && range && typeof range.min === 'number' && typeof range.max === 'number') {
    // 侦察科技不足（v27 AISLG-77）：只有总兵力约数，没有兵种明细
    return `侦察 ${pos} 完成：${TECH_COPY.scout.summaryRough(range.min, range.max)}`;
  }
  const garrison = troopsSuffix(intel.garrison as Record<string, unknown> | undefined);
  const wall = typeof intel.wallDefensePercent === 'number' && intel.wallDefensePercent > 0
    ? `，城墙减伤 ${intel.wallDefensePercent}%`
    : '';
  return `侦察 ${pos} 完成：守军 ${garrison || '无'}${wall}`;
}

export function eventText(view: EventView): string {
  return heroEventText(view) ?? baseEventText(view) + heroExpSuffix(view);
}

function baseEventText(view: EventView): string {
  switch (view.type) {
    case 'build_started':
      return view.detail.fromQueue === true
        ? `${buildingName(view.detail.kind)}从队列开工（${actionOf(view.detail.level)}）`
        : `发起${buildingName(view.detail.kind)}${actionOf(view.detail.level)}${costSuffix(view.detail)}`;
    case 'build_queued':
      return `${buildingName(view.detail.kind)}${actionOf(view.detail.level)}加入队列${costSuffix(view.detail)}`;
    case 'build_completed':
      return `${buildingName(view.detail.kind)}${actionOf(view.detail.level)}完成`;
    case 'build_cancelled':
      return `取消${buildingName(view.detail.kind)}${actionOf(view.detail.level)}${refundSuffix(view.detail)}`;
    case 'recruit_started':
      return view.detail.fromQueue === true
        ? `${troopName(view.detail.troop)} ×${countOf(view.detail)}从队列开始征募`
        : `开始征募${troopName(view.detail.troop)} ×${countOf(view.detail)}${costSuffix(view.detail)}`;
    case 'recruit_queued':
      return `${troopName(view.detail.troop)} ×${countOf(view.detail)}加入征兵队列${costSuffix(view.detail)}`;
    case 'recruit_completed':
      return `${troopName(view.detail.troop)} ×${countOf(view.detail)}征募完成，已入城驻军`;
    case 'recruit_cancelled':
      return `取消征募${troopName(view.detail.troop)} ×${countOf(view.detail)}${refundSuffix(view.detail)}`;
    case 'yt_reward':
      return YT_COPY.event.reward(
        String(view.detail.tier ?? ''), Number(view.detail.rank ?? 0), Number(view.detail.killed ?? 0),
        resourcesSuffix(view.detail.reward as Partial<Resources> | undefined).replace(/^（|）$/g, ''),
      );
    case 'starvation_warning':
      return STARVE_COPY.event.warning(String(view.detail.cityName ?? '城池'), formatClock(String(view.detail.starveAt ?? '')));
    case 'mutiny':
      return STARVE_COPY.event.mutiny(
        String(view.detail.cityName ?? '城池'), Number(view.detail.total ?? 0), troopsSuffix(view.detail.losses as Record<string, unknown> | undefined) || '—',
      );
    case 'bandit_plundered':
      return MOVING_COPY.event.banditPlundered(
        posOf(view.detail), (RESOURCE_LABEL as Record<string, string>)[String(view.detail.resource)] ?? '资源', Number(view.detail.amount ?? 0),
      );
    case 'research_started':
      return TECH_COPY.event.started(techLabel(view.detail.tech), Number(view.detail.level ?? 0));
    case 'research_completed':
      return TECH_COPY.event.completed(techLabel(view.detail.tech), Number(view.detail.level ?? 0));
    case 'research_cancelled':
      return TECH_COPY.event.cancelled(
        techLabel(view.detail.tech),
        Number(view.detail.level ?? 0),
        cargoText(view.detail.refund as Partial<Resources> | undefined),
      );
    case 'city_renamed':
      return `城池改名：${String(view.detail.from ?? '')} → ${String(view.detail.to ?? '')}`;
    case 'account_reset':
      return '账号数据已重置，回到开号初始状态';
    case 'march_started': {
      const troops = troopsSuffix(view.detail.troops as Record<string, unknown> | undefined);
      const task = view.detail.task === 'plunder' ? '（掠夺）' : view.detail.task === 'occupy' ? '（占领）' : '';
      if (view.detail.purpose === 'transport') {
        return CITY_COPY.transport.startedLog(
          Number(view.detail.x), Number(view.detail.y), cargoText(view.detail.cargo as Partial<Resources>),
          formatClock(String(view.detail.arriveAt ?? '')),
        );
      }
      return view.detail.purpose === 'return'
        ? `驻军自 ${posOf(view.detail)} 启程返城，预计 ${formatClock(String(view.detail.arriveAt ?? ''))} 到达`
        : `部队出征${task} → ${posOf(view.detail)}（${troops}），预计 ${formatClock(String(view.detail.arriveAt ?? ''))} 到达`;
    }
    case 'march_completed': {
      const pos = posOf(view.detail);
      const survivors = troopsSuffix(view.detail.survivors as Record<string, unknown> | undefined);
      const troops = troopsSuffix(view.detail.troops as Record<string, unknown> | undefined);
      switch (view.detail.outcome) {
        case 'battle_won': {
          const loot = resourcesSuffix(view.detail.loot as Partial<Resources> | undefined);
          if (view.detail.outerCleared === true) {
            // 名城外围阶段获胜（v24 AISLG-56）：外围清空，限时内可攻城守
            return `清剿名城${String(view.detail.famousName ?? '')} ${pos} 外围获胜，外围已清空，限时内可攻城守${survivors ? `（幸存 ${survivors} 返程）` : ''}`;
          }
          if (view.detail.occupied === true) {
            // v39（AISLG-123）：抢占他人野地（detail.target.username 带守方名）
            const pvpTarget = (view.detail.target as { username?: string } | undefined)?.username;
            if (pvpTarget) {
              return `抢占 ${pos}（${pvpTarget} 的野地）获胜，地块已归你${survivors ? `，幸存 ${survivors} 驻守` : ''}`;
            }
            return `进攻 ${pos} 获胜，已占领为分城${survivors ? `，幸存 ${survivors} 进城驻守` : ''}`;
          }
          if (view.detail.occupied === false) {
            const reason = typeof view.detail.denial === 'string' ? DENIAL_TEXT[view.detail.denial] : undefined;
            return `进攻 ${pos} 获胜但未占领（${reason ?? '已达官府占领上限'}），幸存部队返程${survivors ? `（${survivors}）` : ''}`;
          }
          return `进攻 ${pos} 获胜：掠得${loot || '（无战利品）'}${survivors ? `，幸存 ${survivors}` : ''}`;
        }
        case 'plunder_won': {
          const loot = resourcesSuffix(view.detail.loot as Partial<Resources> | undefined);
          // v38（AISLG-122）：掠夺玩家城的目标名（detail.target.username）
          const pvpTarget = (view.detail.target as { username?: string } | undefined)?.username;
          const where = pvpTarget ? `${pos}（${pvpTarget} 的城）` : pos;
          return `掠夺 ${where} 得手：掠得${loot || '（负重不足或无可抢）'}${survivors ? `，幸存 ${survivors} 返程` : ''}`;
        }
        case 'battle_lost':
          return `进攻 ${pos} 失败${survivors ? `，残部撤回（${survivors}）` : '，出击部队全灭'}`;
        case 'reinforced':
          return `增援 ${pos} 并入驻军（${troops}）`;
        case 'returned':
          return `部队返程回城并入驻军（${troops}）`;
        case 'aborted': {
          const carried = cargoText(view.detail.cargo as Partial<Resources> | undefined);
          // v38 / v39：保护 / 免战 / 局面变化的具体原因（cause）
          const causeText: Record<string, string> = {
            target_gone: '（目标已失效）',
            owner_changed: '（目标已易主）',
            TILE_PROTECTED: '（地块换主保护中）',
            NEWBIE_PROTECTED: '（对方新手保护中）',
            TARGET_IN_TRUCE: '（对方免战中）',
          };
          const cause = typeof view.detail.cause === 'string' ? causeText[view.detail.cause] ?? '' : '';
          return `目标 ${pos} 已不可攻击${cause}，部队原路返回${carried ? CITY_COPY.transport.eventAbortedCargo(carried) : ''}`;
        }
        case 'camp_won':
          return YT_COPY.event.campWon(
            YT_COPY.tierLabel[String(view.detail.campTier)] ?? '黄巾营地', pos, Number(view.detail.killed ?? 0),
            resourcesSuffix(view.detail.loot as Partial<Resources> | undefined).replace(/^（|）$/g, ''),
          );
        case 'camp_lost':
          return YT_COPY.event.campLost(YT_COPY.tierLabel[String(view.detail.campTier)] ?? '黄巾营地', pos, Number(view.detail.killed ?? 0));
        case 'boss_outer_cleared':
          return YT_COPY.event.bossOuter(pos, Number(view.detail.killed ?? 0));
        case 'boss_won':
          return YT_COPY.event.bossWon(
            pos, Number(view.detail.killed ?? 0), resourcesSuffix(view.detail.loot as Partial<Resources> | undefined).replace(/^（|）$/g, ''),
          );
        case 'intercepted':
          return MOVING_COPY.event.intercepted(
            '移动目标', pos, resourcesSuffix(view.detail.loot as Partial<Resources> | undefined).replace(/^（|）$/g, ''), survivors,
          );
        case 'intercept_lost':
          return MOVING_COPY.event.lost('移动目标', pos, survivors);
        case 'intercept_missed':
          return MOVING_COPY.event.missed(pos);
        case 'intercept_gone':
          return MOVING_COPY.event.gone(pos);
        case 'transported':
          return CITY_COPY.transport.eventDelivered(
            pos, String(view.detail.cityName ?? '目标城'), cargoText(view.detail.cargo as Partial<Resources>), troops,
          );
        case 'transport_received':
          return CITY_COPY.transport.eventReceived(
            String(view.detail.fromCityName ?? '另一座城'), cargoText(view.detail.cargo as Partial<Resources>),
          );
        case 'scouted':
          return scoutCompletedText(view.detail);
        default:
          return `行军到达 ${pos}`;
      }
    }
    case 'wilderness_occupied': {
      const resource = terrainResourceLabel(view.detail.resource);
      const bonus = typeof view.detail.bonusRate === 'number' ? `，${resource} +${view.detail.bonusRate}/h` : '';
      const gather = typeof view.detail.gatherRate === 'number' && view.detail.gatherRate > 0 ? `（采集 +${view.detail.gatherRate}/h）` : '';
      return `占领野地 ${posOf(view.detail)}：${terrainName(view.detail.terrain)} Lv${String(view.detail.level ?? '?')}${bonus}${gather}`;
    }
    case 'wilderness_lost': {
      const posLost = posOf(view.detail);
      if (view.detail.cause === 'recall') {
        return `撤回驻军，放弃野地 ${posLost}`;
      }
      // v39（AISLG-123）：被其他玩家抢占（detail.attacker.username）
      if (view.detail.cause === 'conquest') {
        const by = (view.detail.attacker as { username?: string } | undefined)?.username;
        return `野地 ${posLost} 被${by ? `玩家 ${by} ` : ''}抢占，占领失效`;
      }
      return `野地 ${posLost} 失守，占领失效`;
    }
    case 'npc_city_occupied': {
      // v24：占领 NPC 城变分城时接收其剩余库存（stock）；旧版 legacy 路径为掠得（loot）
      const loot = resourcesSuffix((view.detail.stock ?? view.detail.loot) as Partial<Resources> | undefined);
      const name = typeof view.detail.name === 'string' ? `「${view.detail.name}」` : '';
      return `占领 NPC 城池 ${posOf(view.detail)} 为分城${name}${loot ? `，接收库存${loot}` : ''}`;
    }
    case 'npc_raid': {
      const losses = troopsSuffix(view.detail.losses as Record<string, unknown> | undefined);
      return view.detail.outcome === 'repelled'
        ? `NPC 袭击 ${posOf(view.detail)} 被击退${losses ? `，损失 ${losses}` : ''}`
        : `NPC 袭击 ${posOf(view.detail)}，驻军全灭、占领失效`;
    }
    case 'npc_attack_warning': {
      // v23 AISLG-57：预警 = 位置 + 预计到达时刻 + 大致兵力范围
      const where = posOf(view.detail);
      const target =
        view.detail.target === 'city'
          ? '你的主城'
          : `${terrainName(view.detail.terrain)} ${where}`;
      const arriveAt = typeof view.detail.arriveAt === 'string' ? formatClock(view.detail.arriveAt) : '?';
      const minutesLeft = Math.max(0, Math.ceil((Date.parse(String(view.detail.arriveAt ?? '')) - Date.now()) / 60_000));
      const mins = Number.isFinite(minutesLeft) ? `，约 ${minutesLeft} 分钟后` : '';
      const min = typeof view.detail.armyMin === 'number' ? view.detail.armyMin : '?';
      const max = typeof view.detail.armyMax === 'number' ? view.detail.armyMax : '?';
      return `斥候发现一支 NPC 部队正向 ${target} 进发，预计 ${arriveAt} 到达${mins}，兵力约 ${min}–${max}`;
    }
    case 'player_attack_warning': {
      // v38 AISLG-122 / v39 AISLG-123：玩家部队来袭预警 = 进攻方 + 目标（城 / 你的野地）+ 预计到达 + 兵力范围
      const attacker = view.detail.attacker as { username?: string; cityName?: string } | undefined;
      const who = attacker?.username ? `${attacker.username}（从 ${attacker.cityName ?? '?'} 出兵）` : '一支玩家部队';
      const arriveAt = typeof view.detail.arriveAt === 'string' ? formatClock(view.detail.arriveAt) : '?';
      const minutesLeft = Math.max(0, Math.ceil((Date.parse(String(view.detail.arriveAt ?? '')) - Date.now()) / 60_000));
      const mins = Number.isFinite(minutesLeft) ? `，约 ${minutesLeft} 分钟后` : '';
      const min = typeof view.detail.armyMin === 'number' ? view.detail.armyMin : '?';
      const max = typeof view.detail.armyMax === 'number' ? view.detail.armyMax : '?';
      const where =
        view.detail.target === 'wilderness'
          ? `你占领的野地 ${posOf(view.detail)}${terrainName(view.detail.terrain) ? ` ${terrainName(view.detail.terrain)}` : ''}${typeof view.detail.level === 'number' ? ` Lv${view.detail.level}` : ''}`
          : `你的城 ${posOf(view.detail)}`;
      return `烽火台示警：${who} 正向${where}进发，预计 ${arriveAt} 到达${mins}，兵力约 ${min}–${max}`;
    }
    case 'pvp_raid': {
      // v38 AISLG-122 玩家攻城结算（守方视角）；v40 AISLG-124 占领攻打带 conquest（降城防 / 换主）
      const attacker = view.detail.attacker as { username?: string } | undefined;
      const who = attacker?.username ?? '未知玩家';
      const loot = resourcesSuffix(view.detail.loot as Partial<Resources> | undefined);
      if (view.detail.outcome === 'repelled') {
        const losses = troopsSuffix(view.detail.losses as Record<string, unknown> | undefined);
        return `${who} 进攻你的城 ${posOf(view.detail)} 被击退${losses ? `，损失 ${losses}` : ''}`;
      }
      const conquest = view.detail.conquest as
        | { before?: number; after?: number; damage?: number; ramBonus?: number; protectedUntil?: string; transferred?: boolean }
        | undefined;
      if (conquest) {
        const left = `城防值 ${conquest.before ?? '?'} → ${conquest.after ?? '?'}`;
        if (conquest.transferred) {
          return `${who} 攻破了你的分城 ${posOf(view.detail)}——城防归零，城已易主（${left}）`;
        }
        const truceLeft = conquest.protectedUntil ? `，城免战至 ${formatClock(String(conquest.protectedUntil))}` : '';
        return `${who} 攻破了你的城防（${left}，一击 −${conquest.damage ?? '?'}${(conquest.ramBonus ?? 0) > 0 ? `，含冲车 +${conquest.ramBonus}` : ''}）${truceLeft}`;
      }
      const truceLeft = view.detail.truceUntil ? `，城进入免战期至 ${formatClock(String(view.detail.truceUntil))}` : '';
      return `${who} 攻破了你的城 ${posOf(view.detail)}，被掠${loot || '空手而归'}${truceLeft}`;
    }
    case 'city_conquered': {
      // v40 AISLG-124：分城易主（原主 lost / 新主 gained）
      const pos = posOf(view.detail);
      const cityName = String(view.detail.cityName ?? '分城');
      if (view.detail.outcome === 'lost') {
        const by = (view.detail.attacker as { username?: string } | undefined)?.username;
        return `你的分城「${cityName}」${pos} 被${by ? `玩家 ${by} ` : ''}占领，城防归零易主（野地已无主、在外部队回主城）`;
      }
      const from = (view.detail.from as { username?: string } | undefined)?.username;
      const until = view.detail.protectedUntil ? `，保护期至 ${formatClock(String(view.detail.protectedUntil))}` : '';
      return `占领了${from ? ` ${from} 的` : ''}分城「${cityName}」${pos}：建筑与资源已接收、城防回满${until}`;
    }
    case 'truce_started': {
      const until = typeof view.detail.until === 'string' ? formatClock(view.detail.until) : '?';
      return `主动免战开启，至 ${until}（期间别人打不了你，你也不能出兵打玩家）`;
    }
    case 'newbie_protection_ended': {
      const cause = view.detail.cause === 'government' ? '官府升级' : '主动进攻其他玩家';
      return `新手保护结束（${cause}）：此后可被其他玩家侦察 / 攻击`;
    }
    case 'resource_exchanged': {
      // v22（AISLG-42）：集市兑换成交（detail.resource / amount / gold / rate）
      const label = terrainResourceLabel(view.detail.resource);
      const amount = typeof view.detail.amount === 'number' ? view.detail.amount : 0;
      const gold = typeof view.detail.gold === 'number' ? view.detail.gold : 0;
      return `集市兑换：${label} ${amount} → 金币 ${gold}`;
    }
    case 'agent_connected':
      return 'Agent 连接上线';
    case 'agent_disconnected':
      return 'Agent 连接离线';
    default:
      return view.type;
  }
}

/** 全服播报（v23 AISLG-60）：按类型拼一句话；detail 字段缺失给占位 */
export function serverBroadcastText(view: {
  type: string;
  detail: Record<string, unknown>;
}): string {
  const actor =
    typeof view.detail.username === 'string'
      ? view.detail.cityName
        ? `${view.detail.username} · ${view.detail.cityName}`
        : (view.detail.username as string)
      : '某位玩家';
  const pos = posOf(view.detail);
  switch (view.type) {
    case 'npc_city_emptied':
      return `${actor} 掠空了 NPC 城池 Lv${String(view.detail.level ?? '?')} ${pos}`;
    case 'gold_mine_first':
      return `${actor} 首个占领了金矿 ${pos}`;
    case 'city_broken':
      return `${actor} 的主城被 NPC 攻破`;
    case 'win_streak':
      return `${actor} 的军队一小时内连胜 ${String(view.detail.streak ?? '5')} 场`;
    case 'yt_started':
      return YT_COPY.broadcast.started(Number(view.detail.totalCamps ?? 0));
    case 'yt_grown':
      return YT_COPY.broadcast.grown(Number(view.detail.count ?? 0), String(view.detail.label ?? YT_COPY.tierLabel[String(view.detail.tier)] ?? ''));
    case 'yt_boss':
      return YT_COPY.broadcast.boss(Number(view.detail.x ?? 0), Number(view.detail.y ?? 0));
    case 'yt_boss_first_kill':
      return YT_COPY.broadcast.firstKill(actor);
    case 'hero_granted':
      return HERO_COPY.broadcast.granted(String(view.detail.username ?? '某位玩家'), String(view.detail.heroName ?? ''), String(view.detail.source ?? ''));
    case 'city_conquered':
      return `${actor} 攻占了${view.detail.from ? ` ${String(view.detail.from)} 的` : '他人的'}分城「${String(view.detail.cityName ?? '?')}」${pos}`;
    case 'yt_finished':
      return YT_COPY.broadcast.finished(
        String(view.detail.reason ?? ''), Number(view.detail.clearedCamps ?? 0), Number(view.detail.totalCamps ?? 0), Number(view.detail.scatteredCamps ?? 0),
      );
    default:
      return `全服大事：${view.type}`;
  }
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

/** 占领未成功的原因（battle_won 事件 detail.denial） */
const DENIAL_TEXT: Record<string, string> = {
  TERRITORY_LIMIT: '已达官府占领上限',
  GOVERNMENT_TOO_LOW: '主城官府不足 3 级',
  BRANCH_LIMIT: '分城数量已达上限',
  TARGET_LEVEL_TOO_HIGH: '目标城等级高于出发城官府等级',
};
