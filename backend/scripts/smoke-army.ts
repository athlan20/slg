// 冒烟的分步实现：城池经济步骤（原 smoke.ts 内联，拆出控制单文件行数）与 v11 征兵步骤。
// 主流程与步骤序号见 scripts/smoke.ts；客户端与断言工具见 scripts/smoke-client.ts。

import { Op } from '../common/src/protocol';
import { Client, check, dataOf, REQUEST_TIMEOUT_MS, step } from './smoke-client';
import { RATE_PER_LEVEL, STORAGE_BASE } from '../common/src/production';
import { GOLD_CAP } from '../common/src/production';
import { INITIAL_POPULATION, INITIAL_RESOURCES, popCap } from '../common/src/rules';
import { seedAccount } from './smoke-account';

const password = 'smoke-pass-123';

export async function runEconomyStep(buildWaitMs: number): Promise<void> {
  step('v8 建筑与经济：民房/军营/仓库、取消排队与改名（独立新账号，官府为开局自带）');
{
  const v7name = `smoke_v7_${Date.now()}`;
  await seedAccount(v7name, password); // v48 起密码通道不再自动注册，先直插预建
  const player2 = await Client.connect();
  const login = await player2.request(Op.LOGIN, { username: v7name, password, asAgent: false });
  check(login.ok === true, 'v7 账号登录成功（脚本预建）');

  // 民房立即开工，军营、仓库排队（1 在建 + 2 排队；官府开局自带，重复建造被拒）
  const dupGov = await player2.request(Op.BUILD, { kind: 'government' });
  check(dupGov.ok === false && dupGov.error?.code === 'BUILDING_EXISTS', '重复建造自带的官府被拒（BUILDING_EXISTS）');
  const house = await player2.request(Op.BUILD, { kind: 'house' });
  check(house.ok === true && (dataOf(house).build as Record<string, unknown>).status === 'building', '民房立即开工');
  const barracks = await player2.request(Op.BUILD, { kind: 'barracks' });
  check(barracks.ok === true && (dataOf(barracks).build as Record<string, unknown>).status === 'queued', '军营进入排队');
  const wh = await player2.request(Op.BUILD, { kind: 'warehouse' });
  check(wh.ok === true && (dataOf(wh).build as Record<string, unknown>).status === 'queued', '仓库进入排队');

  // 取消排队中的仓库：成本按快照全额返还
  const before = await player2.request(Op.GET_STATE);
  const goldBefore = ((dataOf(before).city as Record<string, unknown>).resources as Record<string, number>).gold;
  const whId = (dataOf(wh).build as { id: string }).id;
  const cancel = await player2.request(Op.CANCEL_BUILD, { buildId: whId });
  check(cancel.ok === true && (dataOf(cancel).build as Record<string, unknown>).status === 'cancelled', '取消排队中的仓库（status=cancelled）');
  const afterCancel = await player2.request(Op.GET_STATE);
  const afterCity = dataOf(afterCancel).city as { resources: Record<string, number>; queue: Array<{ id: string }> };
  check(
    afterCity.resources.gold >= goldBefore + 120,
    `取消后成本返还（金 ${goldBefore} → ${afterCity.resources.gold}）`,
  );
  check(
    afterCity.queue.every((item) => item.id !== whId),
    '被取消的条目不再出现在队列中',
  );
  const cancelActive = await player2.request(Op.CANCEL_BUILD, { buildId: (dataOf(house).build as { id: string }).id });
  check(cancelActive.ok === false && cancelActive.error?.code === 'BUILD_NOT_CANCELLABLE', '取消在建条目被拒（BUILD_NOT_CANCELLABLE）');

  // 等民房完成、军营激活并完成；校验产金（开局官府）与人口上限
  const houseDone = await player2.waitPush(
    Op.PUSH_BUILD_STATE,
    buildWaitMs,
    (data) => data.reason === 'build_completed' && (data.build as { kind: string }).kind === 'house',
  );
  check((houseDone.data as { build: Record<string, unknown> }).build.status === 'completed', '民房完成推送');
  // 先注册军营完成的等待（测试客户端会丢弃无等待者的推送，后注册会错过），
  // 再做 7 秒去重观察：期间不应再出现民房的完成推送
  const govDonePromise = player2.waitPush(
    Op.PUSH_BUILD_STATE,
    buildWaitMs,
    (data) => data.reason === 'build_completed' && (data.build as { kind: string }).kind === 'barracks',
  );
  let duplicate: unknown = null;
  try {
    duplicate = await player2.waitPush(
      Op.PUSH_BUILD_STATE,
      7_000,
      (data) => data.reason === 'build_completed' && (data.build as { kind: string }).kind === 'house',
    );
  } catch {
    // 期待超时：7 秒（> 5 秒兜底轮询周期）内不应出现重复的完成推送
  }
  check(duplicate === null, 'build_completed 每条只推送一次（跨一个兜底轮询周期无重复）');
  const barracksDone = await govDonePromise;
  check((barracksDone.data as { build: Record<string, unknown> }).build.status === 'completed', '军营完成推送');

  const ecoState = await player2.request(Op.GET_STATE);
  const ecoCity = dataOf(ecoState).city as {
    levels: Record<string, number>;
    production: Record<string, number>;
    population: { current: number; cap: number };
    storage: Record<string, number>;
  };
  check(ecoCity.levels.house === 1 && ecoCity.levels.barracks === 1, '民房与军营均建成 Lv1');
  check(ecoCity.levels.government === 1, '官府保持开局自带 Lv1');
  const ts = ((ecoCity as { timeScale?: number }).timeScale ?? 1);
  check(ecoCity.production.gold === RATE_PER_LEVEL.gold * ts, `官府产金 ${ecoCity.production.gold}/h（预期 ${RATE_PER_LEVEL.gold * ts}，timeScale=${ts}）`);
  check(
    ecoCity.population.cap === popCap(1),
    `民房提高人口上限至 ${ecoCity.population.cap}（100 × 1 × 2，v8 确认公式）`,
  );

  // 重建仓库并完成：v8 仓库不改变储量上限（防掠夺保护随战斗玩法接入）
  const wh2 = await player2.request(Op.BUILD, { kind: 'warehouse' });
  check(wh2.ok === true && (dataOf(wh2).build as Record<string, unknown>).status === 'building', '仓库重新开工');
  const wh2Done = await player2.waitPush(
    Op.PUSH_BUILD_STATE,
    buildWaitMs,
    (data) => data.reason === 'build_completed' && (data.build as { kind: string }).kind === 'warehouse',
  );
  check((wh2Done.data as { build: Record<string, unknown> }).build.status === 'completed', '仓库完成推送');
  const whState = await player2.request(Op.GET_STATE);
  const whCity = dataOf(whState).city as { levels: Record<string, number>; storage: Record<string, number> };
  check(whCity.levels.warehouse === 1, '仓库建成 Lv1');
  check(
    whCity.storage.wood === STORAGE_BASE * ts && whCity.storage.food === STORAGE_BASE * ts,
    `v8 仓库不改变储量上限（仍为 ${STORAGE_BASE}）`,
  );

  // 改名：Agent 连接收到 PUSH_CITY_STATE；非法名称被拒
  const agent2 = await Client.connect();
  // v47 起 Agent 禁用账号密码：用玩家连接取永久 Agent 令牌登录
  const v7AgentToken = String(dataOf(await player2.request(Op.GET_AGENT_TOKEN)).token);
  const agent2Login = await agent2.request(Op.LOGIN, { token: v7AgentToken, asAgent: true });
  check(agent2Login.ok === true, 'v7 账号 Agent 令牌登录');
  const renamePushPromise = agent2.waitPush(Op.PUSH_CITY_STATE, REQUEST_TIMEOUT_MS, (data) => data.reason === 'city_renamed');
  const rename = await player2.request(Op.RENAME_CITY, { name: '临江城' });
  check(rename.ok === true && dataOf(rename).name === '临江城', '城池改名成功');
  const renamePush = await renamePushPromise;
  check((renamePush.data as { name: string }).name === '临江城', 'Agent 连接收到 city_renamed 推送');
  const renamedState = await player2.request(Op.GET_STATE);
  check((dataOf(renamedState).city as { name: string }).name === '临江城', 'GET_STATE 返回新城名');
  const badRename1 = await player2.request(Op.RENAME_CITY, { name: '   ' });
  check(badRename1.ok === false && badRename1.error?.code === 'INVALID_PARAMS', '空白名称被拒');
  const badRename2 = await player2.request(Op.RENAME_CITY, { name: 'x'.repeat(25) });
  check(badRename2.ok === false && badRename2.error?.code === 'INVALID_PARAMS', '超长名称被拒（25 字符）');

  // Agent 上报计划：两段上报、单字段合并、玩家被拒、推送通知
  const playerReport = await player2.request(Op.AGENT_REPORT_PLAN, { nextAction: '代玩家操作' });
  check(playerReport.ok === false && playerReport.error?.code === 'AGENT_FORBIDDEN', '玩家上报计划被拒（AGENT_FORBIDDEN）');
  const planPushPromise = agent2Login.ok
    ? player2.waitPush(Op.PUSH_AGENT_PLAN, REQUEST_TIMEOUT_MS)
    : Promise.reject(new Error('agent2 未登录'));
  const report1 = await agent2.request(Op.AGENT_REPORT_PLAN, {
    nextAction: '攒木料到 5000 后升 2 级伐木场',
    overallPlan: '先补齐四种资源建筑到 Lv3，再建军营征兵',
  });
  const plan1 = dataOf(report1).plan as { nextAction: string | null; overallPlan: string | null };
  check(
    report1.ok === true && plan1.nextAction === '攒木料到 5000 后升 2 级伐木场' && plan1.overallPlan !== null,
    'Agent 两段计划上报成功',
  );
  const planPush = await planPushPromise;
  check((planPush.data as { nextAction: string | null }).nextAction !== null, '玩家连接收到 PUSH_AGENT_PLAN 推送');
  const report2 = await agent2.request(Op.AGENT_REPORT_PLAN, { nextAction: '木料已够，现在升 2 级伐木场' });
  const plan2 = dataOf(report2).plan as { nextAction: string | null; overallPlan: string | null };
  check(
    plan2.nextAction === '木料已够，现在升 2 级伐木场' && plan2.overallPlan === plan1.overallPlan,
    '单字段更新：下一步动作刷新，整体计划保持',
  );
  const agentInfoRes = await player2.request(Op.GET_AGENT_INFO);
  const agentInfo = dataOf(agentInfoRes) as { plan: { nextAction: string | null; overallPlan: string | null } | null };
  check(
    agentInfo.plan?.nextAction === plan2.nextAction && agentInfo.plan?.overallPlan === plan2.overallPlan,
    'GET_AGENT_INFO 返回最新计划快照',
  );

  // 一键重置：仅玩家连接可调用（Agent 被拒）；confirm 防误触；重置后回到开号初始状态
  const agentReset = await agent2.request(Op.RESET_ACCOUNT, { confirm: true });
  check(agentReset.ok === false && agentReset.error?.code === 'AGENT_FORBIDDEN', 'Agent 调用重置被拒（AGENT_FORBIDDEN）');
  const badReset = await player2.request(Op.RESET_ACCOUNT, {});
  check(badReset.ok === false && badReset.error?.code === 'INVALID_PARAMS', '缺少 confirm 的重置被拒（INVALID_PARAMS）');
  const resetPushPromise = agent2.waitPush(Op.PUSH_CITY_STATE, REQUEST_TIMEOUT_MS, (data) => data.reason === 'account_reset');
  const reset = await player2.request(Op.RESET_ACCOUNT, { confirm: true });
  const resetCity = dataOf(reset).city as {
    name: string;
    resources: Record<string, number>;
    levels: Record<string, number>;
    population: { current: number };
    queue: unknown[];
  };
  check(reset.ok === true, '一键重置成功');
  check(
    resetCity.name === '主城' && resetCity.population.current === INITIAL_POPULATION && resetCity.queue.length === 0,
    `城池名/人口（${resetCity.population.current}）/队列回到初始`,
  );
  // 重置后读取的瞬间产量已按 timeScale 回补（金/石各 ~1.4/s @50×）：按 ≥ 初始 + 小容差断言
  check(
    resetCity.resources.gold >= INITIAL_RESOURCES.gold && resetCity.resources.gold <= INITIAL_RESOURCES.gold + 50 &&
      resetCity.resources.stone >= INITIAL_RESOURCES.stone && resetCity.resources.stone <= INITIAL_RESOURCES.stone + 50,
    `资源回到初始（金 ${resetCity.resources.gold} / 石 ${resetCity.resources.stone}，允许产量回补 ±50）`,
  );
  check(
    resetCity.levels.government === 1 && Object.entries(resetCity.levels).every(([kind, level]) => kind === 'government' || level === 0),
    '重置恢复开局建筑（1 级官府），其余等级归 0',
  );
  const resetPush = await resetPushPromise;
  check((resetPush.data as { reason: string }).reason === 'account_reset', 'Agent 连接收到 account_reset 推送');
  const eventsAfterReset = await player2.request(Op.GET_EVENTS, {});
  const resetEvents = dataOf(eventsAfterReset).events as Array<{ type: string }>;
  check(resetEvents.length === 1 && resetEvents[0].type === 'account_reset', '事件流清空后只剩 account_reset 审计事件');
  const planAfterReset = await player2.request(Op.GET_AGENT_INFO);
  check(dataOf(planAfterReset).plan === null, '重置后 Agent 计划一并清空');

  player2.close();
  agent2.close();
}
}

