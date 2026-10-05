// MARCH 的请求参数读取与出征目标判定（从 handlers-world.ts 拆出以控制单文件行数）。
// readMarchParams 供分发层校验；resolveMarchTarget 在 handleMarch 事务内按目标地块落 purpose。

import pg from 'pg';
import {
  TROOP_KINDS,
  isMarchTask,
  type MarchTask,
  type Resources,
  type TroopKind,
} from '../../common/src/protocol';
import { isEmptyArmy } from '../../common/src/battle';
import { PLUNDER_COOLDOWN_MS, inPlunderCooldown, territoryLimit } from '../../common/src/plunder';
import type { NpcCitySnapshot } from '../../common/src/world';
import type { TileRow } from '../../common/src/world-db';
import { checkOccupyNpcCity, type OccupyCityDenial } from '../../common/src/branch-city';
import { famousStage } from '../../common/src/famous-city';
import { loadBranchStanding } from '../../common/src/branch-city-db';import { parseCargo } from '../../common/src/transport';
import { loadMovingTarget, rowIndexAt, rowStepMs } from '../../common/src/moving-target-db';
import { loadCampAt } from '../../common/src/yellow-turban-db';
import { reachWindowOf, routeIndexOfCell } from '../../common/src/moving-target';
import { activeAt, inNewbieProtection } from '../../common/src/protection';

/** MARCH 请求参数校验（分发层用）：坐标为整数、troops 为已知兵种的非负整数且不全为 0；
 *  task（v16）可选，缺省 'plunder'，非法值拒绝。
 *  世界范围不作为参数错误：越界坐标交由 resolveMarchTarget 判为 TARGET_NOT_ATTACKABLE。
 *  v26（AISLG-79）：task='transport' 必须带合法 cargo（五项非负整数、总量 ≥ 1），
 *  其余任务带 cargo 视为参数错误。
 *  v28（AISLG-78）：带 targetId（移动目标 UUID）即截击——此时 task 忽略、cargo 不接受。 */
const HERO_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readMarchParams(
  data: Record<string, unknown> | undefined,
): { x: number; y: number; troops: Partial<Record<TroopKind, number>>; task: MarchTask; cargo: Resources | null; targetId: string | null; heroId: string | null } | null {
  const x = data?.x;
  const y = data?.y;
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return null;
  }
  const raw = data?.troops;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const troops: Partial<Record<TroopKind, number>> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(TROOP_KINDS as readonly string[]).includes(key)) {
      return null;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return null;
    }
    troops[key as TroopKind] = value;
  }
  if (isEmptyArmy(troops)) {
    return null;
  }
  if ('task' in (data ?? {}) && data?.task !== undefined && !isMarchTask(data?.task)) {
    return null;
  }
  const task: MarchTask = data?.task === 'occupy' ? 'occupy' : data?.task === 'transport' ? 'transport' : 'plunder';
  let targetId: string | null = null;
  if (data?.targetId !== undefined && data?.targetId !== null) {
    if (typeof data.targetId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.targetId)) {
      return null;
    }
    if (data?.cargo !== undefined && data?.cargo !== null) {
      return null;
    }
    targetId = data.targetId;
    const heroId = readHeroId(data);
    if (heroId === false) {
      return null;
    }
    return { x: x as number, y: y as number, troops, task: 'plunder', cargo: null, targetId, heroId };
  }
  let cargo: Resources | null = null;
  if (task === 'transport') {
    cargo = parseCargo(data?.cargo);
    if (!cargo) {
      return null;
    }
  } else if (data?.cargo !== undefined && data?.cargo !== null) {
    return null;
  }
  const heroId = readHeroId(data);
  if (heroId === false) {
    return null;
  }
  return { x: x as number, y: y as number, troops, task, cargo, targetId, heroId };
}

/** 可选随队武将（v36，AISLG-114）：UUID；缺省 / null = 不带武将；给了但格式不对 = 参数错误（返回 false） */
function readHeroId(data: Record<string, unknown> | undefined): string | null | false {
  const heroId = data?.heroId;
  if (heroId === undefined || heroId === null) {
    return null;
  }
  return typeof heroId === 'string' && HERO_UUID_RE.test(heroId) ? heroId : false;
}

