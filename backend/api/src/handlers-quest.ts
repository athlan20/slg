// 任务与签到（v56，AISLG-200）：GET_DAILY / CLAIM_DAILY / GET_SIGNIN / SIGNIN。
// 只读查询 + 领奖；规则与数值在 common/src/quest.ts（进程内共享），此处仅做参数与响应装配。
// 奖励发往主城（loadCityState 在无城池作用域时即主城）。

import { claimDaily, loadQuestState, QuestError, signin } from '../../common/src/quest';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { loadCityState } from './views';

/** GET_DAILY：今日 6 条任务进度 / 领取状态 + 签到状态 */
export async function handleGetDaily(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const quest = await loadQuestState(ctx.pool, accountId);
  respondOk(ctx.registry, conn, op, seq, { quest });
}

/** CLAIM_DAILY：领取一条已完成、未领取的任务奖励；回带最新任务状态与主城 */
export async function handleClaimDaily(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const taskId = readString(data, 'taskId');
  if (taskId === null || taskId.length < 1) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  try {
    const { reward } = await claimDaily(ctx.pool, accountId, taskId);
    const quest = await loadQuestState(ctx.pool, accountId);
    const city = await loadCityState(ctx.pool, accountId);
    respondOk(ctx.registry, conn, op, seq, { quest, granted: reward, city });
  } catch (err) {
    if (err instanceof QuestError) {
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    throw err;
  }
}

/** GET_SIGNIN：仅签到状态 */
export async function handleGetSignin(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const { signin: view } = await loadQuestState(ctx.pool, accountId);
  respondOk(ctx.registry, conn, op, seq, { signin: view });
}

/** SIGNIN：每日签到；回带最新签到状态、档位与主城 */
export async function handleSignin(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  try {
    const { tier, reward } = await signin(ctx.pool, accountId);
    const { signin: view } = await loadQuestState(ctx.pool, accountId);
    const city = await loadCityState(ctx.pool, accountId);
    respondOk(ctx.registry, conn, op, seq, { signin: view, tier, granted: reward, city });
  } catch (err) {
    if (err instanceof QuestError) {
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    throw err;
  }
}