/**
 * 征兵与守城步骤（v11）：军营/城墙建造 → 兵种门槛/人口/参数校验 → 征募、取消返还、
 * 完成入军 → defenseBonus。征兵时长用 RECRUIT_UNIT_SECONDS 压缩（与 worker 同值）。
 */
export async function runArmyStep(buildWaitMs: number): Promise<void> {
  step('v11 军营征兵与城墙守城加成（独立新账号）');
  {
    const player = await Client.connect();
    const name = `smoke_army_${Date.now()}`;
    await seedAccount(name, password); // v48 起密码通道不再自动注册，先直插预建
    const login = await player.request(Op.LOGIN, { username: name, password: 'smoke-pass-123', asAgent: false });
    check(login.ok === true, 'army 账号登录成功（脚本预建）');

    // 未建军营：任何兵种都不可征募
    const noBarracks = await player.request(Op.RECRUIT, { troop: 'porter', count: 1 });
    check(noBarracks.ok === false && noBarracks.error?.code === 'TROOP_NOT_AVAILABLE', '未建军营征募被拒（TROOP_NOT_AVAILABLE）');
    const badTroop = await player.request(Op.RECRUIT, { troop: 'knight', count: 1 });
    check(badTroop.ok === false && badTroop.error?.code === 'INVALID_PARAMS', '未知兵种被拒（INVALID_PARAMS）');
    const badCount = await player.request(Op.RECRUIT, { troop: 'porter', count: 0 });
    check(badCount.ok === false && badCount.error?.code === 'INVALID_PARAMS', '数量越界被拒（INVALID_PARAMS）');

    // 建军营与城墙（军营立即开工，城墙排队，队首激活后完成）
    const barracks = await player.request(Op.BUILD, { kind: 'barracks' });
    check(barracks.ok === true && (dataOf(barracks).build as Record<string, unknown>).status === 'building', '军营立即开工');
    const wall = await player.request(Op.BUILD, { kind: 'wall' });
    check(wall.ok === true && (dataOf(wall).build as Record<string, unknown>).status === 'queued', '城墙进入排队');
    const barracksDone = await player.waitPush(
      Op.PUSH_BUILD_STATE,
      buildWaitMs,
      (data) => data.reason === 'build_completed' && (data.build as { kind: string }).kind === 'barracks',
    );
    check((barracksDone.data as { build: Record<string, unknown> }).build.status === 'completed', '军营完成推送');
    const wallDone = await player.waitPush(
      Op.PUSH_BUILD_STATE,
      buildWaitMs,
      (data) => data.reason === 'build_completed' && (data.build as { kind: string }).kind === 'wall',
    );
    check((wallDone.data as { build: Record<string, unknown> }).build.status === 'completed', '城墙完成推送（队首激活后）');
    const wallState = await player.request(Op.GET_STATE);
    const wallCity = dataOf(wallState).city as { levels: Record<string, number>; defenseBonus: number };
    check(wallCity.levels.barracks === 1 && wallCity.levels.wall === 1, '军营与城墙均建成 Lv1');
    check(wallCity.defenseBonus === 5, `v11 守城加成 ${wallCity.defenseBonus}（城墙 Lv1 × 5）`);

    // 兵种门槛与人口校验
    const scoutLocked = await player.request(Op.RECRUIT, { troop: 'scout', count: 1 });
    check(scoutLocked.ok === false && scoutLocked.error?.code === 'TROOP_NOT_AVAILABLE', '斥候需军营 Lv2 被拒（TROOP_NOT_AVAILABLE）');
    // v21 开局资源 800×5 后，porter×60 的资源门槛（3000 金）先于人口门槛命中——
    // 两种门槛都合法，且 v22 起对应失败响应带缺口字段（shortfall / retryAfterSeconds）
    const tooMany = await player.request(Op.RECRUIT, { troop: 'porter', count: 60 });
    const tooManyCode = tooMany.ok ? 'ok' : tooMany.error?.code;
    const tooManyData = (tooMany as { data?: { shortfall?: unknown; retryAfterSeconds?: unknown } }).data ?? {};
    check(
      tooMany.ok === false && (tooManyCode === 'INSUFFICIENT_POPULATION' || tooManyCode === 'INSUFFICIENT_RESOURCES'),
      `超量征募被拒（INSUFFICIENT_POPULATION / INSUFFICIENT_RESOURCES，实际 ${tooManyCode}）`,
    );
    check(
      tooManyData.shortfall !== undefined,
      `失败响应附缺口 shortfall（实际 ${JSON.stringify(tooManyData.shortfall)}）`,
    );

    // 征募 2 民夫（立即开始）+ 2 义兵（排队），随后取消排队条目（资源与人口返还）。
    // 推送只发给发起方之外的连接：加一条 Agent 连接收推送
    const agent = await Client.connect();
    // v47 起 Agent 禁用账号密码：用玩家连接取永久 Agent 令牌登录
    const armyAgentToken = String(dataOf(await player.request(Op.GET_AGENT_TOKEN)).token);
    const agentLogin = await agent.request(Op.LOGIN, { token: armyAgentToken, asAgent: true });
    check(agentLogin.ok === true, 'army 账号 Agent 令牌登录');
    const recruitPushPromise = agent.waitPush(Op.PUSH_RECRUIT_STATE, REQUEST_TIMEOUT_MS, (data) => data.reason === 'recruit_started');
    const popBefore = dataOf(await player.request(Op.GET_STATE)).city as { population: { current: number }; resources: Record<string, number> };
    const porter = await player.request(Op.RECRUIT, { troop: 'porter', count: 2 });
    const recruit = dataOf(porter).recruit as { id: string; status: string; dueAt: string | null };
    check(porter.ok === true && recruit.status === 'recruiting' && recruit.dueAt !== null, '征募 2 民夫立即开始（带到期时间）');
    const recruitPush = await recruitPushPromise;
    check((recruitPush.data as { reason: string }).reason === 'recruit_started', '收到 recruit_started 推送');
    const militia = await player.request(Op.RECRUIT, { troop: 'militia', count: 2 });
    const queued = dataOf(militia).recruit as { id: string; status: string; dueAt: string | null };
    check(militia.ok === true && queued.status === 'queued' && queued.dueAt === null, '征募 2 义兵进入排队');
    const cancelActive = await player.request(Op.CANCEL_RECRUIT, { recruitId: recruit.id });
    check(cancelActive.ok === false && cancelActive.error?.code === 'RECRUIT_NOT_CANCELLABLE', '取消征募中条目被拒（RECRUIT_NOT_CANCELLABLE）');
    const goldBeforeCancel = popBefore.resources.gold;
    const cancel = await player.request(Op.CANCEL_RECRUIT, { recruitId: queued.id });
    check(cancel.ok === true && (dataOf(cancel).recruit as { status: string }).status === 'cancelled', '取消排队义兵（status=cancelled）');
    const afterCancel = dataOf(await player.request(Op.GET_STATE)).city as { population: { current: number }; resources: Record<string, number>; recruitQueue: unknown[] };
    check(afterCancel.population.current === popBefore.population.current - 2, `人口扣减 2（${popBefore.population.current} → ${afterCancel.population.current}）`);
    check(afterCancel.resources.gold >= goldBeforeCancel - 2 * 80 + 2 * 80 - 2 * 50, '排队取消后资源返还');
    check(afterCancel.recruitQueue.length === 1, '取消后队列只剩征募中的民夫');

    // 等征兵完成：兵力入城、人口不返还（Agent 连接收完成推送）
    const porterDone = await agent.waitPush(
      Op.PUSH_RECRUIT_STATE,
      buildWaitMs,
      (data) => data.reason === 'recruit_completed' && (data.recruit as { troop: string }).troop === 'porter',
    );
    check((porterDone.data as { recruit: { status: string } }).recruit.status === 'completed', '民夫征兵完成推送');
    let duplicate: unknown = null;
    try {
      duplicate = await agent.waitPush(Op.PUSH_RECRUIT_STATE, 7_000, (data) => data.reason === 'recruit_completed');
    } catch {
      // 期待超时：征兵完成推送同样不应重复
    }
    check(duplicate === null, 'recruit_completed 每条只推送一次');
    const finalState = dataOf(await player.request(Op.GET_STATE)).city as {
      army: Record<string, number>;
      population: { current: number };
      recruitQueue: unknown[];
    };
    check(finalState.army.porter === 2, `城内驻军民夫 ${finalState.army.porter}（预期 2）`);
    check(finalState.army.militia === 0, '取消的义兵未入军');
    check(finalState.population.current === popBefore.population.current - 2, '征兵消耗人口（完成不返还）');
    check(finalState.recruitQueue.length === 0, '征兵队列清空');

    const events = await player.request(Op.GET_EVENTS, { limit: 30 });
    const types = (dataOf(events).events as Array<{ type: string }>).map((e) => e.type);
    check(
      types.includes('recruit_completed') && types.includes('recruit_started') && types.includes('recruit_cancelled'),
      `事件流包含征兵开始/完成/取消：${types.filter((t) => t.startsWith('recruit')).join(', ')}`,
    );

    player.close();
    agent.close();
  }
}