/** 出征目标判定结果：purpose 写入 marches；reason 为拒绝错误码 */
export interface MarchTargetVerdict {
  purpose: 'plunder' | 'occupy' | 'reinforce' | 'transfer' | 'transport' | 'intercept' | null;
  reason?:
    | 'MOVING_TARGET_GONE'
    | 'TARGET_NOT_ATTACKABLE' | 'INVALID_PARAMS' | 'TASK_INVALID_FOR_TARGET' | 'PLUNDER_COOLDOWN' | 'TERRITORY_LIMIT'
    | OccupyCityDenial | 'OUTER_NOT_CLEARED'
    | 'NEWBIE_PROTECTED' | 'TARGET_IN_TRUCE' | 'SELF_TRUCE_ACTIVE' | 'TILE_PROTECTED';
  targetCityId?: string;
  /** v38（AISLG-122）：NEWBIE_PROTECTED / TARGET_IN_TRUCE / SELF_TRUCE_ACTIVE 的截止时刻，
   *  handleMarch 据此回传 until 与 retryAfterSeconds */
  protectedUntil?: Date;
  /** v38（AISLG-122）/ v39（AISLG-123）：目标是其他玩家（掠夺其城池 / 抢占其野地）——
   *  来袭预警推送与新手保护失效的判定依据 */
  pvp?: {
    kind: 'city' | 'wilderness';
    /** 城池目标 = 该城；野地目标 = 占领该地块的城（预警的烽火台归属，AISLG-81 口径） */
    targetCityId: string;
    targetAccountId: string;
    /** 仅野地目标：目标地形与等级（预警展示） */
    terrain?: import('../../common/src/protocol').TerrainKind;
    level?: number;
  };
  /** v35（AISLG-112）：截击目标从当前下标起进入选定格相邻范围的连续时间窗（毫秒时间戳）；
   *  部队到达时刻 < to 时按「到了先埋伏」顺延接战，≥ to 仍按到达时刻结算（太晚扑空） */
  interceptWindow?: { from: number; to: number } | null;
}

/**
 * 出征目标判定与发起前校验（v16）：
 * - 无主野地 → 按 task 落 purpose（plunder / occupy；occupy 先核占领上限 =
 *   官府等级，超限 TERRITORY_LIMIT；plunder 先核 24 小时掠夺冷却，冷却中
 *   PLUNDER_COOLDOWN）；
 * - 本账号占领的野地 → reinforce（增援驻军，不战斗，task 忽略）；
 * - NPC 城池（未被占领）→ plunder（校验掠夺冷却）或 occupy（v24：占领变分城，校验
 *   GOVERNMENT_TOO_LOW / BRANCH_LIMIT / TARGET_LEVEL_TOO_HIGH，不受掠夺冷却限制）；
 * - 本账号**其他**城池（分城）→ transfer（调兵，不战斗）；
 * - 他人城池（v38，AISLG-122）→ plunder（掠夺）：先核守方新手保护（NEWBIE_PROTECTED）/
 *   免战（TARGET_IN_TRUCE，被动城级与主动账号级任一生效）与攻方主动免战（SELF_TRUCE_ACTIVE）；
 *   task='occupy' 仍拒绝（TASK_INVALID_FOR_TARGET，占领玩家城随后续阶段）；
 * - 其余（自己的出发主城等）→ 拒绝（TARGET_NOT_ATTACKABLE / INVALID_PARAMS）。
 *   到达结算由 Worker 在锁内复核（易主 / 冷却 / 上限 / 保护与免战）。
 */
