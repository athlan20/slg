// 武将的数据库存取（v36，AISLG-114/115/116）：API（查询 / 招募 / 解雇 / 城守 / 出征校验）
// 与 Worker（俸禄 / 战斗加成与经验 / 名将授予）共用。酒馆候选按 refreshed_at 惰性刷新
// （读取时过期才重摇，无后台任务）；名将全服唯一靠 famous_heroes.name 主键 + ON CONFLICT。

import pg from 'pg';
import { scaledMs, scaledRate } from './time-scale';
import {
  ALL_FAMOUS_HEROES,
  HERO_LEVEL_MAX,
  expForNextLevel,
  applyHeroExp,
  attrGainPerLevel,
  famousSourceKey,
  famousSourceLabel,
  heroBattleBonus,
  guardProductionPercent,
  normalHeroCap,
  recruitCost,
  rollFamousAttrs,
  rollNormalHero,
  salaryPerHour,
  TAVERN_CANDIDATE_COUNT,
  TAVERN_REFRESH_HOURS,
  FAMOUS_HERO_CAP,
  type FamousHeroDef,
  type HeroBattleBonus,
} from './hero';
import type {
  FamousClaimView,
  HeroCandidateView,
  HeroView,
} from './protocol-hero';

type Queryable = pg.Pool | pg.PoolClient;
type Writer = pg.PoolClient;

/** account_heroes 行 */
export interface AccountHeroRow {
  id: string;
  account_id: string;
  name: string;
  famous: boolean;
  lead: number;
  force: number;
  wit: number;
  level: number;
  exp: number;
  arrears: boolean;
  salary_at: Date;
  wounded_until: Date | null;
  created_at: Date;
}

/** 武将的三项属性（规则函数入参形态） */
export function heroAttrs(row: AccountHeroRow) {
  return { lead: row.lead, force: row.force, wit: row.wit };
}

/** 行 → 视图（guardCityId / marchingMarchId 由调用方从占用关系查出后传入） */
export function heroView(row: AccountHeroRow, guardCityId: string | null, marchingMarchId: string | null): HeroView {
  const attrs = heroAttrs(row);
  const bonus = heroBattleBonus(attrs);
  return {
    id: row.id,
    name: row.name,
    famous: row.famous,
    lead: row.lead,
    force: row.force,
    wit: row.wit,
    level: row.level,
    exp: row.exp,
    expNext: row.level >= HERO_LEVEL_MAX ? 0 : expForNextLevel(row.level) - row.exp,
    salaryPerHour: scaledRate(salaryPerHour(row.level, row.famous)),
    arrears: row.arrears,
    woundedUntil: row.wounded_until ? row.wounded_until.toISOString() : null,
    guardCityId,
    marchingMarchId,
    bonus: { atkPercent: bonus.atkPercent, defPercent: bonus.defPercent, leadCap: bonus.leadCap },
    guardProductionPercent: guardProductionPercent(row.wit),
  };
}

/** 账号全部武将（按获得先后） */
export async function loadHeroes(q: Queryable, accountId: string): Promise<AccountHeroRow[]> {
  const res = await q.query(`SELECT * FROM account_heroes WHERE account_id = $1 ORDER BY created_at, id`, [accountId]);
  return res.rows as AccountHeroRow[];
}

