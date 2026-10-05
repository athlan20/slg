// 事件流文字与全服播报的拼装（从 api/mapping.ts 拆出以控制单文件行数）：
// baseEventText / scoutCompletedText / serverBroadcastText 与其辅助函数都在这里。
// 字面文案集中在 src/copy*.ts 与 src/copy-extra-state.ts；本文件只做"从数据拼出文案"的规则。
// 文案按界面语言取用（AISLG-137）：每个拼装函数体内经 getCopy() 取当前语言包并沿用原名
// 解构——严禁在模块顶层取用（语言切换后会过期）。既有 import 路径不变：mapping.ts 原名再导出。

import type { EventView, Resources } from './protocol';
import { TROOP_KINDS } from './protocol';
import { getCopy } from '../i18n/bundle';
import { tName, tHeroSource } from '../i18n/names';
import { formatClock } from './format';
import { heroEventText, heroExpSuffix } from './heroEventText';

function buildingName(kind: unknown): string {
  const { BUILDING_LABEL, EXTRA_STATE } = getCopy();
  return typeof kind === 'string' && kind in BUILDING_LABEL
    ? BUILDING_LABEL[kind as keyof typeof BUILDING_LABEL].name
    : EXTRA_STATE.mapping.unknownBuilding;
}

/** 兵种的展示名（事件流用；未知兵种给占位文案） */
function troopName(troop: unknown): string {
  const { TROOP_LABEL, EXTRA_STATE } = getCopy();
  return typeof troop === 'string' && troop in TROOP_LABEL
    ? TROOP_LABEL[troop as keyof typeof TROOP_LABEL].name
    : EXTRA_STATE.mapping.unknownTroop;
}

/** 资源清单的展示项（resourcesSuffix / cargoText 共用）：只列非零项，如「金 100 / 木 50」 */
function resourceParts(resources: Partial<Resources> | undefined): string[] {
  const { RESOURCE_LABEL } = getCopy();
  if (!resources) {
    return [];
  }
  const parts: string[] = [];
  for (const key of Object.keys(RESOURCE_LABEL) as Array<keyof Resources>) {
    if (typeof resources[key] === 'number' && resources[key] > 0) {
      parts.push(`${RESOURCE_LABEL[key]} ${resources[key]}`);
    }
  }
  return parts;
}

/** 资源组的展示后缀（建造成本 / 取消返还共用）：括号按语言取（zh 全角、en 半角） */
function resourcesSuffix(resources: Partial<Resources> | undefined): string {
  const parts = resourceParts(resources);
  return parts.length > 0 ? getCopy().EXTRA_STATE.mapping.paren(parts.join(' / ')) : '';
}

/** 科技中文名（v27 研究事件）；未知值原样显示 */
function techLabel(tech: unknown): string {
  const { TECH_COPY } = getCopy();
  return (TECH_COPY.names as Record<string, string>)[String(tech)] ?? String(tech ?? '?');
}

/** 货物清单（运输 v26）：只列非零项，如「金 100 / 粮 200」；全空返回空串 */
export function cargoText(resources: Partial<Resources> | null | undefined): string {
  return resourceParts(resources ?? undefined).join(' / ');
}

function costSuffix(detail: Record<string, unknown>): string {
  return resourcesSuffix(detail.cost as Partial<Resources> | undefined);
}

/** 取消事件的返还后缀：detail.refund 为按成本快照全额返还的资源（v7） */
function refundSuffix(detail: Record<string, unknown>): string {
  const suffix = resourcesSuffix(detail.refund as Partial<Resources> | undefined);
  return suffix === '' ? '' : getCopy().EXTRA_STATE.mapping.refundSuffix(suffix);
}

/** 事件/队列条目的动作词：目标等级为 1 是建造，> 1 是升级 */
function actionOf(level: unknown): string {
  return getCopy().buildActionText(typeof level === 'number' ? level : 1);
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
  const { TROOP_LABEL, EXTRA_STATE } = getCopy();
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
  return parts.length > 0 ? parts.join(EXTRA_STATE.mapping.listSep) : '';
}

/** 地形名（世界事件 detail.terrain；未知给占位） */
function terrainName(terrain: unknown): string {
  const { TERRAIN_LABEL, EXTRA_STATE } = getCopy();
  return typeof terrain === 'string' && terrain in TERRAIN_LABEL
    ? TERRAIN_LABEL[terrain as keyof typeof TERRAIN_LABEL]
    : EXTRA_STATE.mapping.wildTerrain;
}