export async function resolveMarchTarget(
  client: pg.PoolClient,
  accountId: string,
  fromCityId: string,
  tile: TileRow | null,
  task: MarchTask,
  governmentLevel: number,
  dbNow: Date,
): Promise<MarchTargetVerdict> {
  if (!tile) {
    return { purpose: null, reason: 'TARGET_NOT_ATTACKABLE' };
  }
  // v26（AISLG-79）：运输只能送到本账号的另一座城；其余目标一律 TASK_INVALID_FOR_TARGET
  if (task === 'transport') {
    const own = tile.kind === 'city' && tile.owner_city_id
      ? await client.query(`SELECT id FROM cities WHERE id = $1 AND account_id = $2`, [tile.owner_city_id, accountId])
      : null;
    const targetId = own?.rowCount ? (own.rows[0] as { id: string }).id : null;
    if (!targetId || targetId === fromCityId) {
      return { purpose: null, reason: 'TASK_INVALID_FOR_TARGET' };
    }
    return { purpose: 'transport', targetCityId: targetId };
  }
  if (tile.kind === 'wilderness') {
    // v29（AISLG-76）：黄巾营地 / 老巢所在格——出征同打野地（掠夺任务），不能占领、不受掠夺冷却限制
    if (!tile.owner_city_id && (await loadCampAt(client, tile.x, tile.y))) {
      return task === 'occupy' ? { purpose: null, reason: 'TASK_INVALID_FOR_TARGET' } : { purpose: 'plunder' };
    }
    if (!tile.owner_city_id) {
      if (task === 'occupy') {
        const ownedRes = await client.query(
          `SELECT count(*)::int AS n FROM world_tiles WHERE owner_city_id = $1 AND kind = 'wilderness'`,
          [fromCityId],
        );
        const owned = (ownedRes.rows[0] as { n: number }).n;
        if (owned >= territoryLimit(governmentLevel)) {
          return { purpose: null, reason: 'TERRITORY_LIMIT' };
        }
        return { purpose: 'occupy' };
      }
      if (inPlunderCooldown(tile.plundered_at, dbNow)) {
        return { purpose: null, reason: 'PLUNDER_COOLDOWN' };
      }
      return { purpose: 'plunder' };
    }
    const own = await client.query(
      `SELECT 1 FROM cities WHERE id = $1 AND account_id = $2`,
      [tile.owner_city_id, accountId],
    );
    if (own.rowCount) {
      return { purpose: 'reinforce' };
    }
    // v39（AISLG-123 玩家对抗二）：他人占领的野地——开放 task='occupy' 抢占（野地战，
    // 打掉对方驻军后地块易主）；地里没有存货可抢，缺省掠夺任务返回 TASK_INVALID_FOR_TARGET
    if (task !== 'occupy') {
      return { purpose: null, reason: 'TASK_INVALID_FOR_TARGET' };
    }
    const denial = await wildernessDenial(client, accountId, tile, dbNow);
    if (denial) {
      return denial;
    }
    const ownerRes = await client.query(
      `SELECT c.account_id FROM cities c WHERE c.id = $1`,
      [tile.owner_city_id],
    );
    const ownerAccountId = ownerRes.rowCount ? (ownerRes.rows[0] as { account_id: string }).account_id : null;
    return {
      purpose: 'occupy',
      pvp: {
        kind: 'wilderness',
        targetCityId: tile.owner_city_id,
        targetAccountId: ownerAccountId ?? '',
        terrain: tile.terrain,
        level: tile.level,
      },
    };
  }
  if (tile.kind === 'npc_city') {
    // 被占领的 NPC 城池地块已转为 kind='city'；此处兜底拦掉快照缺失的异常行
    if (!tile.npc) {
      return { purpose: null, reason: 'TARGET_NOT_ATTACKABLE' };
    }
    // v24（AISLG-58）：重新开放占领 NPC 城变分城——主城官府 ≥ 3、分城数 < 上限、
    // 目标等级 ≤ 出发城官府等级；到达时 Worker 在锁内复核。占领不受掠夺冷却限制
    // v24（AISLG-56）：名城分两阶段——外围阶段的出征打外围（掠夺 / 占领都先清外围，
    // 不受掠夺冷却限制）；外围未清时直接占领（攻城守）被拒绝并提示原因
    const famous = (tile.npc as NpcCitySnapshot).famous;
    const outerStage = famous !== undefined && famousStage(famous, dbNow) === 'outer';
    if (task === 'occupy' && outerStage) {
      return { purpose: null, reason: 'OUTER_NOT_CLEARED' };
    }
    if (task === 'occupy') {
      const standing = await loadBranchStanding(client, accountId);
      const denial = checkOccupyNpcCity({
        mainGovernment: standing.mainGovernment,
        fromGovernment: governmentLevel,
        branchCount: standing.branchCount,
        targetLevel: tile.level,
      });
      return denial ? { purpose: null, reason: denial } : { purpose: 'occupy' };
    }
    if (!outerStage && inPlunderCooldown(tile.plundered_at, dbNow)) {
      return { purpose: null, reason: 'PLUNDER_COOLDOWN' };
    }
    return { purpose: 'plunder' };
  }
  // 玩家城池（kind='city'）：本账号分城 → 调兵；他人城池 v38（AISLG-122）起开放掠夺
  if (!tile.owner_city_id) {
    return { purpose: null, reason: 'TARGET_NOT_ATTACKABLE' };
  }
  const cityRes = await client.query(
    `SELECT c.id, c.account_id, c.truce_until, a.newbie_until, a.self_truce_until
     FROM cities c JOIN accounts a ON a.id = c.account_id
     WHERE c.id = $1`,
    [tile.owner_city_id],
  );
  if (!cityRes.rowCount) {
    return { purpose: null, reason: 'TARGET_NOT_ATTACKABLE' };
  }
  const city = cityRes.rows[0] as {
    id: string; account_id: string; truce_until: Date | null; newbie_until: Date | null; self_truce_until: Date | null;
  };
  if (city.account_id === accountId) {
    if (city.id === fromCityId) {
      // 目标即出发城（主城）：文档口径为「自己的城」不可出征 → TARGET_NOT_ATTACKABLE
      return { purpose: null, reason: 'TARGET_NOT_ATTACKABLE' };
    }
    return { purpose: 'transfer', targetCityId: city.id };
  }
  // 他人城池（v38 AISLG-122 开放掠夺；v40 AISLG-124 分城开放「占领」）
  if (task === 'occupy') {
    // 主城永远不能被占领（只能被掠夺）
    const mainRes = await client.query(
      `SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`,
      [city.account_id],
    );
    if ((mainRes.rows[0] as { id: string } | undefined)?.id === city.id) {
      return { purpose: null, reason: 'TASK_INVALID_FOR_TARGET' };
    }
    // 分城：占领资格与 NPC 城同口径（主城官府 ≥3、分城名额、目标等级 ≤ 出发城官府；
    // 目标等级 = 该城官府等级）。发起时初核，Worker 到达复核（名额没了照打、只降城防值）
    const standing = await loadBranchStanding(client, accountId);
    const targetGovRes = await client.query(
      `SELECT COALESCE(g.level, 0)::int AS level FROM city_buildings g WHERE g.city_id = $1 AND g.kind = 'government'`,
      [city.id],
    );
    const targetLevel = targetGovRes.rowCount ? (targetGovRes.rows[0] as { level: number }).level : 0;
    const denial = checkOccupyNpcCity({
      mainGovernment: standing.mainGovernment,
      fromGovernment: governmentLevel,
      branchCount: standing.branchCount,
      targetLevel,
    });
    if (denial) {
      return { purpose: null, reason: denial };
    }
  }
  const denial = await pvpTargetDenial(client, accountId, city, dbNow);
  if (denial) {
    return denial;
  }
  return {
    purpose: task === 'occupy' ? 'occupy' : 'plunder',
    pvp: { kind: 'city', targetCityId: city.id, targetAccountId: city.account_id },
  };
}