export async function loadHero(q: Queryable, heroId: string, forUpdate = false): Promise<AccountHeroRow | null> {
  const res = await q.query(`SELECT * FROM account_heroes WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [heroId]);
  return res.rowCount ? (res.rows[0] as AccountHeroRow) : null;
}

/** 随行占用：hero_id → 行军 id（status='marching'，含返程；行军结束自然释放） */
export async function heroBusyMarchMap(q: Queryable, accountId: string): Promise<Map<string, string>> {
  const res = await q.query(
    `SELECT id, hero_id FROM marches WHERE account_id = $1 AND status = 'marching' AND hero_id IS NOT NULL`,
    [accountId],
  );
  const map = new Map<string, string>();
  for (const row of res.rows as Array<{ id: string; hero_id: string }>) {
    map.set(row.hero_id, row.id);
  }
  return map;
}

/** 城守占用：hero_id → 城名 id 与 城名 id → hero_id 双向视图 */
export async function heroGuardMaps(
  q: Queryable,
  accountId: string,
): Promise<{ heroToCity: Map<string, string>; cityToHero: Map<string, string> }> {
  const res = await q.query(`SELECT id, guard_hero_id FROM cities WHERE account_id = $1 AND guard_hero_id IS NOT NULL`, [
    accountId,
  ]);
  const heroToCity = new Map<string, string>();
  const cityToHero = new Map<string, string>();
  for (const row of res.rows as Array<{ id: string; guard_hero_id: string }>) {
    heroToCity.set(row.guard_hero_id, row.id);
    cityToHero.set(row.id, row.guard_hero_id);
  }
  return { heroToCity, cityToHero };
}

/** 酒馆候选刷新周期（毫秒，已按时间缩放折算） */
export function tavernRefreshMs(): number {
  return scaledMs(TAVERN_REFRESH_HOURS * 3_600_000);
}

/**
 * 某座城的酒馆候选（惰性刷新）：候选不存在或已过期（refreshed_at + 4 小时基准 ≤ now）
 * 时重摇一批（3 名），同一事务内 DELETE + INSERT。未建酒馆的城返回空数组（不落库）。
 */
export async function loadTavernCandidates(
  client: Writer,
  cityId: string,
  tavernLevel: number,
): Promise<HeroCandidateView[]> {
  if (tavernLevel <= 0) {
    return [];
  }
  const refreshMs = tavernRefreshMs();
  const res = await client.query(
    `SELECT * FROM tavern_candidates WHERE city_id = $1 AND refreshed_at > now() - make_interval(secs => $2) ORDER BY id`,
    [cityId, refreshMs / 1000],
  );
  if (res.rowCount === TAVERN_CANDIDATE_COUNT) {
    return (res.rows as TavernCandidateRow[]).map((row) => candidateView(row));
  }
  // 过期或缺失：重摇一批（招募中的旧候选随批失效——招募按 id 原子扣减，不会重复买到）
  await client.query(`DELETE FROM tavern_candidates WHERE city_id = $1`, [cityId]);
  const batch = Array.from({ length: TAVERN_CANDIDATE_COUNT }, () => rollNormalHero(Math.random));
  const ins = await client.query(
    `INSERT INTO tavern_candidates (city_id, name, lead, force, wit)
     SELECT $1, n, l, f, w FROM unnest($2::text[], $3::int[], $4::int[], $5::int[]) AS t(n, l, f, w)
     RETURNING id, name, lead, force, wit, refreshed_at`,
    [cityId, batch.map((h) => h.name), batch.map((h) => h.lead), batch.map((h) => h.force), batch.map((h) => h.wit)],
  );
  // 与读取分支同序（ORDER BY id），首次刷新与后续读取返回顺序一致
  return (ins.rows as TavernCandidateRow[]).sort((a, b) => (a.id < b.id ? -1 : 1)).map((row) => candidateView(row));
}

interface TavernCandidateRow {
  id: string;
  city_id: string;
  name: string;
  lead: number;
  force: number;
  wit: number;
  refreshed_at: Date;
}

function candidateView(row: TavernCandidateRow): HeroCandidateView {
  return {
    id: row.id,
    name: row.name,
    lead: row.lead,
    force: row.force,
    wit: row.wit,
    cost: recruitCost({ lead: row.lead, force: row.force, wit: row.wit }),
    refreshedAt: row.refreshed_at.toISOString(),
  };
}

/** 新建武将（招募 / 名将授予共用） */
export async function insertHero(
  client: Writer,
  accountId: string,
  hero: { name: string; famous: boolean; lead: number; force: number; wit: number },
): Promise<AccountHeroRow> {
  const ins = await client.query(
    `INSERT INTO account_heroes (account_id, name, famous, lead, force, wit)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [accountId, hero.name, hero.famous, hero.lead, hero.force, hero.wit],
  );
  return ins.rows[0] as AccountHeroRow;
}

/** 解雇：直接删除（名将的 famous_heroes 归属行随外键级联删除 → 名将回到可获得状态） */
export async function deleteHero(client: Writer, heroId: string): Promise<void> {
  await client.query(`DELETE FROM account_heroes WHERE id = $1`, [heroId]);
}

/**
 * 授予名将（v36，AISLG-115）：全服唯一——famous_heroes.name 主键 + ON CONFLICT DO NOTHING；
 * 已被他人获得（或本账号名将 ≥ 3 名）返回 null，不产生副作用。成功返回新武将行。
 */
export async function grantFamousHero(
  client: Writer,
  accountId: string,
  def: FamousHeroDef,
): Promise<AccountHeroRow | null> {
  const count = await client.query(
    `SELECT count(*)::int AS n FROM account_heroes WHERE account_id = $1 AND famous`,
    [accountId],
  );
  if ((count.rows[0] as { n: number }).n >= FAMOUS_HERO_CAP) {
    return null;
  }
  const attrs = rollFamousAttrs(Math.random);
  const hero = await insertHero(client, accountId, { name: def.name, famous: true, ...attrs });
  const claim = await client.query(
    `INSERT INTO famous_heroes (name, source, hero_id, owner_account_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING RETURNING name`,
    [def.name, famousSourceKey(def.source), hero.id, accountId],
  );
  if (!claim.rowCount) {
    await deleteHero(client, hero.id);
    return null;
  }
  return hero;
}

