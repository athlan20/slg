// 数据库行到协议视图的映射，以及城池状态查询。handlers 与 notify 共用。
// 城池读取自带生产懒结算：在事务内锁定行，把产量推进到数据库当前时刻后再组装视图，
// 离线累积的资源在读取这一刻落账（结算规则见 common/src/production.ts）。

import pg from 'pg';
import {
  BUILDING_KINDS,
  TROOP_KINDS,
  isMarchPurpose,
  type BuildingCounts,
  type BuildView,
  type CityView,
  type InitiatorRole,
  type MarchView,
  type RecruitView,
  type Resources,
  type TerritoryView,
  type TroopKind,
} from '../../common/src/protocol';
import {
  loadArmyFoodUsePerHour,
  loadBuildingLevels,
  productionPerHour,
  settleCityProduction,
  storageCaps,
  type BuildingLevels,
  type CityProductionRow,
  type ProducedResource,
} from '../../common/src/production';
import { loadCityGuard } from '../../common/src/hero-db';
import { guardProductionPercent } from '../../common/src/hero';
import {
  wallBasePercent,
  actionCosts,
  popCap,
  populationGrowthPerHour,
} from '../../common/src/rules';
import { toFullArmyCounts } from '../../common/src/battle';
import {
  TERRAIN_INFO,
  clusterBonusMultiplier,
  territoryClusterSizes,
  territoryRates,
  wildernessBonusRate,
  wildernessGatherRate,
  type TerritoryRow,
} from '../../common/src/world';
import { loadTerritory } from '../../common/src/world-db';
import { getTimeScale } from '../../common/src/time-scale';
import { selfTruceNextAvailableAt, settleDurability } from '../../common/src/protection';
import { cityLevelOf } from '../../common/src/branch-city';
import { FAMOUS_PRODUCTION_BONUS_PERCENT } from '../../common/src/famous-city';
import { readCargo } from '../../common/src/transport';
import { projectStarvation } from '../../common/src/starvation';
import { deployLimit, towerStats } from '../../common/src/building-effects';
import { defenseExtraPercent, type TechLevels } from '../../common/src/tech';
import { loadTechLevels } from '../../common/src/tech-db';
import { currentCityId } from './city-scope';

export interface BuildRow {
  id: string;
  account_id: string;
  city_id: string;
  kind: string;
  status: string;
  level: number;
  /** 连续升级目标（v22 AISLG-43）：整链终点等级；单级与建造为 null */
  to_level?: number | null;
  initiator: string;
  started_at: Date;
  /** 排队中（status='queued'）为 null */
  due_at: Date | null;
  completed_at: Date | null;
}