/** 资源键的展示名（世界事件 detail.resource） */
function terrainResourceLabel(resource: unknown): string {
  const { RESOURCE_LABEL } = getCopy();
  return typeof resource === 'string' && resource in RESOURCE_LABEL
    ? RESOURCE_LABEL[resource as keyof Resources]
    : '';
}

/** 侦察完成事件的一句话摘要（v23 AISLG-62）：「侦察 (30,6) 完成：守军 义兵×120、弓箭兵×30，城墙减伤 15%」；
 *  完整报告（战力对比 / 库存 / 占领者 / 侦察时间）在弹窗里展开 */
function scoutCompletedText(detail: Record<string, unknown>): string {
  const { TECH_COPY, EXTRA_STATE } = getCopy();
  const pos = posOf(detail);
  const intel = detail.intel as Record<string, unknown> | undefined;
  if (!intel) {
    return EXTRA_STATE.scout.done(pos);
  }
  const range = intel.garrisonTotal as { min?: number; max?: number } | undefined;
  if (intel.detail === 'rough' && range && typeof range.min === 'number' && typeof range.max === 'number') {
    // 侦察科技不足（v27 AISLG-77）：只有总兵力约数，没有兵种明细
    return EXTRA_STATE.scout.doneRough(pos, TECH_COPY.scout.summaryRough(range.min, range.max));
  }
  const garrison = troopsSuffix(intel.garrison as Record<string, unknown> | undefined);
  const wall = typeof intel.wallDefensePercent === 'number' && intel.wallDefensePercent > 0
    ? EXTRA_STATE.scout.wallDefense(intel.wallDefensePercent)
    : '';
  return EXTRA_STATE.scout.doneGarrison(pos, garrison || EXTRA_STATE.scout.garrisonNone, wall);
}

export function eventText(view: EventView): string {
  return heroEventText(view) ?? baseEventText(view) + heroExpSuffix(view);
}