/** 全部名将的归属视图（未被获得的也列出，ownerUsername 为 null） */
export async function loadFamousClaims(q: Queryable): Promise<FamousClaimView[]> {
  const res = await q.query(
    `SELECT f.name, f.source, f.granted_at, a.username
     FROM famous_heroes f JOIN accounts a ON a.id = f.owner_account_id`,
  );
  const owned = new Map(
    (res.rows as Array<{ name: string; source: string; granted_at: Date; username: string }>).map((row) => [
      row.name,
      row,
    ]),
  );
  return ALL_FAMOUS_HEROES.map((def) => {
    const claim = owned.get(def.name);
    return {
      name: def.name,
      sourceLabel: famousSourceLabel(def.source),
      ownerUsername: claim?.username ?? null,
      grantedAt: claim ? claim.granted_at.toISOString() : null,
    };
  });
}

/** 某座城的城守（未任命返回 null） */
export async function loadCityGuard(q: Queryable, cityId: string): Promise<AccountHeroRow | null> {
  const res = await q.query(
    `SELECT h.* FROM cities c JOIN account_heroes h ON h.id = c.guard_hero_id WHERE c.id = $1`,
    [cityId],
  );
  return res.rowCount ? (res.rows[0] as AccountHeroRow) : null;
}

/** 任命 / 撤换城守：先清该武将原有的城守（一名武将至多守一城），heroId=null 撤任 */
export async function assignCityGuard(client: Writer, cityId: string, heroId: string | null): Promise<void> {
  if (heroId) {
    await client.query(`UPDATE cities SET guard_hero_id = NULL WHERE guard_hero_id = $1`, [heroId]);
  }
  await client.query(`UPDATE cities SET guard_hero_id = $2 WHERE id = $1`, [cityId, heroId]);
}

/** 战斗加成（Worker 结算用）：武将行 + 部队规模 → 引擎可用的加成；无武将为 null */
export function battleBonusOf(row: AccountHeroRow | null, troopCount: number): HeroBattleBonus | null {
  if (!row) {
    return null;
  }
  return heroBattleBonus(heroAttrs(row), troopCount);
}

/** 战后经验与成长（v36，AISLG-116）：升级时三项属性自动成长（普通将 +1 / 名将 +2 每级） */
export async function grantHeroExp(
  client: Writer,
  heroId: string,
  gained: number,
): Promise<{ level: number; leveledTo: number | null; levelsGained: number } | null> {
  const res = await client.query(`UPDATE account_heroes SET exp = exp + $2 WHERE id = $1 RETURNING *`, [
    heroId,
    Math.max(0, Math.floor(gained)),
  ]);
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as AccountHeroRow;
  const result = applyHeroExp(row.level, row.exp, 0, row.famous);
  if (result.leveledTo === null) {
    return { level: row.level, leveledTo: null, levelsGained: 0 };
  }
  const gain = result.levelsGained * attrGainPerLevel(row.famous);
  await client.query(
    `UPDATE account_heroes SET level = $2, exp = $3, lead = lead + $4, force = force + $4, wit = wit + $4
     WHERE id = $1`,
    [heroId, result.level, result.exp, gain],
  );
  return { level: result.level, leveledTo: result.leveledTo, levelsGained: result.levelsGained };
}

/** 带队战败 → 重伤至 until（v36，AISLG-114；不会死亡） */
export async function woundHero(client: Writer, heroId: string, until: Date): Promise<void> {
  await client.query(`UPDATE account_heroes SET wounded_until = $2 WHERE id = $1`, [heroId, until]);
}

/** 普通将上限相关：账号所有城中酒馆的最高等级 */
export async function maxTavernLevel(q: Queryable, accountId: string): Promise<number> {
  const res = await q.query(
    `SELECT coalesce(max(b.level), 0)::int AS lv FROM city_buildings b
     JOIN cities c ON c.id = b.city_id WHERE c.account_id = $1 AND b.kind = 'tavern'`,
    [accountId],
  );
  return (res.rows[0] as { lv: number }).lv;
}

/** 普通将 / 名将数量、上限与酒馆最高等级（招募校验与视图共用） */
export async function heroCounts(
  q: Queryable,
  accountId: string,
): Promise<{
  normalCount: number;
  famousCount: number;
  normalCap: number;
  famousCap: number;
  maxTavernLevel: number;
}> {
  const res = await q.query(
    `SELECT count(*) FILTER (WHERE NOT famous)::int AS normal_count,
            count(*) FILTER (WHERE famous)::int AS famous_count
     FROM account_heroes WHERE account_id = $1`,
    [accountId],
  );
  const row = res.rows[0] as { normal_count: number; famous_count: number };
  const maxTavern = await maxTavernLevel(q, accountId);
  return {
    normalCount: row.normal_count,
    famousCount: row.famous_count,
    normalCap: normalHeroCap(maxTavern),
    famousCap: FAMOUS_HERO_CAP,
    maxTavernLevel: maxTavern,
  };
}
