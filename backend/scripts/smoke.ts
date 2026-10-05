// 端到端冒烟：对照 docs/phase-1-mvp.md 的验收路径逐条验证后端闭环。
// 前置：PostgreSQL 就绪，api 与 worker 已启动（建造时长建议用 BUILD_SECONDS 调小）。
// 运行：npm run smoke（可用 WS_URL / BUILD_WAIT_MS 覆盖默认值）。
// 注意：本脚本按 docs/agent-api.md（生成文档）编写，协议调整时须同步。
// v48 起密码登录不再自动注册：测试账号由 smoke-account.ts 直连数据库预建
// （与 OAuth / 微信建号共用 insertAccountWithCity），再走真实 LOGIN。

import { Op } from '../common/src/protocol';
import { Client, check, dataOf, REQUEST_TIMEOUT_MS, step, stepTotal } from './smoke-client';
import { GOLD_CAP, RATE_PER_LEVEL, STORAGE_BASE } from '../common/src/production';
import { INITIAL_POPULATION, INITIAL_RESOURCES, popCap } from '../common/src/rules';
import { seedAccount } from './smoke-account';
import { runArmyStep, runEconomyStep } from './smoke-army';

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:8080/ws';
const BUILD_WAIT_MS = Number(process.env.BUILD_WAIT_MS || 90_000);

const username = `smoke_${Date.now()}`;
const password = 'smoke-pass-123';
let accountId = '';
let sessionToken = '';