/** 目标方（city 行含守方账号的保护列）与进攻方账号的保护 / 免战判定（v38，AISLG-122）；
 *  发起时初核，Worker 到达在锁内复核。通过返回 null */
async function pvpTargetDenial(
  client: pg.PoolClient,
  accountId: string,
  city: { account_id: string; truce_until: Date | null; newbie_until: Date | null; self_truce_until: Date | null },
  dbNow: Date,
): Promise<MarchTargetVerdict | null> {
  // 守方新手保护：别人不能侦察、攻击他
  if (inNewbieProtection(city.newbie_until, dbNow)) {
    return { purpose: null, reason: 'NEWBIE_PROTECTED', protectedUntil: activeAt(city.newbie_until, dbNow) ?? undefined };
  }
  // 守方免战：被动（被打后，城级）与主动（账号级）任一生效，取更晚者
  const truceAt = laterOf(activeAt(city.truce_until, dbNow), activeAt(city.self_truce_until, dbNow));
  if (truceAt) {
    return { purpose: null, reason: 'TARGET_IN_TRUCE', protectedUntil: truceAt };
  }
  return attackerShieldDenial(client, accountId, dbNow);
}

/** 抢占他人野地的保护判定（v39，AISLG-123）：地块换主保护 + 守方账号级保护（新手 / 主动免战）+
 *  攻方主动免战。守方某座城的被动免战（cities.truce_until）**不**保护野地。通过返回 null */
