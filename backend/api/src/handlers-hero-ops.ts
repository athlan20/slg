// 武将培养与结交的协议路由（v54，AISLG-144）：把 77–82 号协议分派到 handlers-hero-growth.ts（加点 / 洗点 /
// 历练 / 赏赐）与 handlers-hero-friendship.ts（结交 / 招揽）。从 handlers.ts 拆出以控制单文件行数。

import { Op } from '../../common/src/protocol';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { handleAllocateHeroPoints, handleCancelTraining, handleGiftHero, handleResetHeroPoints, handleTrainHero } from './handlers-hero-growth';
import { handleBefriendHero, handleRecruitFamousHero } from './handlers-hero-friendship';

export async function routeHeroGrowthOp(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  switch (op) {
    case Op.ALLOCATE_HERO_POINTS:
      return handleAllocateHeroPoints(ctx, conn, op, seq, data);
    case Op.RESET_HERO_POINTS:
      return handleResetHeroPoints(ctx, conn, op, seq, data);
    case Op.TRAIN_HERO:
      return handleTrainHero(ctx, conn, op, seq, data);
    case Op.CANCEL_TRAINING:
      return handleCancelTraining(ctx, conn, op, seq, data);
    case Op.GIFT_HERO:
      return handleGiftHero(ctx, conn, op, seq, data);
    case Op.BEFRIEND_HERO:
      return handleBefriendHero(ctx, conn, op, seq, data);
    case Op.RECRUIT_FAMOUS_HERO:
      return handleRecruitFamousHero(ctx, conn, op, seq, data);
    default:
      return;
  }
}
