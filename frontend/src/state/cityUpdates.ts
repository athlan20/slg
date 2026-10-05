// 城池视图的乐观更新（纯函数）：BUILD / CANCEL_BUILD / RECRUIT / CANCEL_RECRUIT / MARCH 的
// 直接响应与服务端推送到达时本地先行合并，展示不等待查询；权威状态随后由按需查询
// （防抖 / 定期）对齐。统一维护 queue 与兼容字段 building（queue 中首个 building 项）；
// recruitQueue 同形态维护（v11）；marches 维护进行中行军（v12）。

import type {
  BuildStatePushData,
  BuildView,
  CityView,
  MarchStatePushData,
  MarchView,
  RecruitStatePushData,
  RecruitView,
  TroopKind,
} from '../api/protocol';

export type BuildPushReason = BuildStatePushData['reason'];
export type RecruitPushReason = RecruitStatePushData['reason'];

function withQueue(city: CityView, queue: BuildView[]): CityView {
  return { ...city, queue, building: queue.find((item) => item.status === 'building') ?? null };
}

/** BUILD / UPGRADE 成功的直接结果：立即开工插队首，入队追加队尾 */
export function applyBuildResult(city: CityView, build: BuildView): CityView {
  const queue = build.status === 'queued' ? [...city.queue, build] : [build, ...city.queue];
  return withQueue(city, queue);
}

/** CANCEL_BUILD 成功的直接结果：排队条目退出队列（返还的成本随按需查询对齐） */
export function applyCancelResult(city: CityView, build: BuildView): CityView {
  return withQueue(city, city.queue.filter((item) => item.id !== build.id));
}

/**
 * PUSH_BUILD_STATE 的乐观更新：
 * - build_queued：追加队尾；
 * - build_started：立即开工插队首，或队列激活原位替换为 building；
 * - build_completed：移除该条并计入建筑等级 / 数量；队首若为排队项先乐观置为
 *   building（激活后的 dueAt 由服务端给出，本地先置 null，随按需查询对齐）；
 * - build_cancelled（v7）：移除该排队条目。
 */
export function applyBuildPush(city: CityView, reason: BuildPushReason, build: BuildView): CityView {
  if (reason === 'build_queued') {
    return withQueue(city, [...city.queue, build]);
  }
  if (reason === 'build_started') {
    const exists = city.queue.some((item) => item.id === build.id);
    return withQueue(
      city,
      exists ? city.queue.map((item) => (item.id === build.id ? build : item)) : [build, ...city.queue],
    );
  }
  if (reason === 'build_cancelled') {
    return applyCancelResult(city, build);
  }
  const rest = city.queue.filter((item) => item.id !== build.id);
  const nextQueue = rest.map((item, index) =>
    index === 0 && item.status === 'queued'
      ? { ...item, status: 'building' as const, dueAt: null }
      : item,
  );
  const level = Math.max(city.levels[build.kind] ?? 0, build.level);
  return {
    ...withQueue(city, nextQueue),
    // v5：完成即写入该类型的目标等级（GREATEST 语义防回退）；数量语义为 0/1
    levels: { ...city.levels, [build.kind]: level },
    buildings: { ...city.buildings, [build.kind]: 1 },
    farms: build.kind === 'farm' ? 1 : city.farms,
  };
}

/** RECRUIT 成功的直接结果（v11）：立即征募插队首，入队追加队尾 */
export function applyRecruitResult(city: CityView, recruit: RecruitView): CityView {
  const recruitQueue =
    recruit.status === 'queued' ? [...city.recruitQueue, recruit] : [recruit, ...city.recruitQueue];
  return { ...city, recruitQueue };
}

/** CANCEL_RECRUIT 成功的直接结果（v11）：排队条目退出队列（返还随按需查询对齐） */
export function applyCancelRecruitResult(city: CityView, recruit: RecruitView): CityView {
  return { ...city, recruitQueue: city.recruitQueue.filter((item) => item.id !== recruit.id) };
}

/**
 * PUSH_RECRUIT_STATE 的乐观更新（v11，形态对齐 applyBuildPush）：
 * - recruit_queued：追加队尾；
 * - recruit_started：立即征募插队首，或队列激活原位替换为 recruiting；
 * - recruit_completed：移除该条并把数量计入城内驻军；队首若为排队项先乐观置为
 *   recruiting（激活后的 dueAt 由服务端给出，本地先置 null，随按需查询对齐）；
 * - recruit_cancelled：移除该排队条目。
 */
export function applyRecruitPush(city: CityView, reason: RecruitPushReason, recruit: RecruitView): CityView {
  if (reason === 'recruit_queued') {
    return { ...city, recruitQueue: [...city.recruitQueue, recruit] };
  }
  if (reason === 'recruit_started') {
    const exists = city.recruitQueue.some((item) => item.id === recruit.id);
    return {
      ...city,
      recruitQueue: exists
        ? city.recruitQueue.map((item) => (item.id === recruit.id ? recruit : item))
        : [recruit, ...city.recruitQueue],
    };
  }
  if (reason === 'recruit_cancelled') {
    return applyCancelRecruitResult(city, recruit);
  }
  const rest = city.recruitQueue.filter((item) => item.id !== recruit.id);
  const nextQueue = rest.map((item, index) =>
    index === 0 && item.status === 'queued'
      ? { ...item, status: 'recruiting' as const, dueAt: null }
      : item,
  );
  return {
    ...city,
    recruitQueue: nextQueue,
    army: { ...city.army, [recruit.troop]: city.army[recruit.troop] + recruit.count },
  };
}

/** MARCH / RECALL_GARRISON 成功的直接结果（v12）：新行军按到达时间插入进行中列表 */
export function applyMarchResult(city: CityView, march: MarchView): CityView {
  if (march.status !== 'marching') {
    return { ...city, marches: city.marches.filter((item) => item.id !== march.id) };
  }
  const exists = city.marches.some((item) => item.id === march.id);
  const marches = exists
    ? city.marches.map((item) => (item.id === march.id ? march : item))
    : [...city.marches, march].sort((a, b) => Date.parse(a.arriveAt) - Date.parse(b.arriveAt));
  return { ...city, marches };
}

/**
 * PUSH_MARCH_STATE 的乐观更新（v12）：
 * - march_started：新行军插入进行中列表（召回会同时丢失占领，领地随按需查询对齐）；
 * - march_arrived：移除该条（战斗结果与占领变化见事件流与 PUSH_TILE_STATE）；
 * - march_returned：移除该条并把编队并入城内驻军。
 */
export function applyMarchPush(city: CityView, reason: MarchStatePushData['reason'], march: MarchView): CityView {
  if (reason === 'march_started') {
    return applyMarchResult(city, march);
  }
  if (reason === 'march_returned') {
    const army = { ...city.army };
    for (const kind of Object.keys(march.troops) as TroopKind[]) {
      army[kind] = (army[kind] ?? 0) + march.troops[kind];
    }
    return { ...city, marches: city.marches.filter((item) => item.id !== march.id), army };
  }
  return { ...city, marches: city.marches.filter((item) => item.id !== march.id) };
}