async function wildernessDenial(
  client: pg.PoolClient,
  accountId: string,
  tile: TileRow,
  dbNow: Date,
): Promise<MarchTargetVerdict | null> {
  // 刚换主人的野地有一小段保护，谁都不能抢（防拉锯）
  const capturedAt = activeAt(tile.owner_changed_until ?? null, dbNow);
  if (capturedAt) {
    return { purpose: null, reason: 'TILE_PROTECTED', protectedUntil: capturedAt };
  }
  const ownerRes = await client.query(
    `SELECT a.newbie_until, a.self_truce_until
     FROM cities c JOIN accounts a ON a.id = c.account_id
     WHERE c.id = $1`,
    [tile.owner_city_id],
  );
  const owner = ownerRes.rows[0] as { newbie_until: Date | null; self_truce_until: Date | null } | undefined;
  if (owner) {
    if (inNewbieProtection(owner.newbie_until, dbNow)) {
      return { purpose: null, reason: 'NEWBIE_PROTECTED', protectedUntil: activeAt(owner.newbie_until, dbNow) ?? undefined };
    }
    const shieldAt = activeAt(owner.self_truce_until, dbNow);
    if (shieldAt) {
      return { purpose: null, reason: 'TARGET_IN_TRUCE', protectedUntil: shieldAt };
    }
  }
  return attackerShieldDenial(client, accountId, dbNow);
}

/** 攻方自己的主动免战：生效中不能出兵打玩家（含抢野地；打野地 / NPC 不受限） */
async function attackerShieldDenial(
  client: pg.PoolClient,
  accountId: string,
  dbNow: Date,
): Promise<MarchTargetVerdict | null> {
  const selfRes = await client.query(`SELECT self_truce_until FROM accounts WHERE id = $1`, [accountId]);
  const selfTruce = (selfRes.rows[0] as { self_truce_until: Date | null } | undefined)?.self_truce_until ?? null;
  const selfAt = activeAt(selfTruce, dbNow);
  if (selfAt) {
    return { purpose: null, reason: 'SELF_TRUCE_ACTIVE', protectedUntil: selfAt };
  }
  return null;
}

/** 两个截止时刻取更晚者（空值穿透） */
function laterOf(a: Date | null, b: Date | null): Date | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return a.getTime() >= b.getTime() ? a : b;
}


/**
 * 截击目标判定（v28，AISLG-78）：目标须存在、仍在存在期内，且 (x, y) 是它路线上
 * 「正在或将要经过」的格（已过去的格拒绝）。到达时是否赶上由 Worker 按到达时刻的位置判定，
 * 发起时不要求赶得上（扑空是正常结果，战报写明）。
 * v35（AISLG-112）：另返回目标进入选定格相邻范围的时间窗（interceptWindow）——发起方据此
 * 把接战时刻顺延为 max(到达时刻, 窗口起点)，提前到达的部队原地埋伏；到达时刻 ≥ 窗口终点
 * （太晚）不做顺延，照旧扑空。目标从当前位置起不会再经过范围时窗口为 null（同样不顺延）。
 */
export async function resolveIntercept(
  client: pg.PoolClient,
  targetId: string,
  x: number,
  y: number,
  dbNow: Date,
): Promise<MarchTargetVerdict> {
  const row = await loadMovingTarget(client, targetId);
  if (!row || row.status !== 'active' || row.ends_at.getTime() <= dbNow.getTime()) {
    return { purpose: null, reason: 'MOVING_TARGET_GONE' };
  }
  const index = rowIndexAt(row, dbNow.getTime()) ?? 0;
  if (routeIndexOfCell(row.route, x, y, index) < 0) {
    return { purpose: null, reason: 'INVALID_PARAMS' };
  }
  const step = rowStepMs(row);
  const startMs = row.started_at.getTime();
  return {
    purpose: 'intercept',
    interceptWindow: reachWindowOf(row.route, x, y, startMs, step, index),
  };
}
