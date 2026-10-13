// 任务与活动二期/三期（v56，AISLG-200）：GET_QUESTS / CLAIM_QUEST / GET_ACTIVITIES / CLAIM_ACTIVITY。
// 只读查询 + 领奖；规则与定义在 common/src/quests.ts，此处仅做参数与响应装配。奖励发往主城。

import { claimActivity, claimQuest, loadActivitiesView, loadQuestsView, QuestError } from '../../common/src/quests';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { loadCityState } from './views';

/** GET_QUESTS：主线 / 支线任务 + 成就 */
export async function handleGetQuests(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const quests = await loadQuestsView(ctx.pool, accountId);
  respondOk(ctx.registry, conn, op, seq, { ...quests });
}

/** CLAIM_QUEST：领取主线 / 支线 / 成就奖励（data.kind + data.id） */
export async function handleClaimQuest(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const kind = readString(data, 'kind');
  const id = readString(data, 'id');
  if (!kind || !id) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  try {
    const { reward } = await claimQuest(ctx.pool, accountId, kind, id);
    const quests = await loadQuestsView(ctx.pool, accountId);
    const city = await loadCityState(ctx.pool, accountId);
    respondOk(ctx.registry, conn, op, seq, { quests, granted: reward, city });
  } catch (err) {
    if (err instanceof QuestError) {
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    throw err;
  }
}

/** GET_ACTIVITIES：活动状态（开服冲刺 + 每日活跃） */
export async function handleGetActivities(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const activities = await loadActivitiesView(ctx.pool, accountId);
  respondOk(ctx.registry, conn, op, seq, { activities });
}

/** CLAIM_ACTIVITY：领取活动某一档奖励（data.id = 阶梯 id） */
export async function handleClaimActivity(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const id = readString(data, 'id');
  if (!id) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  try {
    const { reward } = await claimActivity(ctx.pool, accountId, id);
    const activities = await loadActivitiesView(ctx.pool, accountId);
    const city = await loadCityState(ctx.pool, accountId);
    respondOk(ctx.registry, conn, op, seq, { activities, granted: reward, city });
  } catch (err) {
    if (err instanceof QuestError) {
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    throw err;
  }
}
