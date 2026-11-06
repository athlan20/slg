// 视野内他人部队上图（AISLG-230，v96）：GET_VISIBLE_MARCHES（op 152）的验收用例。
// 覆盖需求第七节 1–11、14：视野各来源、盟友视野不共享、字段不泄露（含 Agent 账号）、
// 侦察 / 埋伏排除、盲打与撤回、规模边界、关系色（含解除友好冷却期）、来袭 id 匹配、
// 自己的部队不返回、50 支上限、窗口裁剪与迷雾关闭返回空。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { setFogEnabledCache } from '../common/src/fog-config';
import { Op, type InitiatorRole, type TroopKind } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { clearMarchSnapshot } from '../api/src/fog-enemy-marches';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

/** 返回数据里允许出现的键（递归检查用）：位置 / 速度 / 去返程 / 规模 / 主人关系之外一个都不许有 */
const ALLOWED_KEYS = new Set([
  'marches', 'serverTime',
  'id', 'x', 'y', 'vx', 'vy', 'returning', 'scale', 'owner',
  'username', 'allianceName', 'relation',
]);

function collectKeys(value: unknown, out: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, out);
    }
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out.add(key);
    collectKeys(inner, out);
  }
}

describe('视野内他人部队（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  /** 查看者 A / 敌人 B / 盟友 C / 敌对联盟玩家 H / 中立玩家 N / 友盟玩家 F */
  let A: string;
  let B: string;
  let C: string;
  let H: string;
  let N: string;
  let F: string;
  let cityA: string;
  let cityB: string;
  let cityBNearC: string;
  let cityCNear: string;
  let cityHNear: string;
  let cityNNear: string;
  let cityFNear: string;
  /** 出发城坐标：位置全部按「出发城 → 目标格」的线性进度算，所以每个用例要知道出发城在哪 */
  const HOME = new Map<string, { x: number; y: number }>();
  const tag = `fogvm-${Date.now()}`;

  type Frame = { op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string } };
  type March = { id: string; x: number; y: number; vx: number; vy: number; returning: boolean; scale: string; owner: { username: string; allianceName: string | null; relation: string } };

  async function send(account: string, data: Record<string, unknown>, role: InitiatorRole = 'player'): Promise<Frame> {
    const frames: Frame[] = [];
    const registry = {
      send: (_conn: ConnInfo, frame: Frame) => {
        frames.push({ op: frame.op, ok: frame.ok ?? true, data: frame.data, error: frame.error });
      },
      broadcast: () => 0,
    } as unknown as ConnectionRegistry;
    const ctx = { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    const conn = { accountId: account, role } as unknown as ConnInfo;
    await handleMessage(ctx, conn, JSON.stringify({ op: Op.GET_VISIBLE_MARCHES, seq: 1, data }));
    const frame = frames[frames.length - 1];
    assert.equal(frame.ok, true, `请求失败：${frame.error?.code ?? ''}`);
    return frame;
  }

  /** 查窗口内的他人部队（断言帧成功，返回 marches） */
  async function visible(account: string, win: { x: number; y: number; w: number; h: number }, role: InitiatorRole = 'player'): Promise<March[]> {
    const frame = await send(account, win, role);
    assert.equal(typeof frame.data?.serverTime, 'string', 'serverTime 必须给出');
    return (frame.data?.marches ?? []) as March[];
  }

  /** A 的主城视野（12 格）窗口：以 (700,700) 为中心取 20×20 */
  const WIN = { x: 691, y: 691, w: 20, h: 20 };

  interface MarchSpec {
    account: string;
    /** 出发城 id */
    fromCity: string;
    /** 查询时部队应位于的位置（世界格坐标） */
    at: { x: number; y: number };
    /** 目标格：缺省取「出发城关于 at 的镜像」，使进度正好 0.5、位置落在 at */
    to?: { x: number; y: number };
    troops?: Partial<Record<TroopKind, number>>;
    purpose?: string;
    status?: string;
    /** 埋伏时刻（毫秒偏移，负数 = 已经过） */
    ambushInMs?: number;
    fogDenied?: boolean;
    /** 撤回：撤回点与时刻（位置按撤回点 → 出发城的实际回程算） */
    turn?: { x: number; y: number; atMs: number; arriveInMs: number };
  }

  async function addMarch(spec: MarchSpec): Promise<string> {
    const home = HOME.get(spec.account);
    assert.ok(home, `测试没有记录 ${spec.account} 的出发城坐标`);
    const to = spec.to ?? { x: 2 * spec.at.x - home.x, y: 2 * spec.at.y - home.y };
    const startedAt = new Date(Date.now() - 500_000);
    const arriveAt = new Date(Date.now() + 500_000);
    const res = await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, started_at, arrive_at, ambush_at, fog_denied, fog_turn_x, fog_turn_y, fog_turn_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 'player', $8, $9, $10, $11, $12, $13, $14)
       RETURNING id`,
      [
        spec.account,
        spec.fromCity,
        to.x,
        to.y,
        JSON.stringify(spec.troops ?? { militia: 100 }),
        spec.purpose ?? 'plunder',
        spec.status ?? 'marching',
        startedAt.toISOString(),
        spec.turn ? new Date(Date.now() + spec.turn.arriveInMs).toISOString() : arriveAt.toISOString(),
        spec.ambushInMs === undefined ? null : new Date(Date.now() + spec.ambushInMs).toISOString(),
        spec.fogDenied === true,
        spec.turn?.x ?? null,
        spec.turn?.y ?? null,
        spec.turn ? new Date(spec.turn.atMs).toISOString() : null,
      ],
    );
    return res.rows[0].id as string;
  }

  /** 敌人 B 的部队停在 (atX, atY) */
  async function enemyAt(atX: number, atY: number, extra: Partial<MarchSpec> = {}): Promise<string> {
    return addMarch({ account: B, fromCity: cityB, at: { x: atX, y: atY }, ...extra });
  }

  async function tile(x: number, y: number, owner: string | null): Promise<void> {
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'wilderness', 2, $3, NULL)
       ON CONFLICT (x, y) DO UPDATE SET kind = 'wilderness', terrain = 'plain', owner_city_id = EXCLUDED.owner_city_id, npc = NULL`,
      [x, y, owner],
    );
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'fog_visible_marches');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
    const mk = async (name: string) => (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-${name}`])).rows[0].id as string;
    A = await mk('a');
    B = await mk('b');
    C = await mk('c');
    H = await mk('h');
    N = await mk('n');
    F = await mk('f');
    const mkCity = async (account: string, name: string, x: number, y: number) =>
      (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, $2, 0, 0, 0, $3, $4) RETURNING id`, [account, name, x, y])).rows[0].id as string;
    cityA = await mkCity(A, 'A主城', 700, 700);
    await tile(700, 700, cityA);
    // 每个账号的出发城（位置按它算）：B 在主城右边 60 格，其余在 A 视野附近方便布置
    cityB = await mkCity(B, 'B城', 760, 700);
    await mkCity(C, 'C城', 600, 300);
    cityBNearC = await mkCity(B, 'B旁城', 660, 300);
    cityCNear = await mkCity(C, 'C近城', 720, 700);
    cityHNear = await mkCity(H, 'H近城', 680, 700);
    cityNNear = await mkCity(N, 'N近城', 680, 710);
    cityFNear = await mkCity(F, 'F近城', 720, 710);
    HOME.set(A, { x: 700, y: 700 });
    HOME.set(B, { x: 760, y: 700 });
    HOME.set(C, { x: 720, y: 700 });
    HOME.set(H, { x: 680, y: 700 });
    HOME.set(N, { x: 680, y: 710 });
    HOME.set(F, { x: 720, y: 710 });
    // 联盟：A 与 C 同盟；A 的联盟与 F 友盟、与 H 敌对、与 N 刚解除友好（24 小时冷却期内算友盟）
    const allianceOf = async (name: string, leader: string) =>
      (await pool.query(`INSERT INTO alliances (name, leader_id) VALUES ($1, $2) RETURNING id`, [`${tag}-${name}`, leader])).rows[0].id as string;
    const alA = await allianceOf('alA', A);
    const alF = await allianceOf('alF', F);
    const alH = await allianceOf('alH', H);
    const alN = await allianceOf('alN', N);
    await pool.query(`INSERT INTO alliance_members (account_id, alliance_id, role) VALUES ($1, $2, 'leader'), ($3, $2, 'member')`, [A, alA, C]);
    await pool.query(`INSERT INTO alliance_members (account_id, alliance_id, role) VALUES ($1, $2, 'leader'), ($3, $4, 'leader'), ($5, $6, 'leader')`, [F, alF, H, alH, N, alN]);
    const pair = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
    const rel = async (x: string, y: string, relation: string, noAttackUntil: string | null): Promise<void> => {
      const [aId, bId] = pair(x, y);
      await pool.query(`INSERT INTO alliance_relations (a_id, b_id, relation, no_attack_until) VALUES ($1, $2, $3, $4)`, [aId, bId, relation, noAttackUntil]);
    };
    await rel(alA, alF, 'friendly', null);
    await rel(alA, alH, 'hostile', null);
    await rel(alA, alN, 'neutral', new Date(Date.now() + 24 * 3600_000).toISOString());
  });

  after(async () => {
    setFogEnabledCache(null);
    await pool?.end();
    await tmp?.drop();
  });

  beforeEach(async () => {
    setFogEnabledCache(true);
    // 位置快照有 3 秒 TTL：每个用例前清掉，免得看到上一个用例的行军
    clearMarchSnapshot();
    await pool.query(`DELETE FROM marches`);
  });

  test('1 敌方部队进主城视野（12 格）上图，走出视野后下一次查询消失', async () => {
    await enemyAt(705, 700);
    const inside = await visible(A, WIN);
    assert.equal(inside.length, 1);
    assert.equal(inside[0].owner.username, `${tag}-b`);
    assert.ok(Math.abs(inside[0].x - 705) < 0.5, `位置应为 705 附近，实际 ${inside[0].x}`);
    assert.equal(inside[0].returning, false);

    // 走到 18 格（仍在窗口内、视野外）：下一次查询就没有了
    clearMarchSnapshot();
    await pool.query(`DELETE FROM marches`);
    await enemyAt(718, 700);
    assert.deepEqual(await visible(A, WIN), []);
  });

  test('2 视野来源：占领野地 3 格、自己的行军部队 3 格、含斥候部队 5 格都能看到别人', async () => {
    // 占领野地 (720,700)：离主城 20 格，靠它的 3 格视野
    await tile(720, 700, cityA);
    await enemyAt(722, 700);
    assert.equal((await visible(A, { x: 715, y: 695, w: 20, h: 20 })).length, 1, '占领野地 3 格视野');

    // 自己的行军部队在 (740,700)：3 格视野
    clearMarchSnapshot();
    await pool.query(`DELETE FROM marches WHERE account_id <> $1`, [A]);
    await addMarch({ account: A, fromCity: cityA, at: { x: 740, y: 700 } });
    await enemyAt(742, 700);
    assert.equal((await visible(A, { x: 735, y: 695, w: 20, h: 20 })).length, 1, '自己行军部队 3 格视野');

    // 自己的含斥候部队在 (780,700)：侦察科技 0 级 → 5 格视野
    clearMarchSnapshot();
    await pool.query(`DELETE FROM marches WHERE account_id = $1`, [A]);
    await addMarch({ account: A, fromCity: cityA, at: { x: 780, y: 700 }, troops: { scout: 5, militia: 10 } });
    await enemyAt(784, 700);
    assert.equal((await visible(A, { x: 775, y: 695, w: 20, h: 20 })).length, 1, '含斥候部队 5 格视野');

    // 超出 5 格（7 格）就看不到
    clearMarchSnapshot();
    await pool.query(`DELETE FROM marches`);
    await addMarch({ account: A, fromCity: cityA, at: { x: 780, y: 700 }, troops: { scout: 5, militia: 10 } });
    await enemyAt(787, 700);
    assert.deepEqual(await visible(A, { x: 775, y: 695, w: 20, h: 20 }), [], '含斥候 5 格以外的看不到');
  });

  test('3 盟友视野不共享：部队只在盟友 C 的视野里时看不到', async () => {
    // C 的城 (600,300) 视野 12 格；B 的部队在 (604,300)，从 B 在 (660,300) 的城出发
    await addMarch({ account: B, fromCity: cityBNearC, at: { x: 604, y: 300 }, to: { x: 548, y: 300 } });
    assert.deepEqual(await visible(A, { x: 595, y: 295, w: 20, h: 20 }), [], 'A 看不到盟友 C 视野里的部队');
    // 同一支被 C 自己看到（证明它确实在 C 的视野里，只是不共享）
    assert.equal((await visible(C, { x: 595, y: 295, w: 20, h: 20 })).length, 1);
  });

  test('4 返回数据不含出发城 / 目标 / 时刻 / 兵力 / 兵种 / 将领 / 任务类型（Agent 账号同口径）', async () => {
    await enemyAt(705, 700, { troops: { militia: 800, archer: 40 } });
    for (const role of ['player', 'agent'] as InitiatorRole[]) {
      const frame = await send(A, WIN, role);
      const keys = new Set<string>();
      collectKeys(frame.data, keys);
      const bad = [...keys].filter((key) => !ALLOWED_KEYS.has(key));
      assert.deepEqual(bad, [], `${role} 连接返回了不该有的字段：${bad.join(',')}`);
      const marches = (frame.data?.marches ?? []) as March[];
      assert.equal(marches.length, 1);
      assert.equal(marches[0].scale, 'medium');
    }
  });

  test('5 侦察部队（去程 / 只有斥候的返程）与已过 ambushAt 的埋伏不上图', async () => {
    await enemyAt(704, 700, { purpose: 'scout', troops: { scout: 5 } });
    await enemyAt(706, 700, { purpose: 'return', troops: { scout: 5 } });
    // 埋伏时刻已过：位置停在目标格（708）本来就在视野里，仍应不上图
    await enemyAt(708, 700, { purpose: 'intercept', troops: { cavalry: 300 }, ambushInMs: -60_000, to: { x: 708, y: 700 } });
    assert.deepEqual(await visible(A, WIN), [], '侦察 / 纯斥候返程 / 已到位埋伏都不上图');

    // 埋伏还没开始（ambushAt 在未来）→ 正常上图；带兵器的返程 → 上图且 returning = true
    clearMarchSnapshot();
    await pool.query(`DELETE FROM marches`);
    // 埋伏时刻与到达时刻都在未来（进度 0.5，位置落在 704），正常上图
    await enemyAt(704, 700, { purpose: 'intercept', troops: { cavalry: 300 }, ambushInMs: 500_000 });
    await enemyAt(706, 700, { purpose: 'return', troops: { scout: 5, militia: 100 } });
    const shown = await visible(A, WIN);
    assert.equal(shown.length, 2);
    assert.equal(shown.filter((march) => march.returning).length, 1);
  });

  test('6 盲打（fog_denied）上图；撤回中的部队按实际回程位置算', async () => {
    await enemyAt(705, 700, { fogDenied: true });
    assert.equal((await visible(A, WIN)).length, 1, '盲打部队正常上图');

    // 撤回：B 的城 (760,700)，撤回点 (690,700)，回程走了一半 → 位置 725（视野内、窗口中）
    clearMarchSnapshot();
    await pool.query(`DELETE FROM marches`);
    await addMarch({
      account: B,
      fromCity: cityB,
      at: { x: 600, y: 700 },
      purpose: 'return',
      turn: { x: 660, y: 700, atMs: Date.now() - 500_000, arriveInMs: 500_000 },
    });
    const back = await visible(A, { x: 705, y: 695, w: 20, h: 20 });
    assert.equal(back.length, 1);
    assert.equal(back[0].returning, true);
    assert.ok(Math.abs(back[0].x - 710) < 0.5, `撤回位置应按实际回程算（710 附近），实际 ${back[0].x}`);
    assert.ok(back[0].vx > 0, '回程朝出发城，方向向右（vx > 0）');
  });

  test('7 规模边界：499 小股、500 与 4 999 中军、5 000 大军', async () => {
    await enemyAt(703, 700, { troops: { militia: 499 } });
    await enemyAt(705, 700, { troops: { militia: 500 } });
    await enemyAt(707, 700, { troops: { militia: 4_999 } });
    await enemyAt(709, 700, { troops: { militia: 5_000 } });
    const byX = new Map((await visible(A, WIN)).map((march) => [Math.round(march.x), march.scale]));
    assert.equal(byX.get(703), 'small');
    assert.equal(byX.get(705), 'medium');
    assert.equal(byX.get(707), 'medium');
    assert.equal(byX.get(709), 'large');
  });

  test('8 关系：同盟 / 友盟 / 解除友好冷却期 / 敌对 / 中立', async () => {
    await addMarch({ account: C, fromCity: cityCNear, at: { x: 702, y: 700 } });
    await addMarch({ account: F, fromCity: cityFNear, at: { x: 704, y: 700 } });
    await addMarch({ account: H, fromCity: cityHNear, at: { x: 706, y: 700 } });
    await addMarch({ account: N, fromCity: cityNNear, at: { x: 708, y: 700 } });
    await enemyAt(710, 700);
    const shown = await visible(A, WIN);
    const relationAt = new Map(shown.map((march) => [Math.round(march.x), march.owner.relation]));
    assert.equal(relationAt.get(702), 'ally', '同盟');
    assert.equal(relationAt.get(704), 'friendly', '友盟');
    assert.equal(relationAt.get(706), 'hostile', '敌对');
    assert.equal(relationAt.get(708), 'friendly', '解除友好的 24 小时冷却期内算友盟');
    assert.equal(relationAt.get(710), 'neutral', '中立');
    assert.equal(shown.find((march) => Math.round(march.x) === 710)?.owner.allianceName, null, '无联盟时为 null');
    assert.equal(shown.find((march) => Math.round(march.x) === 702)?.owner.allianceName, `${tag}-alA`);
  });

  test('9 来袭自己的部队：id 与来袭预警的 marchId 一致（界面据此转红并连线）', async () => {
    const marchId = await enemyAt(705, 700);
    await pool.query(
      `INSERT INTO events (account_id, city_id, build_id, type, detail) VALUES ($1, $2, $3, 'player_attack_warning', $4::jsonb)`,
      [A, cityA, marchId, JSON.stringify({ x: 700, y: 700, marchId, arriveAt: new Date(Date.now() + 600_000).toISOString() })],
    );
    const warning = await pool.query(`SELECT detail->>'marchId' AS march_id FROM events WHERE account_id = $1 AND type = 'player_attack_warning'`, [A]);
    const shown = await visible(A, WIN);
    assert.equal(shown.length, 1);
    assert.equal(shown[0].id, warning.rows[0].march_id, 'id 必须与预警的 marchId 对得上');
  });

  test('10 自己的部队不从本接口返回', async () => {
    await addMarch({ account: A, fromCity: cityA, at: { x: 704, y: 700 } });
    assert.deepEqual(await visible(A, WIN), []);
    // 同一位置换成 B 的部队就能看到（说明窗口与视野判定本身没问题）
    clearMarchSnapshot();
    await pool.query(`DELETE FROM marches`);
    await enemyAt(704, 700);
    assert.equal((await visible(A, WIN)).length, 1);
  });

  test('11 超过 50 支时只返回离窗口中心最近的 50 支', async () => {
    // 窗口中心是 (698,698)：40 支就停在中心附近，20 支在更远的 (688,688)
    const near: string[] = [];
    const far: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      near.push(await addMarch({ account: B, fromCity: cityB, at: { x: 698, y: 698 } }));
    }
    for (let i = 0; i < 20; i += 1) {
      far.push(await addMarch({ account: B, fromCity: cityB, at: { x: 688, y: 688 } }));
    }
    const shown = await visible(A, { x: 688, y: 688, w: 20, h: 20 });
    assert.equal(shown.length, 50, '单窗口最多 50 支');
    const ids = new Set(shown.map((march) => march.id));
    assert.equal(near.filter((id) => ids.has(id)).length, 40, '近的 40 支全部返回');
    assert.equal(far.filter((id) => ids.has(id)).length, 10, '远的 20 支只返回 10 支（凑满 50）');
  });

  test('12 窗口裁剪：窗口外的部队不返回；已到达（status 非 marching）的部队不返回', async () => {
    await enemyAt(704, 700);
    await enemyAt(706, 701, { status: 'arrived' });
    // (704,700) 在 A 的视野里，但请求窗口只覆盖 y ≥ 705
    assert.deepEqual(await visible(A, { x: 700, y: 705, w: 20, h: 20 }), []);
    const shown = await visible(A, WIN);
    assert.equal(shown.length, 1, '只有行军中（marching）的那支');
    assert.ok(Math.abs(shown[0].x - 704) < 0.5);
  });

  test('14 fog_enabled 关闭时返回空数组，且不碰任何迷雾表', async () => {
    await enemyAt(704, 700);
    const fresh = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-off`])).rows[0].id as string;
    await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, 'OFF主城', 0, 0, 0, 700, 700)`, [fresh]);
    setFogEnabledCache(false);
    const frame = await send(fresh, WIN);
    assert.deepEqual(frame.data?.marches, []);
    assert.equal(typeof frame.data?.serverTime, 'string');
    const fogRows = await pool.query(`SELECT count(*)::int AS n FROM fog_explored WHERE account_id = $1`, [fresh]);
    assert.equal(fogRows.rows[0].n, 0, '关闭时不写探索位图');
    const seenRows = await pool.query(`SELECT count(*)::int AS n FROM fog_seen WHERE account_id = $1`, [fresh]);
    assert.equal(seenRows.rows[0].n, 0, '关闭时不写上次看到的快照');
  });
});
