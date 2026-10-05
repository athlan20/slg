// v12/v13 世界与战斗玩法冒烟（独立脚本，可在真实栈上单独运行）：
//   npx tsx --env-file=.env scripts/smoke-world.ts
// 覆盖：世界生成与主城坐标、地图窗口/地块详情、出征限制、军营征兵 → 出征占领野地
// （task=occupy，多回合战斗 / 加成 / 驻军 / 战报）、v16 掠夺（缺省 task、负重回携、
// 冷却复核与 PLUNDER_COOLDOWN）、v16 占领上限（TERRITORY_LIMIT）、legacy 在途
// purpose='attack' 行军的 v15 结算路径（金币战利品 + 占领）、v13 调兵（transfer：
// legacy attack 占领 NPC 城形成分城 → 主城调兵并入分城驻军）、行军途中撤回（v13）、
// NPC 袭击清占领、召回返程、斥候侦察与 NPC 城池情报门控（v13）、NPC 城仅掠夺
// （task=occupy 被拒 TASK_INVALID_FOR_TARGET）与战败、RESET 清理。
// 前置：API（建议 BUILD_SECONDS=2 RECRUIT_UNIT_SECONDS=1 MARCH_SECONDS_PER_TILE=2）与
// Worker 已启动；NPC 袭击步骤由本脚本临时拉起一个 NPC_RAID_INTERVAL_MS 很小的 Worker
// 触发，结束后关闭。WS_URL 指向被测 API（默认 ws://127.0.0.1:8080/ws）。legacy 在途
// 行军由本脚本直连数据库插入（复现升级前已发出的 v15 请求）。

import { spawn } from 'node:child_process';
import path from 'node:path';
import { Op, type TerrainKind } from '../common/src/protocol';
import { PLUNDER_POOL_GOLD_PER_LEVEL, PLUNDER_POOL_RESOURCE_PER_LEVEL, TERRAIN_INFO, wildernessBonusRate } from '../common/src/world';
import { createPool } from '../common/src/db';
import { Client, check, dataOf, step } from './smoke-client';
import { fetchWindow, findFreeLevel1, prepareMilitia, prepareScouts, waitMarchOutcome, waitUntil, type TileLite } from './smoke-world-utils';

const password = 'smoke-pass-123';