function baseEventText(view: EventView): string {
  const { COPY, CITY_COPY, MOVING_COPY, YT_COPY, STARVE_COPY, TECH_COPY, RESOURCE_LABEL, EXTRA_STATE } = getCopy();
  switch (view.type) {
    case 'build_started':
      return view.detail.fromQueue === true
        ? EXTRA_STATE.build.fromQueue(buildingName(view.detail.kind), actionOf(view.detail.level))
        : EXTRA_STATE.build.start(buildingName(view.detail.kind), actionOf(view.detail.level), costSuffix(view.detail));
    case 'build_queued':
      return EXTRA_STATE.build.queued(buildingName(view.detail.kind), actionOf(view.detail.level), costSuffix(view.detail));
    case 'build_completed':
      return EXTRA_STATE.build.completed(buildingName(view.detail.kind), actionOf(view.detail.level));
    case 'build_cancelled':
      return EXTRA_STATE.build.cancelled(buildingName(view.detail.kind), actionOf(view.detail.level), refundSuffix(view.detail));
    case 'recruit_started':
      return view.detail.fromQueue === true
        ? EXTRA_STATE.recruit.fromQueue(troopName(view.detail.troop), countOf(view.detail))
        : EXTRA_STATE.recruit.start(troopName(view.detail.troop), countOf(view.detail), costSuffix(view.detail));
    case 'recruit_queued':
      return EXTRA_STATE.recruit.queued(troopName(view.detail.troop), countOf(view.detail), costSuffix(view.detail));
    case 'recruit_completed':
      return EXTRA_STATE.recruit.completed(troopName(view.detail.troop), countOf(view.detail));
    case 'recruit_cancelled':
      return EXTRA_STATE.recruit.cancelled(troopName(view.detail.troop), countOf(view.detail), refundSuffix(view.detail));
    case 'yt_reward':
      return YT_COPY.event.reward(
        String(view.detail.tier ?? ''), Number(view.detail.rank ?? 0), Number(view.detail.killed ?? 0),
        cargoText(view.detail.reward as Partial<Resources> | undefined),
      );
    case 'starvation_warning':
      return STARVE_COPY.event.warning(tName(String(view.detail.cityName ?? EXTRA_STATE.mapping.cityFallback)), formatClock(String(view.detail.starveAt ?? '')));
    case 'mutiny':
      return STARVE_COPY.event.mutiny(
        tName(String(view.detail.cityName ?? EXTRA_STATE.mapping.cityFallback)), Number(view.detail.total ?? 0), troopsSuffix(view.detail.losses as Record<string, unknown> | undefined) || '—',
      );
    case 'bandit_plundered':
      return MOVING_COPY.event.banditPlundered(
        posOf(view.detail), (RESOURCE_LABEL as Record<string, string>)[String(view.detail.resource)] ?? EXTRA_STATE.mapping.resourceFallback, Number(view.detail.amount ?? 0),
      );
    case 'research_started':
      return TECH_COPY.event.started(techLabel(view.detail.tech), Number(view.detail.level ?? 0));
    case 'research_completed':
      return TECH_COPY.event.completed(techLabel(view.detail.tech), Number(view.detail.level ?? 0));
    case 'research_cancelled':
      return TECH_COPY.event.cancelled(techLabel(view.detail.tech), Number(view.detail.level ?? 0), cargoText(view.detail.refund as Partial<Resources> | undefined));
    case 'city_renamed':
      return EXTRA_STATE.event.cityRenamed(String(view.detail.from ?? ''), String(view.detail.to ?? ''));
    case 'account_reset':
      return EXTRA_STATE.event.accountReset;
    case 'march_started': {
      const troops = troopsSuffix(view.detail.troops as Record<string, unknown> | undefined);
      const task = view.detail.task === 'plunder' ? EXTRA_STATE.event.marchTaskPlunder : view.detail.task === 'occupy' ? EXTRA_STATE.event.marchTaskOccupy : '';
      if (view.detail.purpose === 'transport') {
        return CITY_COPY.transport.startedLog(
          Number(view.detail.x), Number(view.detail.y), cargoText(view.detail.cargo as Partial<Resources>),
          formatClock(String(view.detail.arriveAt ?? '')),
        );
      }
      const clock = formatClock(String(view.detail.arriveAt ?? ''));
      return view.detail.purpose === 'return'
        ? EXTRA_STATE.event.marchReturn(posOf(view.detail), clock)
        : EXTRA_STATE.event.marchOut(task, posOf(view.detail), troops, clock);
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
            return EXTRA_STATE.event.outerCleared(String(view.detail.famousName ?? ''), pos, survivors);
          }
          if (view.detail.occupied === true) {
            // v39（AISLG-123）：抢占他人野地（detail.target.username 带守方名）
            const pvpTarget = (view.detail.target as { username?: string } | undefined)?.username;
            if (pvpTarget) {
              return EXTRA_STATE.event.pvpSeized(pos, pvpTarget, survivors);
            }
            return EXTRA_STATE.event.occupiedBranch(pos, survivors);
          }
          if (view.detail.occupied === false) {
            const reason = typeof view.detail.denial === 'string' ? EXTRA_STATE.denial[view.detail.denial] : undefined;
            return EXTRA_STATE.event.wonNotOccupied(pos, reason ?? EXTRA_STATE.denial.TERRITORY_LIMIT, survivors);
          }
          return EXTRA_STATE.event.wonLoot(pos, loot || EXTRA_STATE.mapping.noLoot, survivors);
        }
        case 'plunder_won': {
          const loot = resourcesSuffix(view.detail.loot as Partial<Resources> | undefined);
          // v38（AISLG-122）：掠夺玩家城的目标名（detail.target.username）
          const pvpTarget = (view.detail.target as { username?: string } | undefined)?.username;
          const where = pvpTarget ? EXTRA_STATE.event.pvpCityWhere(pos, pvpTarget) : pos;
          return EXTRA_STATE.event.plunderWon(where, loot || EXTRA_STATE.mapping.noPlunder, survivors);
        }
        case 'battle_lost':
          return EXTRA_STATE.event.battleLost(pos, survivors);
        case 'reinforced':
          return EXTRA_STATE.event.reinforced(pos, troops);
        case 'returned':
          return EXTRA_STATE.event.returnedGarrison(troops);
        case 'aborted': {
          const carried = cargoText(view.detail.cargo as Partial<Resources> | undefined);
          // v38 / v39：保护 / 免战 / 局面变化的具体原因（cause）
          const cause = typeof view.detail.cause === 'string' ? EXTRA_STATE.event.cause[view.detail.cause] ?? '' : '';
          return EXTRA_STATE.event.aborted(pos, cause, carried ? CITY_COPY.transport.eventAbortedCargo(carried) : '');
        }
        case 'camp_won':
          return YT_COPY.event.campWon(
            YT_COPY.tierLabel[String(view.detail.campTier)] ?? EXTRA_STATE.mapping.ytCampFallback, pos,
            Number(view.detail.killed ?? 0), cargoText(view.detail.loot as Partial<Resources> | undefined),
          );
        case 'camp_lost':
          return YT_COPY.event.campLost(YT_COPY.tierLabel[String(view.detail.campTier)] ?? EXTRA_STATE.mapping.ytCampFallback, pos, Number(view.detail.killed ?? 0));
        case 'boss_outer_cleared':
          return YT_COPY.event.bossOuter(pos, Number(view.detail.killed ?? 0));
        case 'boss_won':
          return YT_COPY.event.bossWon(pos, Number(view.detail.killed ?? 0), cargoText(view.detail.loot as Partial<Resources> | undefined));
        case 'intercepted':
          return MOVING_COPY.event.intercepted(EXTRA_STATE.mapping.movingTargetLabel, pos, cargoText(view.detail.loot as Partial<Resources> | undefined), survivors);
        case 'intercept_lost':
          return MOVING_COPY.event.lost(EXTRA_STATE.mapping.movingTargetLabel, pos, survivors);
        case 'intercept_missed':
          return MOVING_COPY.event.missed(pos);
        case 'intercept_gone':
          return MOVING_COPY.event.gone(pos);
        case 'transported':
          return CITY_COPY.transport.eventDelivered(
            pos, tName(String(view.detail.cityName ?? EXTRA_STATE.mapping.targetCityFallback)), cargoText(view.detail.cargo as Partial<Resources>), troops,
          );
        case 'transport_received':
          return CITY_COPY.transport.eventReceived(tName(String(view.detail.fromCityName ?? EXTRA_STATE.mapping.otherCityFallback)), cargoText(view.detail.cargo as Partial<Resources>));
        case 'scouted':
          return scoutCompletedText(view.detail);
        default:
          return EXTRA_STATE.event.marchArrived(pos);
      }
    }
    case 'wilderness_occupied': {
      const resource = terrainResourceLabel(view.detail.resource);
      const bonus = typeof view.detail.bonusRate === 'number' ? EXTRA_STATE.event.wildBonus(resource, view.detail.bonusRate) : '';
      const gather = typeof view.detail.gatherRate === 'number' && view.detail.gatherRate > 0 ? EXTRA_STATE.event.wildGather(view.detail.gatherRate) : '';
      return EXTRA_STATE.event.wildOccupied(posOf(view.detail), terrainName(view.detail.terrain), String(view.detail.level ?? '?'), bonus, gather);
    }
    case 'wilderness_lost': {
      const posLost = posOf(view.detail);
      if (view.detail.cause === 'recall') {
        return EXTRA_STATE.event.wildRecall(posLost);
      }
      // v39（AISLG-123）：被其他玩家抢占（detail.attacker.username）
      if (view.detail.cause === 'conquest') {
        const by = (view.detail.attacker as { username?: string } | undefined)?.username;
        return EXTRA_STATE.event.wildConquest(posLost, by ?? '');
      }
      return EXTRA_STATE.event.wildLost(posLost);
    }
    case 'npc_city_occupied': {
      // v24：占领 NPC 城变分城时接收其剩余库存（stock）；旧版 legacy 路径为掠得（loot）；
      // 城名是后端固定名城名（FAMOUS_CITY_NAMES），英文界面按码表翻译
      const loot = resourcesSuffix((view.detail.stock ?? view.detail.loot) as Partial<Resources> | undefined);
      const name = typeof view.detail.name === 'string' ? tName(view.detail.name) : '';
      return EXTRA_STATE.event.npcCityOccupied(posOf(view.detail), name, loot);
    }
    case 'npc_raid': {
      const losses = troopsSuffix(view.detail.losses as Record<string, unknown> | undefined);
      return view.detail.outcome === 'repelled'
        ? EXTRA_STATE.event.npcRaidRepelled(posOf(view.detail), losses)
        : EXTRA_STATE.event.npcRaidWiped(posOf(view.detail));
    }
    case 'npc_attack_warning': {
      // v23 AISLG-57：预警 = 位置 + 预计到达时刻 + 大致兵力范围
      const where = posOf(view.detail);
      const target = view.detail.target === 'city' ? COPY.npcWarning.targetCity : `${terrainName(view.detail.terrain)} ${where}`;
      const arriveAt = typeof view.detail.arriveAt === 'string' ? formatClock(view.detail.arriveAt) : '?';
      const minutesLeft = Math.max(0, Math.ceil((Date.parse(String(view.detail.arriveAt ?? '')) - Date.now()) / 60_000));
      const mins = Number.isFinite(minutesLeft) ? EXTRA_STATE.event.minutesLeft(minutesLeft) : '';
      const armyMin = String(typeof view.detail.armyMin === 'number' ? view.detail.armyMin : '?');
      const armyMax = String(typeof view.detail.armyMax === 'number' ? view.detail.armyMax : '?');
      return EXTRA_STATE.event.npcWarning(target, arriveAt, mins, armyMin, armyMax);
    }
    case 'player_attack_warning': {
      // v38 AISLG-122 / v39 AISLG-123：玩家部队来袭预警 = 进攻方 + 目标（城 / 你的野地）+ 预计到达 + 兵力范围
      const attacker = view.detail.attacker as { username?: string; cityName?: string } | undefined;
      const who = attacker?.username ? COPY.npcWarning.attackerRow(attacker.username, tName(attacker.cityName ?? '?')) : EXTRA_STATE.event.playerUnknown;
      const arriveAt = typeof view.detail.arriveAt === 'string' ? formatClock(view.detail.arriveAt) : '?';
      const minutesLeft = Math.max(0, Math.ceil((Date.parse(String(view.detail.arriveAt ?? '')) - Date.now()) / 60_000));
      const mins = Number.isFinite(minutesLeft) ? EXTRA_STATE.event.minutesLeft(minutesLeft) : '';
      const armyMin = String(typeof view.detail.armyMin === 'number' ? view.detail.armyMin : '?');
      const armyMax = String(typeof view.detail.armyMax === 'number' ? view.detail.armyMax : '?');
      const where =
        view.detail.target === 'wilderness'
          ? EXTRA_STATE.event.playerTargetWild(posOf(view.detail), terrainName(view.detail.terrain), typeof view.detail.level === 'number' ? view.detail.level : null)
          : EXTRA_STATE.event.playerTargetCity(posOf(view.detail));
      return EXTRA_STATE.event.playerWarning(who, where, arriveAt, mins, armyMin, armyMax);
    }
    case 'pvp_raid': {
      // v38 AISLG-122 玩家攻城结算（守方视角）；v40 AISLG-124 占领攻打带 conquest（降城防 / 换主）
      const attacker = view.detail.attacker as { username?: string } | undefined;
      const who = attacker?.username ?? EXTRA_STATE.event.pvpUnknown;
      const loot = resourcesSuffix(view.detail.loot as Partial<Resources> | undefined);
      if (view.detail.outcome === 'repelled') {
        const losses = troopsSuffix(view.detail.losses as Record<string, unknown> | undefined);
        return EXTRA_STATE.event.pvpRepelled(who, posOf(view.detail), losses);
      }
      const conquest = view.detail.conquest as
        | { before?: number; after?: number; damage?: number; ramBonus?: number; protectedUntil?: string; transferred?: boolean }
        | undefined;
      if (conquest) {
        const defense = EXTRA_STATE.event.pvpDefenseLine(String(conquest.before ?? '?'), String(conquest.after ?? '?'));
        if (conquest.transferred) {
          return EXTRA_STATE.event.pvpTransferred(who, posOf(view.detail), defense);
        }
        const truceLeft = conquest.protectedUntil ? EXTRA_STATE.event.pvpTruceUntil(formatClock(String(conquest.protectedUntil))) : '';
        const ramTail = (conquest.ramBonus ?? 0) > 0 ? EXTRA_STATE.event.pvpRamBonus(conquest.ramBonus ?? 0) : '';
        return EXTRA_STATE.event.pvpConquestHit(who, defense, String(conquest.damage ?? '?'), ramTail, truceLeft);
      }
      const truceLeft = view.detail.truceUntil ? EXTRA_STATE.event.pvpTrucePeriodUntil(formatClock(String(view.detail.truceUntil))) : '';
      return EXTRA_STATE.event.pvpLooted(who, posOf(view.detail), loot || EXTRA_STATE.event.pvpNoLoot, truceLeft);
    }
    case 'city_conquered': {
      // v40 AISLG-124：分城易主（原主 lost / 新主 gained）
      const pos = posOf(view.detail);
      const cityName = tName(String(view.detail.cityName ?? EXTRA_STATE.event.branchFallback));
      if (view.detail.outcome === 'lost') {
        const by = (view.detail.attacker as { username?: string } | undefined)?.username;
        return EXTRA_STATE.event.conquestLost(cityName, pos, by ?? '');
      }
      const from = (view.detail.from as { username?: string } | undefined)?.username;
      const until = view.detail.protectedUntil ? EXTRA_STATE.event.protectionUntil(formatClock(String(view.detail.protectedUntil))) : '';
      return EXTRA_STATE.event.conquestGained(from ?? '', cityName, pos, until);
    }
    case 'truce_started': {
      const until = typeof view.detail.until === 'string' ? formatClock(view.detail.until) : '?';
      return EXTRA_STATE.event.truceStarted(until);
    }
    case 'newbie_protection_ended': {
      const cause = view.detail.cause === 'government' ? EXTRA_STATE.event.newbieCauseGovernment : EXTRA_STATE.event.newbieCauseAttack;
      return EXTRA_STATE.event.newbieEnded(cause);
    }
    case 'resource_exchanged': {
      // v22（AISLG-42）：集市兑换成交（detail.resource / amount / gold / rate）；句式同 COPY.session.exchanged
      const label = terrainResourceLabel(view.detail.resource);
      const amount = typeof view.detail.amount === 'number' ? view.detail.amount : 0;
      const gold = typeof view.detail.gold === 'number' ? view.detail.gold : 0;
      return COPY.session.exchanged(label, amount, gold);
    }
    case 'agent_connected':
      return EXTRA_STATE.event.agentConnected;
    case 'agent_disconnected':
      return EXTRA_STATE.event.agentDisconnected;
    default:
      return view.type;
  }
}

