/** 撤回驻军：本账号占领的野地。驻军返回出发城并放弃占领，确认后才执行。 */

import { useCopy } from '../../../i18n/bundle';
import { ConfirmButton } from './ConfirmButton';
import type { TargetCtx } from './targetTypes';

export function RecallForm({ ctx }: { ctx: TargetCtx }) {
  const copy = useCopy();
  const { COPY, TARGET_COPY } = copy;
  const { world, x, y, busy, run } = ctx;
  return (
    <div role="世界地图详情区-召回" className="flex min-h-0 flex-1 flex-col gap-1.5">
      <p className="text-[12px] text-faint">{COPY.worldMap.recallHint || TARGET_COPY.recallHint}</p>
      <div className="flex-1" />
      <ConfirmButton
        role="世界地图详情区-召回按钮"
        label={COPY.worldMap.recallSubmit}
        busy={busy}
        tone="warn"
        onClick={() => void run(() => world.recall(x, y))}
      />
    </div>
  );
}