async function main(): Promise<void> {
  const suffix = Date.now();
  const playerA = await Client.connect();
  const loginA = await playerA.request(Op.LOGIN, { username: `smoke_world_a_${suffix}`, password, asAgent: false });
  check(loginA.ok === true, '账号 A 注册登录成功');
  const usernameA = (dataOf(loginA) as { username: string }).username;
  const accountIdA = (dataOf(loginA) as { accountId: string }).accountId;

  step('v12 世界与主城坐标：注册即分配地块，状态带行军与领地字段');
  {
    const state = await playerA.request(Op.GET_STATE);
    check(state.ok === true, 'GET_STATE 成功');
    const data = dataOf(state) as unknown as {
      city: { marches: unknown[]; territory: unknown[] };
      cities: Array<{ x: number | null; y: number | null; isMain: boolean }>;
    };
    check(Array.isArray(data.city.marches) && Array.isArray(data.city.territory), 'city.marches / city.territory 字段存在');
    const main = data.cities.find((city) => city.isMain);
    check(main !== undefined && main.x !== null && main.y !== null, `主城分配到地块 (${main?.x},${main?.y})`);
  }

  step('v12 地图窗口与地块详情');
  const targetA = await findFreeLevel1(playerA);
  {
    const detail = await playerA.request(Op.GET_TILE, { x: targetA.x, y: targetA.y });
    check(detail.ok === true, 'GET_TILE 成功');
    const tile = (dataOf(detail).tile ?? {}) as {
      nativePower: number;
      wilderness: { bonusRate: number; resource: string } | null;
      garrison: number;
    };
    check(tile.nativePower === 30, '1 级野地原住守军战力 = 30（等级 × 30）');
    check(
      tile.wilderness !== null && tile.wilderness.bonusRate === wildernessBonusRate(targetA.terrain, 1),
      '野地收益预览按地形每级加成',
    );
    check(tile.garrison === 0, '无主野地无驻军');
  }

  step('v12 出征限制：玩家城池不可作为目标，兵力不足被拒');
  {
    const state = await playerA.request(Op.GET_STATE);
    const cities = (dataOf(state).cities ?? []) as Array<{ x: number; y: number }>;
    const ownCity = cities[0];
    // 并发修复后的口径：自己的城（含出发主城）不可出征 → TARGET_NOT_ATTACKABLE
    const denied = await playerA.request(Op.MARCH, { x: ownCity.x, y: ownCity.y, troops: { militia: 1 } });
    check(denied.ok === false && denied.error?.code === 'TARGET_NOT_ATTACKABLE', '出征自己的出发主城被拒（TARGET_NOT_ATTACKABLE）');
    const noTroops = await playerA.request(Op.MARCH, { x: targetA.x, y: targetA.y, troops: { militia: 5 } });
    check(noTroops.ok === false && noTroops.error?.code === 'INSUFFICIENT_TROOPS', '城内无兵被拒（INSUFFICIENT_TROOPS）');
  }

  step('v12 军营与征兵（20 义兵，环境变量缩短时长）');
  await prepareMilitia(playerA, 20);

  step('v16 占领野地（task=occupy）：多回合战斗、驻军与持续加成，无一次性战利品');
  let sinceA = 0;
  {
    const before = (dataOf(await playerA.request(Op.GET_STATE)).city ?? {}) as {
      resources: Record<string, number>;
      production: Record<string, number>;
    };
    const march = await playerA.request(Op.MARCH, { x: targetA.x, y: targetA.y, troops: { militia: 20 }, task: 'occupy' });
    check(march.ok === true, '占领出征受理（task=occupy）');
    const marchData = (dataOf(march).march ?? {}) as { arriveAt: string; status: string; purpose: string };
    check(marchData.status === 'marching' && marchData.purpose === 'occupy', '行军进行中且 purpose=occupy');
    const travelMs = Math.max(0, Date.parse(marchData.arriveAt) - Date.now());
    await playerA.waitPush(Op.PUSH_MARCH_STATE, travelMs + 30_000, (data) => data.reason === 'march_arrived');
    console.log('  ✓ 行军到达并结算（march_arrived 推送）');

    const after = (dataOf(await playerA.request(Op.GET_STATE)).city ?? {}) as {
      resources: Record<string, number>;
      production: Record<string, number>;
      territory: Array<{ x: number; y: number; terrain: TerrainKind; bonusRate: number; resource: string; garrison: number }>;
      army: Record<string, number>;
    };
    check(after.army.militia === 0, '出征部队已离开城内驻军');
    const held = after.territory.find((tile) => tile.x === targetA.x && tile.y === targetA.y);
    if (!held) {
      throw new Error('断言失败：领地列表未包含目标地块');
    }
    console.log(`  ✓ 领地列表包含 (${targetA.x},${targetA.y})`);
    check(held.bonusRate === wildernessBonusRate(held.terrain, 1), '占领加成按 基线 + 等级 × 每级增量 计入（v21）');
    check(after.production[held.resource] >= before.production[held.resource] + held.bonusRate, '城池产量已计入野地加成');
    check(
      after.resources.gold - before.resources.gold < 100,
      `占领无一次性金币战利品（差值 ${after.resources.gold - before.resources.gold}，仅为产金）`,
    );

    const detail = await playerA.request(Op.GET_TILE, { x: targetA.x, y: targetA.y });
    const tile = (dataOf(detail).tile ?? {}) as { owner: { username: string } | null; garrison: number; garrisonDetail: Record<string, number>; plunderedAt: string | null };
    check(tile.owner?.username === usernameA, `地块占领者显示为 ${usernameA}`);
    check(
      tile.garrison >= 1 && (tile.garrisonDetail.militia ?? 0) >= 1,
      `幸存部队转为驻军（多回合战斗折损后 ${tile.garrison} 人，定性断言）`,
    );
    check(tile.plunderedAt === null, '占领不触发掠夺冷却（plunderedAt=null）');

    // v13 战报：战斗生成攻方视角战报，可查询
    const reportsRes = await playerA.request(Op.GET_BATTLE_REPORTS, { limit: 5 });
    check(reportsRes.ok === true, 'GET_BATTLE_REPORTS 成功');
    const reports = (dataOf(reportsRes).reports ?? []) as Array<{
      id: number; kind: string; role: string; won: boolean; rounds: number;
      roundLog: Array<{ attackerDamage: number }>;
    }>;
    const battleReport = reports.find((r) => r.kind === 'wilderness');
    check(battleReport !== undefined, '战报列表包含本场野地战斗');
    if (battleReport) {
      check(battleReport.role === 'attacker' && battleReport.won === true, '战报为攻方视角且判胜');
      check(battleReport.rounds >= 1 && battleReport.roundLog.length >= 1, `战报含回合统计（${battleReport.rounds} 回合）`);
    }

    const events = await playerA.request(Op.GET_EVENTS, { limit: 20 });
    const list = (dataOf(events).events ?? []) as Array<{ id: number; type: string }>;
    sinceA = list.reduce((max, event) => Math.max(max, event.id), 0);
    check(list.some((event) => event.type === 'wilderness_occupied'), '事件流记录 wilderness_occupied');
  }

  step('v16 掠夺野地（缺省 task=plunder）：负重回携、不改归属、24 小时冷却');
  const usedTiles: Array<{ x: number; y: number }> = [{ x: targetA.x, y: targetA.y }];
  {
    await prepareMilitia(playerA, 30);
    const targetC = await findFreeLevel1(playerA, usedTiles);
    usedTiles.push({ x: targetC.x, y: targetC.y });
    const before = (dataOf(await playerA.request(Op.GET_STATE)).city ?? {}) as {
      resources: Record<string, number>;
      territory: Array<{ x: number; y: number }>;
    };
    // 不带 task：缺省掠夺（对 v15 客户端是破坏性变更的语义点）
    const march = await playerA.request(Op.MARCH, { x: targetC.x, y: targetC.y, troops: { militia: 20 } });
    check(march.ok === true, '掠夺出征受理（不带 task，缺省 plunder）');
    const marchData = (dataOf(march).march ?? {}) as { purpose: string; arriveAt: string };
    check(marchData.purpose === 'plunder', '行军 purpose=plunder');
    const outcome = await waitMarchOutcome(playerA, sinceA, Math.max(0, Date.parse(marchData.arriveAt) - Date.now()) + 30_000);
    check(outcome.outcome === 'plunder_won', '事件 outcome=plunder_won');
    const loot = (outcome.detail.loot ?? {}) as Record<string, number>;
    const terrainResource = TERRAIN_INFO[targetC.terrain].resource;
    const carry = outcome.detail.carry as number;
    // v21：池 = 地形资源 750×等级 + 金 250×等级，装填顺序 金→粮→木→石→铁（Lv1 地块）
    const expectedGold = Math.min(carry, PLUNDER_POOL_GOLD_PER_LEVEL);
    const expectedResource = Math.min(carry - expectedGold, PLUNDER_POOL_RESOURCE_PER_LEVEL);
    check(
      loot.gold === expectedGold && loot[terrainResource] === expectedResource,
      `战利品按 金→粮→木→石→铁 装填（实际 金 ${loot.gold ?? 0}、${terrainResource} ${loot[terrainResource] ?? 0}，carry ${carry}，池 ${PLUNDER_POOL_GOLD_PER_LEVEL}金 + ${PLUNDER_POOL_RESOURCE_PER_LEVEL}${terrainResource}）`,
    );
    check(typeof outcome.detail.carry === 'number' && carry > 0, '事件含幸存部队负重 carry');
    check(typeof outcome.detail.returning === 'string', '事件含返程行军 id（幸存部队返程）');

    const after = (dataOf(await playerA.request(Op.GET_STATE)).city ?? {}) as {
      resources: Record<string, number>;
      territory: Array<{ x: number; y: number }>;
      army: Record<string, number>;
    };
    check(
      after.resources[terrainResource] - before.resources[terrainResource] >= expectedResource,
      `掠夺所得已入账（${terrainResource} +${after.resources[terrainResource] - before.resources[terrainResource]}，金 +${after.resources.gold - before.resources.gold}）`,
    );
    check(!after.territory.some((tile) => tile.x === targetC.x && tile.y === targetC.y), '掠夺不改归属（领地数量不变）');

    const detail = (dataOf(await playerA.request(Op.GET_TILE, { x: targetC.x, y: targetC.y })).tile ?? {}) as {
      owner: unknown;
      plunderedAt: string | null;
    };
    check(detail.owner === null, '地块保持无主');
    check(detail.plunderedAt !== null, 'GET_TILE 下发掠夺冷却时间（plunderedAt 非空）');

    // 冷却复核：24 小时内再次掠夺被拒（PLUNDER_COOLDOWN）
    const denied = await playerA.request(Op.MARCH, { x: targetC.x, y: targetC.y, troops: { militia: 5 } });
    check(denied.ok === false && denied.error?.code === 'PLUNDER_COOLDOWN', '冷却内再次掠夺被拒（PLUNDER_COOLDOWN）');

    // 幸存部队返程回城。返程行军由结算方 Worker 创建：共享库上可能有未带缩短时长
    // 环境变量的他方 Worker（默认 15 秒/格）抢到结算，返程可达 75 秒，故取 120 秒
    // （与下方账号 B 召回步骤的超时口径一致）
    await playerA.waitPush(Op.PUSH_MARCH_STATE, 120_000, (data) => data.reason === 'march_returned');
    const armyAfter = ((dataOf(await playerA.request(Op.GET_STATE)).city ?? {}) as { army: Record<string, number> }).army;
    check(armyAfter.militia >= 1, `掠夺幸存部队已返程回城（${armyAfter.militia} 人，定性断言）`);
    const eventsNow = await playerA.request(Op.GET_EVENTS, { limit: 5 });
    sinceA = ((dataOf(eventsNow).events ?? []) as Array<{ id: number }>).reduce((max, event) => Math.max(max, event.id), 0);
  }

  step('v16 占领上限：官府 Lv1 → 第二块占领被拒（TERRITORY_LIMIT）');
  {
    // 前置自愈（共享库）：他方 Worker 的周期 NPC 袭击可能在本步骤前清掉第一块占领
    // （全局占领稀少时必中本脚本的 tile）。被清掉时用 legacy 直插 attack 行军重新
    // 占领一块（DB 直插编队不占城内兵力与人口），保证上限断言的前置成立
    const territoryNow = ((dataOf(await playerA.request(Op.GET_STATE)).city ?? {}) as { territory: unknown[] }).territory;
    if (territoryNow.length === 0) {
      const state = dataOf(await playerA.request(Op.GET_STATE)) as { city: { id: string } };
      const pool = createPool('smoke-world-territory');
      try {
        await pool.query(
          `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, 'attack', 'marching', 'player', now() + make_interval(secs => 3))`,
          [accountIdA, state.city.id, targetA.x, targetA.y, JSON.stringify({ militia: 60 })],
        );
      } finally {
        await pool.end();
      }
      await waitUntil('环境袭击清掉占领后 legacy 直插重新占领', 30_000, async () => {
        const st = await playerA.request(Op.GET_STATE);
        return (((dataOf(st).city ?? {}) as { territory: unknown[] }).territory).length > 0;
      });
    }
    const targetD = await findFreeLevel1(playerA, usedTiles);
    const denied = await playerA.request(Op.MARCH, { x: targetD.x, y: targetD.y, troops: { militia: 5 }, task: 'occupy' });
    check(denied.ok === false && denied.error?.code === 'TERRITORY_LIMIT', '占领数达官府等级被拒（TERRITORY_LIMIT）');
    const plunderOk = await playerA.request(Op.MARCH, { x: targetD.x, y: targetD.y, troops: { militia: 5 }, task: 'plunder' });
    check(plunderOk.ok === true, `掠夺不受占领上限限制（同目标 plunder 受理，实际 ${plunderOk.error?.code ?? 'ok'}）`);
    // 收回在途部队：立即折返，避免影响后续步骤
    const onMarch = (dataOf(plunderOk).march ?? {}) as { id: string };
    await playerA.request(Op.RECALL_MARCH, { marchId: onMarch.id });
    await playerA.waitPush(Op.PUSH_MARCH_STATE, 60_000, (data) => data.reason === 'march_returned');
  }

  step('v12 NPC 袭击：临时快袭 Worker 清掉占领（驻军全灭 → 占领失效）');
  {
    // tsc（commonjs）不允许 import.meta：用脚本自身路径定位 backend 目录（与 gen-agent-api 一致）
    const backendDir = path.resolve(path.dirname(process.argv[1]), '..');
    const raidWorker = spawn(
      process.execPath,
      ['--import', 'tsx', 'worker/src/index.ts'],
      { cwd: backendDir, env: { ...process.env, NPC_RAID_INTERVAL_MS: '3000' }, stdio: 'ignore' },
    );
    try {
      await waitUntil('NPC 袭击清掉占领（territory 不再包含目标地块）', 60_000, async () => {
        const state = await playerA.request(Op.GET_STATE);
        const territory = ((dataOf(state).city ?? {}) as { territory: Array<{ x: number; y: number }> }).territory;
        return !territory.some((tile) => tile.x === targetA.x && tile.y === targetA.y);
      });
      await waitUntil('事件流记录 npc_raid 与 wilderness_lost（npc_attack）', 30_000, async () => {
        const events = await playerA.request(Op.GET_EVENTS, { sinceId: sinceA, limit: 50 });
        const list = (dataOf(events).events ?? []) as Array<{ id: number; type: string; detail: Record<string, unknown> }>;
        return list.some((event) => event.type === 'npc_raid') && list.some((event) => event.type === 'wilderness_lost' && event.detail.cause === 'npc_attack');
      });
    } finally {
      raidWorker.kill('SIGTERM');
    }
  }

  step('v16 legacy 在途 attack 行军：v15 结算路径（金币战利品 + 占领）保留');
  {
    // 直连数据库插入一条 purpose='attack' 的在途行军，复现升级前已发出的请求
    const state = dataOf(await playerA.request(Op.GET_STATE)) as {
      city: { id: string };
    };
    const cityId = state.city.id;
    const targetLegacy = await findFreeLevel1(playerA);
    const pool = createPool('smoke-world-legacy');
    try {
      await pool.query(
        `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'attack', 'marching', 'player', now() + make_interval(secs => 3))`,
        [accountIdA, cityId, targetLegacy.x, targetLegacy.y, JSON.stringify({ militia: 20 })],
      );
    } finally {
      await pool.end();
    }
    const eventsBefore = await playerA.request(Op.GET_EVENTS, { limit: 1 });
    const sinceLegacy = ((dataOf(eventsBefore).events ?? []) as Array<{ id: number }>).reduce((max, event) => Math.max(max, event.id), 0);
    const outcome = await waitMarchOutcome(playerA, sinceLegacy, 60_000);
    check(outcome.outcome === 'battle_won', 'legacy attack 结算 outcome=battle_won');
    const loot = (outcome.detail.loot ?? {}) as Record<string, number>;
    check(loot.gold === 150, 'legacy 战利品含金币（等级 × 150）');
    const territory = ((dataOf(await playerA.request(Op.GET_STATE)).city ?? {}) as { territory: Array<{ x: number; y: number }> }).territory;
    check(
      territory.some((tile) => tile.x === targetLegacy.x && tile.y === targetLegacy.y),
      'legacy attack 占领目标野地（幸存驻守）',
    );
  }

  step('v13 调兵（账号 A）：legacy attack 占领 NPC 城形成分城，主城调兵并入分城驻军');
  {
    // 分城形成复用 legacy 在途 attack 路径（直插 DB，升级前语义：战胜 NPC 城即占领为分城）；
    // 编队由 DB 直插不受城内驻军约束（与上一步 legacy 同法）。选最近的 1 级无主 NPC 城
    // 控制后续调兵行军时长（150 义兵 vs Lv1 驻防 义兵30+弓手8，战力约 3:1 稳胜）
    const state = dataOf(await playerA.request(Op.GET_STATE)) as {
      city: { id: string };
      /** 城池坐标只在顶层 cities 数组（CityView 本身无 x / y） */
      cities: Array<{ x: number | null; y: number | null; isMain: boolean }>;
    };
    const mainCity = state.cities.find((city) => city.isMain) ?? state.cities[0];
    const eventsBefore = await playerA.request(Op.GET_EVENTS, { limit: 1 });
    const sinceTransfer = ((dataOf(eventsBefore).events ?? []) as Array<{ id: number }>).reduce((max, event) => Math.max(max, event.id), 0);
    const pool = createPool('smoke-world-transfer');
    const npc = { x: 0, y: 0 };
    try {
      const near = await pool.query(
        `SELECT x, y FROM world_tiles
         WHERE kind = 'npc_city' AND owner_city_id IS NULL AND level = 1
         ORDER BY abs(x - $1) + abs(y - $2) LIMIT 1`,
        [mainCity?.x ?? 0, mainCity?.y ?? 0],
      );
      check(near.rowCount === 1, '找到最近的 1 级无主 NPC 城池');
      npc.x = near.rows[0].x as number;
      npc.y = near.rows[0].y as number;
      await pool.query(
        `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'attack', 'marching', 'player', now() + make_interval(secs => 3))`,
        [accountIdA, state.city.id, npc.x, npc.y, JSON.stringify({ militia: 200 })],
      );
    } finally {
      await pool.end();
    }
    const outcome = await waitMarchOutcome(playerA, sinceTransfer, 60_000);
    check(outcome.outcome === 'battle_won', 'legacy attack 打 NPC 城结算 outcome=battle_won');
    const events1 = (dataOf(await playerA.request(Op.GET_EVENTS, { sinceId: sinceTransfer, limit: 50 })).events ??
      []) as Array<{ type: string; detail: Record<string, unknown> }>;
    check(events1.some((event) => event.type === 'npc_city_occupied'), '事件流记录 npc_city_occupied（分城形成）');
    const citiesAfter = (dataOf(await playerA.request(Op.GET_STATE)).cities ?? []) as Array<{ x: number | null; y: number | null }>;
    check(citiesAfter.some((city) => city.x === npc.x && city.y === npc.y), 'GET_STATE cities 列出分城');

    // 调兵走真实 MARCH 路径（用城内现有义兵，不新征——人口已被前面步骤耗尽）：
    // 目的判定 transfer（不战斗），到达并入分城地块驻军
    const cityArmyBefore = ((dataOf(await playerA.request(Op.GET_STATE)).city ?? {}) as { army: Record<string, number> }).army.militia ?? 0;
    check(cityArmyBefore >= 10, `城内义兵足够调兵（${cityArmyBefore} 人，掠夺幸存者）`);
    const garrisonBefore = ((dataOf(await playerA.request(Op.GET_TILE, { x: npc.x, y: npc.y })).tile ?? {}) as { garrison: number }).garrison;
    const march = await playerA.request(Op.MARCH, { x: npc.x, y: npc.y, troops: { militia: 10 } });
    check(march.ok === true, '调兵出征受理');
    const marchData = (dataOf(march).march ?? {}) as { id: string; purpose: string; status: string; arriveAt: string };
    check(marchData.purpose === 'transfer' && marchData.status === 'marching', '行军 purpose=transfer');
    const travelMs = Math.max(0, Date.parse(marchData.arriveAt) - Date.now());
    // 按行军 id 匹配到达推送：legacy 行军的结算推送可能同刻到达，不能误当作调兵到达
    await playerA.waitPush(
      Op.PUSH_MARCH_STATE,
      travelMs + 30_000,
      (data) => data.reason === 'march_arrived' && (data.march as { id?: string } | undefined)?.id === marchData.id,
    );
    const events2 = (dataOf(await playerA.request(Op.GET_EVENTS, { sinceId: sinceTransfer, limit: 50 })).events ??
      []) as Array<{ type: string; detail: Record<string, unknown> }>;
    const transferred = events2.find((event) => event.type === 'march_completed' && event.detail.outcome === 'transferred');
    check(transferred !== undefined, '事件 outcome=transferred');
    check(((transferred?.detail.troops ?? {}) as Record<string, number>).militia === 10, 'transferred 事件含调兵编队');
    const garrisonAfter = ((dataOf(await playerA.request(Op.GET_TILE, { x: npc.x, y: npc.y })).tile ?? {}) as { garrison: number }).garrison;
    check(garrisonAfter === garrisonBefore + 10, '分城驻军并入 10 义兵（调兵不战斗、全额到达）');
    const armyAfter = ((dataOf(await playerA.request(Op.GET_STATE)).city ?? {}) as { army: Record<string, number> }).army;
    check(armyAfter.militia === cityArmyBefore - 10, '主城驻军减少 10（已调往分城）');
  }

  step('v12 召回驻军（账号 B）：撤回即放弃占领，返程回城并入驻军');
  {
    const playerB = await Client.connect();
    const loginB = await playerB.request(Op.LOGIN, { username: `smoke_world_b_${suffix}`, password, asAgent: false });
    check(loginB.ok === true, '账号 B 注册登录成功');
    await prepareMilitia(playerB, 20);
    const targetB = await findFreeLevel1(playerB);
    const march = await playerB.request(Op.MARCH, { x: targetB.x, y: targetB.y, troops: { militia: 20 }, task: 'occupy' });
    check(march.ok === true, '账号 B 占领出征受理（task=occupy）');
    check(((dataOf(march).march ?? {}) as { purpose: string }).purpose === 'occupy', '行军 purpose=occupy');
    const arriveAt = (dataOf(march).march as { arriveAt: string }).arriveAt;
    await playerB.waitPush(Op.PUSH_MARCH_STATE, Math.max(0, Date.parse(arriveAt) - Date.now()) + 30_000, (data) => data.reason === 'march_arrived');
    const occupied = ((dataOf(await playerB.request(Op.GET_STATE)).city ?? {}) as { territory: unknown[] }).territory;
    check(occupied.length === 1, '账号 B 占领成功');

    const recall = await playerB.request(Op.RECALL_GARRISON, { x: targetB.x, y: targetB.y });
    check(recall.ok === true, '召回受理（返程行军创建）');
    const returnMarch = (dataOf(recall).march ?? {}) as { purpose: string; status: string };
    check(returnMarch.purpose === 'return' && returnMarch.status === 'marching', '返程行军 marching');
    const territoryAfter = ((dataOf(await playerB.request(Op.GET_STATE)).city ?? {}) as { territory: unknown[] }).territory;
    check(territoryAfter.length === 0, '召回即放弃占领（领地立即清空）');
    await playerB.waitPush(Op.PUSH_MARCH_STATE, 60_000, (data) => data.reason === 'march_returned');
    const armyB = ((dataOf(await playerB.request(Op.GET_STATE)).city ?? {}) as { army: Record<string, number> }).army;
    check(armyB.militia >= 1, `返程幸存部队回城（多回合战斗折损后 ${armyB.militia} 人，定性断言）`);

    step('v13 行军途中撤回：出征后立刻折返，部队按已走时长回城');
    {
      const armyNow = ((dataOf(await playerB.request(Op.GET_STATE)).city ?? {}) as { army: Record<string, number> }).army;
      const out = await playerB.request(Op.MARCH, {
        x: targetB.x, y: targetB.y, troops: { militia: Math.max(1, Math.floor(armyNow.militia / 2)) },
      });
      check(out.ok === true, '再次出征受理（缺省掠夺）');
      const outMarch = (dataOf(out).march ?? {}) as { id: string; purpose: string; arriveAt: string };
      check(outMarch.purpose === 'plunder', '行军 purpose=plunder');
      const recallRes = await playerB.request(Op.RECALL_MARCH, { marchId: outMarch.id });
      check(recallRes.ok === true, 'RECALL_MARCH 受理');
      const recalled = (dataOf(recallRes).march ?? {}) as { purpose: string; status: string; arriveAt: string };
      check(recalled.purpose === 'return' && recalled.status === 'marching', '行军翻转为返程（purpose=return）');
      const badRecall = await playerB.request(Op.RECALL_MARCH, { marchId: outMarch.id });
      check(
        badRecall.ok === false && badRecall.error?.code === 'MARCH_NOT_RECALLABLE',
        '重复撤回已返程的行军被拒（MARCH_NOT_RECALLABLE）',
      );
      await playerB.waitPush(
        Op.PUSH_MARCH_STATE,
        120_000,
        (data) => data.reason === 'march_returned' && (data.march as { id?: string } | undefined)?.id === outMarch.id,
      );
      console.log('  ✓ 折返部队已回城（march_returned）');
    }

    step('v12 NPC 城池：战败不占领（新账号兵力不足以攻城，属预期数值节奏）');
    const win = await fetchWindow(playerB);
    // 从主城邻域向外扫（按窗口中心离主城距离排序）：大世界上优先选近的 NPC 城池，控制冒烟时长
    const bCity = ((dataOf(await playerB.request(Op.GET_STATE)).cities ?? []) as Array<{ x: number; y: number }>)[0];
    const origins: Array<{ wx: number; wy: number; dist: number }> = [];
    for (let wx = 0; wx < win.size; wx += 10) {
      for (let wy = 0; wy < win.size; wy += 10) {
        origins.push({
          wx,
          wy,
          dist: Math.max(Math.abs(wx + 5 - (bCity?.x ?? 0)), Math.abs(wy + 5 - (bCity?.y ?? 0))),
        });
      }
    }
    origins.sort((a, b) => a.dist - b.dist);
    let npcTile: TileLite | undefined;
    for (const origin of origins) {
      const scan = await fetchWindow(playerB, origin.wx, origin.wy);
      npcTile = scan.tiles.find((tile) => tile.kind === 'npc_city');
      if (npcTile) {
        break;
      }
    }
    check(npcTile !== undefined, `扫描到 NPC 城池 (${npcTile?.x},${npcTile?.y})`);

    step('v13 斥候侦察：未侦察时 NPC 详情为 null，侦察后返回驻防与库存快照');
    await prepareScouts(playerB, 2);
    {
      const blind = (dataOf(await playerB.request(Op.GET_TILE, { x: npcTile!.x, y: npcTile!.y })).tile ?? {}) as {
        npc: unknown;
        scoutedAt: unknown;
      };
      check(blind.npc === null && blind.scoutedAt === null, '未侦察时 NPC 城池详情不可见（npc=null）');

      const armyNow = ((dataOf(await playerB.request(Op.GET_STATE)).city ?? {}) as { army: Record<string, number> }).army;
      const scout = await playerB.request(Op.SCOUT, { x: npcTile!.x, y: npcTile!.y, count: 1 });
      check(scout.ok === true, 'SCOUT 受理（1 斥候）');
      const scoutMarch = (dataOf(scout).march ?? {}) as { purpose: string; arriveAt: string };
      check(scoutMarch.purpose === 'scout', '侦察行军 purpose=scout');
      const scoutTravelMs = Math.max(0, Date.parse(scoutMarch.arriveAt) - Date.now());
      await playerB.waitPush(Op.PUSH_MARCH_STATE, scoutTravelMs + 30_000, (data) => data.reason === 'march_arrived');
      console.log('  ✓ 侦察到达（march_arrived）');
      const lit = (dataOf(await playerB.request(Op.GET_TILE, { x: npcTile!.x, y: npcTile!.y })).tile ?? {}) as {
        npc: { garrison: Record<string, number>; stock: Record<string, number> } | null;
        garrisonDetail: Record<string, number>;
        scoutedAt: string | null;
      };
      check(lit.npc !== null, '侦察后 NPC 城池详情可见（快照）');
      check(
        lit.garrisonDetail && Object.values(lit.garrisonDetail).some((v) => v > 0),
        '驻防编成来自侦察快照',
      );
      check(lit.scoutedAt !== null, 'scoutedAt 为快照时间');
      // 斥候返程回城（返程与去程同速：自适应超时）
      await playerB.waitPush(Op.PUSH_MARCH_STATE, scoutTravelMs + 60_000, (data) => data.reason === 'march_returned');
      const armyAfterScout = ((dataOf(await playerB.request(Op.GET_STATE)).city ?? {}) as { army: Record<string, number> }).army;
      check(armyAfterScout.scout >= (armyNow.scout ?? 0) - 1, '斥候已返程回城');
    }

    const npcDetail = (dataOf(await playerB.request(Op.GET_TILE, { x: npcTile!.x, y: npcTile!.y })).tile ?? {}) as {
      npc: { stock: Record<string, number> } | null;
      level: number;
    };
    check(npcDetail.npc !== null && Object.values(npcDetail.npc.stock).some((value) => value > 0), 'NPC 城池展示驻防与可掠夺库存');
    // v16：NPC 城仅支持掠夺——task='occupy' 被拒
    const npcOccupy = await playerB.request(Op.MARCH, { x: npcTile!.x, y: npcTile!.y, troops: { militia: 5 }, task: 'occupy' });
    check(npcOccupy.ok === false && npcOccupy.error?.code === 'TASK_INVALID_FOR_TARGET', 'NPC 城占领任务被拒（TASK_INVALID_FOR_TARGET）');
    // 取账号 B 当前最新事件 id 作为增量游标（GET_STATE 不含事件流）
    const eventsBefore = await playerB.request(Op.GET_EVENTS, { limit: 1 });
    const sinceB = ((dataOf(eventsBefore).events ?? []) as Array<{ id: number }>).reduce((max, event) => Math.max(max, event.id), 0);
    const npcMarch = await playerB.request(Op.MARCH, { x: npcTile!.x, y: npcTile!.y, troops: { militia: 5 } });
    check(npcMarch.ok === true, '出征 NPC 城池受理（缺省掠夺）');
    check(((dataOf(npcMarch).march ?? {}) as { purpose: string }).purpose === 'plunder', 'NPC 行军 purpose=plunder');
    const outcome = await waitMarchOutcome(playerB, sinceB, Math.max(0, Date.parse((dataOf(npcMarch).march as { arriveAt: string }).arriveAt) - Date.now()) + 30_000);
    check(outcome.outcome === 'battle_lost', `战力不足战败（outcome=battle_lost，攻方 ${String(outcome.detail.attackerPower)} vs 守方 ${String(outcome.detail.defenderPower)}）`);
    const npcAfter = (dataOf(await playerB.request(Op.GET_TILE, { x: npcTile!.x, y: npcTile!.y })).tile ?? {}) as {
      kind: string;
      npc: unknown;
      plunderedAt: string | null;
    };
    check(npcAfter.kind === 'npc_city' && npcAfter.npc !== null, '战败不改变 NPC 城池归属与库存');
    check(npcAfter.plunderedAt === null, '战败不触发掠夺冷却（plunderedAt=null）');

    step('v12 清理：RESET_ACCOUNT 释放占领与地块（NPC 城池不复活，野地回无主）');
    const resetB = await playerB.request(Op.RESET_ACCOUNT, { confirm: true });
    check(resetB.ok === true, '账号 B 重置成功');
    playerB.close();
  }

  const resetA = await playerA.request(Op.RESET_ACCOUNT, { confirm: true });
  check(resetA.ok === true, '账号 A 重置成功');
  playerA.close();

  console.log(`\n世界冒烟完成：账号 ${usernameA}（${accountIdA}）已重置。`);
}

main().catch((err) => {
  console.error('世界冒烟失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