/** 全服播报（v23 AISLG-60）：按类型拼一句话；detail 字段缺失给占位 */
export function serverBroadcastText(view: {
  type: string;
  detail: Record<string, unknown>;
}): string {
  const { YT_COPY, HERO_COPY, EXTRA_STATE } = getCopy();
  const actor =
    typeof view.detail.username === 'string'
      ? view.detail.cityName
        ? `${view.detail.username} · ${tName(String(view.detail.cityName))}`
        : (view.detail.username as string)
      : EXTRA_STATE.mapping.unknownPlayer;
  const pos = posOf(view.detail);
  switch (view.type) {
    case 'npc_city_emptied':
      return EXTRA_STATE.broadcast.npcCityEmptied(actor, String(view.detail.level ?? '?'), pos);
    case 'gold_mine_first':
      return EXTRA_STATE.broadcast.goldMineFirst(actor, pos);
    case 'city_broken':
      return EXTRA_STATE.broadcast.cityBroken(actor);
    case 'win_streak':
      return EXTRA_STATE.broadcast.winStreak(actor, String(view.detail.streak ?? '5'));
    case 'yt_started':
      return YT_COPY.broadcast.started(Number(view.detail.totalCamps ?? 0));
    case 'yt_grown':
      return YT_COPY.broadcast.grown(Number(view.detail.count ?? 0), String(view.detail.label ?? YT_COPY.tierLabel[String(view.detail.tier)] ?? ''));
    case 'yt_boss':
      return YT_COPY.broadcast.boss(Number(view.detail.x ?? 0), Number(view.detail.y ?? 0));
    case 'yt_boss_first_kill':
      return YT_COPY.broadcast.firstKill(actor);
    case 'hero_granted':
      // 名将名与来源标签是后端固定词，英文界面按码表翻译
      return HERO_COPY.broadcast.granted(String(view.detail.username ?? EXTRA_STATE.mapping.unknownPlayer), tName(String(view.detail.heroName ?? '')), tHeroSource(String(view.detail.source ?? '')));
    case 'city_conquered':
      return EXTRA_STATE.broadcast.cityConquered(actor, String(view.detail.from ?? ''), tName(String(view.detail.cityName ?? '?')), pos);
    case 'yt_finished':
      return YT_COPY.broadcast.finished(String(view.detail.reason ?? ''), Number(view.detail.clearedCamps ?? 0), Number(view.detail.totalCamps ?? 0), Number(view.detail.scatteredCamps ?? 0));
    default:
      return EXTRA_STATE.broadcast.headline(view.type);
  }
}