export function buildView(row: BuildRow): BuildView {
  const status: BuildView['status'] =
    row.status === 'completed'
      ? 'completed'
      : row.status === 'queued'
        ? 'queued'
        : row.status === 'cancelled'
          ? 'cancelled'
          : 'building';
  return {
    id: row.id,
    cityId: row.city_id,
    kind: row.kind as BuildView['kind'],
    status,
    level: row.level,
    toLevel: row.to_level ?? null,
    initiator: (row.initiator === 'agent' ? 'agent' : 'player') as InitiatorRole,
    startedAt: row.started_at.toISOString(),
    dueAt: row.due_at ? row.due_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

/** 征兵行（recruits 表；形态对齐 BuildRow） */
export interface RecruitRow {
  id: string;
  account_id: string;
  city_id: string;
  troop: string;
  count: number;
  status: string;
  initiator: string;
  started_at: Date;
  /** 排队中为 null */
  due_at: Date | null;
  completed_at: Date | null;
}

export function recruitView(row: RecruitRow): RecruitView {
  const status: RecruitView['status'] =
    row.status === 'completed'
      ? 'completed'
      : row.status === 'queued'
        ? 'queued'
        : row.status === 'cancelled'
          ? 'cancelled'
          : 'recruiting';
  return {
    id: row.id,
    cityId: row.city_id,
    troop: row.troop as TroopKind,
    count: row.count,
    status,
    initiator: (row.initiator === 'agent' ? 'agent' : 'player') as InitiatorRole,
    startedAt: row.started_at.toISOString(),
    dueAt: row.due_at ? row.due_at.toISOString() : null,
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

/** 行军行（marches 表；troops 为按兵种的 jsonb 快照） */
export interface MarchRow {
  id: string;
  account_id: string;
  from_city_id: string;
  x: number;
  y: number;
  troops: Partial<Record<TroopKind, number>> | null;
  purpose: string;
  status: string;
  initiator: string;
  started_at: Date;
  arrive_at: Date;
  resolved_at: Date | null;
  /** v26：运输货物（jsonb），非运输行军为 null */
  cargo?: unknown;
  /** v28：截击的移动目标 id，其余为 null */
  target_id?: string | null;
  /** v35（AISLG-112）：截击埋伏开始的时刻（到了先埋伏；此时 arrive_at 为预计接战时刻），其余为 null */
  ambush_at?: Date | null;
  /** v36（AISLG-114）：随队武将 id（返程行军沿用，回城后自然释放），其余为 null */
  hero_id?: string | null;
}

export function marchView(row: MarchRow): MarchView {
  return {
    id: row.id,
    fromCityId: row.from_city_id,
    x: row.x,
    y: row.y,
    troops: toFullArmyCounts(row.troops ?? {}),
    purpose: isMarchPurpose(row.purpose) ? row.purpose : 'attack',
    status: row.status === 'arrived' ? 'arrived' : row.status === 'returned' ? 'returned' : 'marching',
    initiator: (row.initiator === 'agent' ? 'agent' : 'player') as InitiatorRole,
    startedAt: row.started_at.toISOString(),
    arriveAt: row.arrive_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
    targetId: row.target_id ?? null,
    cargo: readCargo(row.cargo),
    ambushAt: row.ambush_at ? new Date(row.ambush_at).toISOString() : null,
    heroId: row.hero_id ?? null,
  };
}

/** 事务内的城池快照：结算后的资源、人口、建筑等级与建造队列（在建 + 排队） */
export interface CitySnapshot {
  cityId: string;
  name: string;
  /** 城池数字等级（提升条件待设计，当前恒为 1） */
  cityLevel: number;
  /** 城池在世界中的坐标（未分配时为 null；出征以它计算行军距离） */
  x: number | null;
  y: number | null;
  levels: BuildingLevels;
  resources: Resources;
  /** 结算后的当前人口（懒结算推进到读取时刻） */
  population: number;
  /** 城内驻军，按兵种统计 */
  army: Record<TroopKind, number>;
  /** 全军小时耗粮（v14）：城内 1 倍 + 行军/野地驻军 ×2；结算与视图取同一值 */
  armyFoodUsePerHour: number;
  /** 在建在前，排队按入队顺序 */
  queue: BuildRow[];
  /** 征募中在前，排队按入队顺序 */
  recruitQueue: RecruitRow[];
  /** 本城进行中的行军（v12） */
  marches: MarchRow[];
  /** 本城占领的野地（v12，含驻军总数） */
  territory: TerritoryRow[];
  /** 独占产量加成（百分数，v24 AISLG-56：名城分城 +20%）与名城名；普通城为 0 / null */
  productionBonusPercent: number;
  famousName: string | null;
  /** 城守产量加成（百分数，v36 AISLG-115：四资源非金）与城守武将；未任为 0 / null */
  guardProductionPercent: number;
  guardHero: { id: string; name: string; famous: boolean; lead: number; force: number; wit: number; level: number } | null;
  /** 下一次断粮哗变时刻（v34 AISLG-107）：已断粮时有值，否则 null */
  mutinyNextAt: Date | null;
  /** 账号科技等级（v27 AISLG-77；全账号共享，作用于产量 / 储量 / 负重 / 行军 / 守城） */
  techs: TechLevels;
  /** 主城免战截止（v22 AISLG-40）：被 NPC 攻破后写入，免战期内不入袭击目标池；从未被攻破为 null */
  truceUntil: Date | null;
  /** 新手保护截止（v38 AISLG-122，账号级）：期内别人不能侦察 / 攻击他；已出保为 null */
  newbieUntil: Date | null;
  /** 主动免战截止（v38 AISLG-122，账号级）：TRUCE 开启后写入；未开启为 null */
  shieldUntil: Date | null;
  /** 上次开启主动免战的时刻（v38；周窗口判定用） */
  shieldUsedAt: Date | null;
  /** 分城城防值原始列（v40 AISLG-124；主城为 null；展示前需经 settleDurability 惰性结算） */
  durability: number | null;
  durabilitySettledAt: Date | null;
  /** 账号主城 id（v40：城防值只属于分城） */
  mainCityId: string;
}

/** 在已开启的事务内锁定城池行并结算生产；调用方负责 BEGIN / COMMIT */
export async function lockCitySnapshot(
  client: pg.PoolClient,
  accountId: string,
  cityId: string | undefined = currentCityId(),
): Promise<CitySnapshot | null> {
  // cityId 缺省 = 主城（创建最早）；指定时只认本账号名下的城（分发层已校验归属）
  const sel = await client.query(
    `SELECT id, name, level, x, y, gold, wood, food, stone, iron,
            settled_at, gold_rem, food_rem, wood_rem, stone_rem, iron_rem,
            population, population_rem, truce_until, famous_name, mutiny_next_at,
            durability, durability_settled_at, now() AS db_now
     FROM cities WHERE account_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)
     ORDER BY created_at LIMIT 1 FOR UPDATE`,
    [accountId, cityId ?? null],
  );
  if (!sel.rowCount) {
    return null;
  }
  const row = sel.rows[0] as CityProductionRow & {
    name: string; level: number; x: number | null; y: number | null; db_now: Date; truce_until: Date | null; famous_name: string | null; mutiny_next_at: Date | null;
    durability: number | null; durability_settled_at: Date | null;
  };
  const levels = await loadBuildingLevels(client, row.id);
  const techs = await loadTechLevels(client, accountId);
  const territory = await loadTerritory(client, row.id);
  const armyFoodUsePerHour = await loadArmyFoodUsePerHour(client, row.id);
  // v36（AISLG-115）：城守（产量加成 + 守城加成的数据源）
  const guard = await loadCityGuard(client, row.id);
  const settled = await settleCityProduction(
    client,
    row,
    levels,
    row.db_now,
    territoryRates(territory),
    armyFoodUsePerHour,
  );
  const queueRes = await client.query(
    `SELECT * FROM builds
     WHERE city_id = $1 AND status IN ('building', 'queued')
     ORDER BY CASE status WHEN 'building' THEN 0 ELSE 1 END, started_at, id`,
    [row.id],
  );
  const army = await loadCityArmy(client, row.id);
  // v38（AISLG-122）：账号级保护状态（新手保护 / 主动免战）
  const accountRes = await client.query(
    `SELECT newbie_until, self_truce_until, self_truce_used_at FROM accounts WHERE id = $1`,
    [accountId],
  );
  const accountRow = accountRes.rows[0] as
    | { newbie_until: Date | null; self_truce_until: Date | null; self_truce_used_at: Date | null }
    | undefined;
  const recruitRes = await client.query(
    `SELECT * FROM recruits
     WHERE city_id = $1 AND status IN ('recruiting', 'queued')
     ORDER BY CASE status WHEN 'recruiting' THEN 0 ELSE 1 END, started_at, id`,
    [row.id],
  );
  const marchRes = await client.query(
    `SELECT * FROM marches
     WHERE from_city_id = $1 AND status = 'marching'
     ORDER BY arrive_at, id`,
    [row.id],
  );
  // v40：主城 = 账号最早创建的城（城防值只属于分城）
  const mainRes = await client.query(
    `SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`,
    [accountId],
  );
  const mainCityId = (mainRes.rows[0] as { id: string } | undefined)?.id ?? row.id;
  return {
    cityId: row.id,
    name: row.name,
    cityLevel: row.level,
    x: row.x,
    y: row.y,
    truceUntil: row.truce_until,
    newbieUntil: accountRow?.newbie_until ?? null,
    shieldUntil: accountRow?.self_truce_until ?? null,
    shieldUsedAt: accountRow?.self_truce_used_at ?? null,
    durability: row.durability,
    durabilitySettledAt: row.durability_settled_at,
    mainCityId,
    mutinyNextAt: row.mutiny_next_at,
    famousName: row.famous_name,
    productionBonusPercent: row.famous_name ? FAMOUS_PRODUCTION_BONUS_PERCENT : 0,
    guardProductionPercent: guard ? guardProductionPercent(guard.wit) : 0,
    guardHero: guard
      ? { id: guard.id, name: guard.name, famous: guard.famous, lead: guard.lead, force: guard.force, wit: guard.wit, level: guard.level }
      : null,
    techs,
    levels,
    resources: settled.resources,
    population: settled.population,
    army,
    armyFoodUsePerHour,
    queue: queueRes.rows as BuildRow[],
    recruitQueue: recruitRes.rows as RecruitRow[],
    marches: marchRes.rows as MarchRow[],
    territory,
  };
}

/** 本城在外部队数（v30，AISLG-80）：进行中的行军（含返程）+ 本城占领野地的驻军（每块野地算一支） */
export function deployCountOf(snap: Pick<CitySnapshot, 'marches' | 'territory'>): number {
  return snap.marches.length + snap.territory.length;
}

/** 按建筑类型展开数量（0/1）与等级两张映射（v7 起为九种建筑） */
function kindRecords(levels: BuildingLevels): { buildings: BuildingCounts; levels: BuildingCounts } {
  const buildings = {} as BuildingCounts;
  const levelRecord = {} as BuildingCounts;
  for (const kind of BUILDING_KINDS) {
    const level = levels[kind] ?? 0;
    buildings[kind] = level > 0 ? 1 : 0;
    levelRecord[kind] = level;
  }
  return { buildings, levels: levelRecord };
}

export function toCityView(snap: CitySnapshot): CityView {
  const queue = snap.queue.map(buildView);
  const records = kindRecords(snap.levels);
  const production = productionPerHour(
    snap.levels, territoryRates(snap.territory), snap.productionBonusPercent, snap.techs, snap.guardProductionPercent,
  );
  const roundedProduction = {} as Record<ProducedResource, number>;
  for (const key of Object.keys(production) as Array<keyof typeof production>) {
    roundedProduction[key] = Math.round(production[key]);
  }
  // v34（AISLG-107）：预计断粮时间 = 当前粮食 ÷（粮毛产量 − 全军耗粮）；已断粮为当前时刻，不会断粮为 null
  const starvation = projectStarvation(snap.resources.food, production.food - snap.armyFoodUsePerHour, Date.now());
  return {
    id: snap.cityId,
    name: snap.name,
    // v24（AISLG-58）：城池等级 = 该城官府等级（原 cities.level 恒为 1，不再作为口径）
    level: cityLevelOf(snap.levels.government),
    resources: snap.resources,
    // v5 单实例：数量恒为 0/1；等级才是权威状态
    buildings: records.buildings,
    levels: records.levels,
    // v6：下一步动作成本（未建=建造成本，已建未满级=升级成本）
    costs: actionCosts(snap.levels),
    farms: records.buildings.farm,
    production: roundedProduction,
    population: {
      current: snap.population,
      cap: popCap(snap.levels.house),
      growthPerHour: populationGrowthPerHour(snap.levels.house),
    },
    storage: storageCaps(snap.levels, snap.techs),
    army: { ...snap.army },
    // v14：军队小时耗粮（production.food 为毛产量；净粮 = production.food − 本值）
    armyFoodUsePerHour: snap.armyFoodUsePerHour,
    // v20：全局时间缩放（AISLG-38）——客户端本地折算时长（冷却剩余等）用
    timeScale: getTimeScale(),
    truceUntil: snap.truceUntil ? snap.truceUntil.toISOString() : null,
    newbieUntil: snap.newbieUntil ? snap.newbieUntil.toISOString() : null,
    shieldUntil: snap.shieldUntil ? snap.shieldUntil.toISOString() : null,
    shieldNextAt: (() => {
      const next = selfTruceNextAvailableAt(snap.shieldUsedAt);
      return next && next.getTime() > Date.now() ? next.toISOString() : null;
    })(),
    // v40（AISLG-124）：分城城防值（主城 null；免战截止前不回涨，之后按小时惰性结算到满）
    durability:
      snap.cityId === snap.mainCityId
        ? null
        : settleDurability(snap.durability, snap.durabilitySettledAt, snap.truceUntil, new Date()),
    famousName: snap.famousName,
    productionBonusPercent: snap.productionBonusPercent,
    guard: snap.guardHero
      ? { heroId: snap.guardHero.id, ...snap.guardHero, bonusPercent: snap.guardProductionPercent }
      : null,
    recruitQueue: snap.recruitQueue.map(recruitView),
    defenseBonus: wallBasePercent(snap.levels.wall) + defenseExtraPercent(snap.techs),
    techs: { ...snap.techs },
    // v30（AISLG-80）：在外部队 = 行军中（含返程）+ 驻守野地；上限 = 校场等级（未建按 1）
    starveAt: starvation.starveAtMs === null ? null : new Date(starvation.starveAtMs).toISOString(),
    mutinyNextAt: snap.mutinyNextAt ? snap.mutinyNextAt.toISOString() : null,
    deploy: { count: deployCountOf(snap), limit: deployLimit(snap.levels.parade_ground) },
    tower: towerStats(snap.levels.arrow_tower),
    marches: snap.marches.map(marchView),
    territory: snap.territory.map((tile) => {
      const sizes = territoryClusterSizes(snap.territory);
      return {
        x: tile.x,
        y: tile.y,
        terrain: tile.terrain,
        level: tile.level,
        resource: TERRAIN_INFO[tile.terrain].resource,
        bonusRate: wildernessBonusRate(tile.terrain, tile.level),
        gatherRate: wildernessGatherRate(tile.terrain, tile.level, tile.garrison),
        garrison: tile.garrison,
        clusterSize: sizes.get(`${tile.x},${tile.y}`) ?? 1,
        clusterBonusPercent: Math.round((clusterBonusMultiplier(sizes.get(`${tile.x},${tile.y}`) ?? 1) - 1) * 100),
      };
    }),
    queue,
    building: queue.find((item) => item.status === 'building') ?? null,
  };
}

/** 城内驻军（按兵种统计；无行视为 0） */
export async function loadCityArmy(
  q: pg.Pool | pg.PoolClient,
  cityId: string,
): Promise<Record<TroopKind, number>> {
  const res = await q.query(`SELECT troop, count FROM city_army WHERE city_id = $1`, [cityId]);
  const army = {} as Record<TroopKind, number>;
  for (const kind of TROOP_KINDS) {
    army[kind] = 0;
  }
  for (const row of res.rows as Array<{ troop: TroopKind; count: number }>) {
    if ((TROOP_KINDS as readonly string[]).includes(row.troop)) {
      army[row.troop] = row.count;
    }
  }
  return army;
}

/** 查询账号当前城池状态（第一期每账号单城）；读取即结算，返回的产量与资源对齐同一时刻 */
export async function loadCityState(
  pool: pg.Pool,
  accountId: string,
  cityId: string | undefined = currentCityId(),
): Promise<CityView | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await lockCitySnapshot(client, accountId, cityId);
    await client.query('COMMIT');
    return snap ? toCityView(snap) : null;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