async function main(): Promise<void> {
  console.log(`smoke target: ${WS_URL}, account: ${username}`);

  step('未登录连接发送 GET_STATE 应被拒绝');
  {
    const client = await Client.connect();
    const res = await client.request(Op.GET_STATE);
    check(res.ok === false && res.error?.code === 'NOT_LOGGED_IN', '返回 NOT_LOGGED_IN');
    client.close();
  }

  step('Agent 登录不存在的账号应失败');
  {
    const client = await Client.connect();
    const res = await client.request(Op.LOGIN, {
      username: `ghost_${Date.now()}`,
      password,
      asAgent: true,
    });
    check(res.ok === false && res.error?.code === 'AGENT_PASSWORD_FORBIDDEN', '返回 AGENT_PASSWORD_FORBIDDEN');
    client.close();
  }

  step('不存在的用户名密码登录被拒（v48 起密码通道关闭注册）');
  {
    const client = await Client.connect();
    const res = await client.request(Op.LOGIN, {
      username: `ghost_${Date.now()}`,
      password,
      asAgent: false,
    });
    check(res.ok === false && res.error?.code === 'SIGNUP_CLOSED', '返回 SIGNUP_CLOSED');
    client.close();
  }

  step('玩家密码登录脚本预建的账号');
  await seedAccount(username, password);
  const player = await Client.connect();
  {
    const res = await player.request(Op.LOGIN, { username, password, asAgent: false });
    check(res.ok === true, '登录成功');
    const data = dataOf(res);
    check(data.username === username && data.role === 'player', '返回账号与登录类型');
    accountId = String(data.accountId);
    sessionToken = String(data.sessionToken);
    check(sessionToken.length > 0, '签发会话令牌');
    check(typeof data.expiresAt === 'string' && data.expiresAt.length > 0, '返回令牌过期时间');
  }

  step('玩家查询初始城池状态');
  {
    const res = await player.request(Op.GET_STATE);
    const city = dataOf(res).city as Record<string, unknown>;
    check(res.ok === true && city !== undefined, '拿到城池');
    check(city.building === null, '初始无在建');
    const costs = city.costs as Record<string, { build: Record<string, number> | null; upgrade: unknown }>;
    check(
      costs.farm.build?.gold === 100 && costs.farm.upgrade === null && costs.iron_mine.build?.stone === 60,
      'v6 costs：未建类型给建造成本（farm 金 100 / iron 石 60），upgrade 为 null',
    );
    const buildings = city.buildings as Record<string, number>;
    check(
      buildings.farm === 0 && buildings.lumber_mill === 0 && buildings.quarry === 0 && buildings.iron_mine === 0,
      '初始四种建筑均为 0',
    );
    const resources = city.resources as Record<string, number>;
    check(
      resources.gold > 0 && resources.wood > 0 && resources.stone > 0 && resources.iron > 0,
      `初始资源 gold=${resources.gold} wood=${resources.wood} stone=${resources.stone} iron=${resources.iron}`,
    );
    const production = city.production as Record<string, number>;
    const ts = (city.timeScale as number | undefined) ?? 1;
    check(
      production.food === 100 * ts && production.wood === 100 * ts && production.stone === 100 * ts && production.iron === 100 * ts,
      `四资源基础产量各 ${100 * ts}/h（timeScale=${ts}；实际 粮${production.food}/木${production.wood}/石${production.stone}/铁${production.iron}）`,
    );
    check(production.gold === RATE_PER_LEVEL.gold * ts, `自带 1 级官府产金 ${production.gold}/h（预期 ${RATE_PER_LEVEL.gold * ts}）`);
    check(city.level === 1, 'v7 城池等级初始为 1');
    const levels0 = city.levels as Record<string, number>;
    check(levels0.government === 1, '开号自带 1 级官府');
    const costs0 = city.costs as Record<string, { build: unknown; upgrade: Record<string, number> | null }>;
    check(costs0.government.build === null && costs0.government.upgrade !== null, '官府下一步动作是升级而非建造');
    const population = city.population as { current: number; cap: number; growthPerHour: number };
    check(
      population.current === INITIAL_POPULATION && population.cap === popCap(0) && population.growthPerHour === 0,
      `开号人口 ${population.current}（无民房上限基线 ${popCap(0)}，满编增速 0）`,
    );
    const storage = city.storage as Record<string, number>;
    check(
      storage.wood === STORAGE_BASE * ts && storage.food === STORAGE_BASE * ts && storage.gold === GOLD_CAP * ts,
      `储量随缩放（v22）：四资源上限 ${STORAGE_BASE * ts}，金币上限 ${GOLD_CAP * ts}（timeScale=${ts}）`,
    );
  }

  step('Agent 用永久 Agent 令牌登录同一账号（v47 起 Agent 禁用账号密码）');
  const agent = await Client.connect();
  {
    // 玩家连接先拿永久 Agent 令牌（GET_AGENT_TOKEN 仅玩家可调），Agent 用它登录
    const tokenRes = await player.request(Op.GET_AGENT_TOKEN);
    check(tokenRes.ok === true, '玩家取到永久 Agent 令牌');
    const agentToken = String(dataOf(tokenRes).token);
    check(agentToken.startsWith('sk_'), '令牌为 sk_ 前缀');

    const agentStatusPromise = player.waitPush(Op.PUSH_AGENT_STATUS, REQUEST_TIMEOUT_MS);
    const res = await agent.request(Op.LOGIN, { token: agentToken, asAgent: true });
    check(res.ok === true && dataOf(res).role === 'agent', 'Agent 令牌登录成功');
    check(dataOf(res).expiresAt === null, '永久令牌登录 expiresAt 为 null（不过期）');
    const push = await agentStatusPromise;
    check((push.data as { online: boolean }).online === true, '玩家连接收到 Agent 上线推送');
  }

  step('Agent 发起农田建造（BUILD 指定建筑类型）');
  const buildStartedPromise = player.waitPush(
    Op.PUSH_BUILD_STATE,
    REQUEST_TIMEOUT_MS,
    (data) => data.reason === 'build_started',
  );
  {
    const res = await agent.request(Op.BUILD, { kind: 'farm' });
    const build = dataOf(res).build as Record<string, unknown>;
    check(res.ok === true && build.status === 'building', '建造进入等待状态');
    check(build.kind === 'farm', '建造记录建筑类型 farm');
    check(build.initiator === 'agent', '建造记录发起者为 agent');
    const push = await buildStartedPromise;
    check((push.data as { reason: string }).reason === 'build_started', '玩家连接收到 build_started 推送');
    const pushedBuild = (push.data as { build: Record<string, unknown> }).build;
    check(pushedBuild.initiator === 'agent', '推送中的发起者为 agent');
  }

  step('不存在的建筑类型返回 INVALID_PARAMS');
  {
    const res = await agent.request(Op.BUILD, { kind: 'palace' });
    check(res.ok === false && res.error?.code === 'INVALID_PARAMS', '返回 INVALID_PARAMS');
  }

  step('排队与单实例：伐木场、采石场入队，重复建造与未建升级被拒');
  {
    const res = await player.request(Op.BUILD, { kind: 'lumber_mill' });
    const build = dataOf(res).build as Record<string, unknown>;
    check(res.ok === true && build.status === 'queued' && build.dueAt === null, '伐木场入队：status=queued 且 dueAt=null');
    const res2 = await player.request(Op.BUILD, { kind: 'quarry' });
    check(res2.ok === true && (dataOf(res2).build as Record<string, unknown>).status === 'queued', '采石场入队');
    const state = await player.request(Op.GET_STATE);
    const city = (state.data as { city: { queue: unknown[]; levels: Record<string, number> } }).city;
    check(city.queue.length === 3, `GET_STATE 队列共 3 条（实际 ${city.queue.length}）`);
    check(city.levels.farm === 0 && city.levels.lumber_mill === 0, '完成前各类型等级为 0');

    // v5 单实例：农田在建中，重复建造返回 BUILDING_EXISTS
    const dup = await player.request(Op.BUILD, { kind: 'farm' });
    check(dup.ok === false && dup.error?.code === 'BUILDING_EXISTS', '重复建造返回 BUILDING_EXISTS');
    const dupCity = dataOf(dup).city as Record<string, unknown>;
    check(Array.isArray(dupCity.queue) && dupCity.queue.length === 3, '失败响应附当前队列');
    const legacy = await player.request(Op.BUILD_FARM);
    check(legacy.ok === false && legacy.error?.code === 'BUILDING_EXISTS', '兼容入口 BUILD_FARM 同样返回 BUILDING_EXISTS');

    // v5：在队冲突先于未建成判定——首次建造进行中的类型升级返回 BUILDING_EXISTS
    const early = await player.request(Op.UPGRADE, { kind: 'farm' });
    check(early.ok === false && early.error?.code === 'BUILDING_EXISTS', '首次建造在队时升级返回 BUILDING_EXISTS');
    // 未建造且不在队列的类型升级才返回 BUILDING_NOT_BUILT
    const notBuilt = await player.request(Op.UPGRADE, { kind: 'wall' });
    check(notBuilt.ok === false && notBuilt.error?.code === 'BUILDING_NOT_BUILT', '未建造且不在队时升级返回 BUILDING_NOT_BUILT');

    // v4 队列容量：1 在建 + 2 排队已满，资源足够的建造（民房）走到容量判定被拒
    const full = await player.request(Op.BUILD, { kind: 'house' });
    check(full.ok === false && full.error?.code === 'QUEUE_FULL', '队列满时民房被拒（QUEUE_FULL）');
  }

  step('错误密码登录已存在账号应失败');
  {
    const client = await Client.connect();
    const res = await client.request(Op.LOGIN, { username, password: 'wrong-password', asAgent: false });
    check(res.ok === false && res.error?.code === 'INVALID_CREDENTIALS', '返回 INVALID_CREDENTIALS');
    client.close();
  }

  step('等待 Worker 到期完成并推送（跨进程通知 + 队首激活）');
  {
    const farmDone = await player.waitPush(
      Op.PUSH_BUILD_STATE,
      BUILD_WAIT_MS,
      (data) => data.reason === 'build_completed' && (data.build as { kind: string }).kind === 'farm',
    );
    const farmBuild = (farmDone.data as { build: Record<string, unknown> }).build;
    check(farmBuild.status === 'completed' && farmBuild.completedAt !== null, '农田完成推送：completed 且带完成时间');
    check(farmBuild.initiator === 'agent', '完成消息标明最初发起者 agent');

    const activated = await player.waitPush(
      Op.PUSH_BUILD_STATE,
      REQUEST_TIMEOUT_MS,
      (data) => data.reason === 'build_started' && (data.build as { kind: string }).kind === 'lumber_mill',
    );
    const activatedBuild = (activated.data as { build: Record<string, unknown> }).build;
    check(activatedBuild.status === 'building' && activatedBuild.dueAt !== null, '队首伐木场被激活为 building 且带到期时间');

    const lumberDone = await agent.waitPush(
      Op.PUSH_BUILD_STATE,
      BUILD_WAIT_MS,
      (data) => data.reason === 'build_completed' && (data.build as { kind: string }).kind === 'lumber_mill',
    );
    check((lumberDone.data as { build: Record<string, unknown> }).build.status === 'completed', 'Agent 也收到伐木场完成推送');

    const quarryDone = await player.waitPush(
      Op.PUSH_BUILD_STATE,
      BUILD_WAIT_MS,
      (data) => data.reason === 'build_completed' && (data.build as { kind: string }).kind === 'quarry',
    );
    check((quarryDone.data as { build: Record<string, unknown> }).build.status === 'completed', '采石场完成推送');
  }

  step('建筑升级：UPGRADE 升到 Lv2 并完成（时长按当前等级放大）');
  {
    const up = await player.request(Op.UPGRADE, { kind: 'farm' });
    const build = dataOf(up).build as Record<string, unknown>;
    check(up.ok === true && build.status === 'building' && build.level === 2, '农田升级 Lv2 立即开工（目标等级 2）');
    const farmUpDone = await player.waitPush(
      Op.PUSH_BUILD_STATE,
      BUILD_WAIT_MS,
      (data) => data.reason === 'build_completed' && (data.build as { level: number }).level === 2,
    );
    const upBuild = (farmUpDone.data as { build: Record<string, unknown> }).build;
    check(upBuild.status === 'completed' && upBuild.level === 2, '升级完成推送：completed 且等级 2');
    const state = await player.request(Op.GET_STATE);
    const city = (state.data as { city: { levels: Record<string, number>; production: Record<string, number>; queue: unknown[]; costs: Record<string, { build: unknown; upgrade: Record<string, number> | null }> } }).city;
    check(city.levels.farm === 2, `GET_STATE 农田等级 2（实际 ${city.levels.farm}）`);
    const costs = city.costs as Record<string, { build: unknown; upgrade: Record<string, number> | null }>;
    check(costs.farm.upgrade?.gold === 200, `v6 costs：Lv2 农田下一步升级成本 = 金 200（实际 ${costs.farm.upgrade?.gold}）`);
    const ts2 = ((city as { timeScale?: number }).timeScale ?? 1);
    check(city.production.food === 340 * ts2, `Lv2 农田产量 ${340 * ts2}/h（基础 100 + 240 × timeScale=${ts2}；实际 ${city.production.food}）`);
    check(city.queue.length === 0, '升级完成后队列为空');
  }

  await runEconomyStep(BUILD_WAIT_MS);
  await runArmyStep(BUILD_WAIT_MS);

  step('查询 Agent 信息');
  {
    const res = await player.request(Op.GET_AGENT_INFO);
    const info = dataOf(res) as { agentOnline: boolean; recentEvents: Array<Record<string, unknown>> };
    check(res.ok === true && info.agentOnline === true, 'Agent 在线');
    const types = info.recentEvents.map((e) => e.type);
    check(
      types.includes('agent_connected') && types.includes('build_started'),
      `Agent 近期事件包含 agent_connected / build_started：${types.join(', ')}`,
    );
  }

  step('按需查询历史事件');
  {
    const res = await player.request(Op.GET_EVENTS, { limit: 20 });
    const events = (dataOf(res).events as Array<Record<string, unknown>>).map((e) => e.type);
    check(res.ok === true, '查询成功');
    check(events.includes('build_completed'), '包含 build_completed');
    check(events.includes('build_queued'), '包含 build_queued（入队事件）');
    check(events.includes('agent_connected') && events.includes('agent_disconnected') === false, '包含 agent_connected');
    check(events[0] !== undefined, `最新事件类型：${events[0]}`);
  }

  step('无效令牌登录应返回 SESSION_INVALID');
  {
    const client = await Client.connect();
    const res = await client.request(Op.LOGIN, { token: 'not-a-valid-token', asAgent: false });
    check(res.ok === false && res.error?.code === 'SESSION_INVALID', '返回 SESSION_INVALID');
    client.close();
  }

  step('断线重连后用会话令牌自动登录并按需查询');
  {
    player.close();
    agent.close();
    const reconnected = await Client.connect();
    const login = await reconnected.request(Op.LOGIN, { token: sessionToken, asAgent: false });
    check(login.ok === true, '令牌登录成功');
    check(dataOf(login).accountId === accountId, '令牌登录返回同一账号');
    check(dataOf(login).sessionToken === sessionToken, '令牌登录原样返回会话令牌');
    const res = await reconnected.request(Op.GET_STATE);
    const city = dataOf(res).city as Record<string, unknown>;
    const buildings = city.buildings as Record<string, number>;
    const levels = city.levels as Record<string, number>;
    const queue = city.queue as unknown[];
    check(
      buildings.farm === 1 && buildings.lumber_mill === 1 && buildings.quarry === 1,
      `重连后按需查询：三种建筑均建成（实际 farm=${buildings.farm} lumber=${buildings.lumber_mill} quarry=${buildings.quarry}）`,
    );
    check(
      levels.farm === 2 && levels.lumber_mill === 1 && levels.quarry === 1,
      `等级正确（farm=${levels.farm} lumber=${levels.lumber_mill} quarry=${levels.quarry}）`,
    );
    check(queue.length === 0 && city.building === null, '队列已清空、无在建');
    const production = city.production as Record<string, number>;
    const ts3 = ((city as { timeScale?: number }).timeScale ?? 1);
    check(production.food === 340 * ts3 && production.wood === 200 * ts3 && production.stone === 180 * ts3, `产量生效（× timeScale=${ts3}；粮 ${production.food}/木 ${production.wood}/石 ${production.stone} 每小时）`);

    const closed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待 LOGOUT 关闭连接超时')), REQUEST_TIMEOUT_MS);
      reconnected.socket.once('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const logout = await reconnected.request(Op.LOGOUT);
    check(logout.ok === true, 'LOGOUT 成功吊销令牌');
    await closed;
    console.log('  ✓ LOGOUT 后连接被服务端关闭');

    const reuse = await Client.connect();
    const reuseRes = await reuse.request(Op.LOGIN, { token: sessionToken, asAgent: false });
    check(reuseRes.ok === false && reuseRes.error?.code === 'SESSION_INVALID', '吊销后的令牌再登录返回 SESSION_INVALID');
    reuse.close();
  }

  console.log(`\n全部 ${stepTotal()} 步通过：后端最小闭环验证成功`);
}

main().catch((err) => {
  console.error('\n冒烟失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
