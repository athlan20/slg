/** 侦察表单（v13；v36 起可带将）：斥候数量 + 随队将领 + 耗时预估。任意非本账号城池的地块可侦察；
 *  没有斥候时说明原因（去征兵）。在外部队已达上限时侦察同样占一支部队，按钮禁用。
 */

import { useMemo, useState } from 'react';
import { formatDurationText } from '../../../api/format';
import { marchBonusPercent, marchTravelSeconds } from '../../../api/marchPlan';
import { COPY } from '../../../copy';
import { DEFENSE_COPY } from '../../../copy-defense';
import { useDeployBlockedText } from '../../../state/deployContext';
import { HeroPicker } from '../../HeroPicker';
import { ConfirmButton } from './ConfirmButton';
import type { TargetCtx } from './targetTypes';

export function ScoutForm({ ctx }: { ctx: TargetCtx }) {
  const { world, city, x, y, origin, hero, busy, run } = ctx;
  const [count, setCount] = useState(1);
  const deployBlocked = useDeployBlockedText(DEFENSE_COPY.deploy.full);
  const have = city.army.scout ?? 0;
  const eta = useMemo(
    () => (origin && count > 0 ? marchTravelSeconds(origin.x, origin.y, x, y, { scout: count }, city.timeScale, marchBonusPercent(city.techs)) : null),
    [origin, x, y, count, city.timeScale, city.techs],
  );

  if (have <= 0) {
    return (
      <p role="世界地图详情区-侦察表单" className="text-[12px] text-faint">
        {COPY.worldMap.scoutNoScout}
      </p>
    );
  }
  return (
    <div role="世界地图详情区-侦察表单" className="flex min-h-0 flex-1 flex-col gap-1.5">
      <p className="line-clamp-2 text-[11.5px] text-faint" title={COPY.worldMap.scoutHint}>
        {COPY.worldMap.scoutHint}
      </p>
      <div className="flex-1">
        <HeroPicker troopTotal={count} />
        <label className="mt-1.5 flex items-center justify-between gap-2 text-[12px] text-dim">
          <span className="truncate">{COPY.worldMap.scoutCountLabel(have)}</span>
          <span className="flex shrink-0 items-center gap-2">
            {eta !== null ? (
              <span role="世界地图详情区-侦察耗时预估" className="font-mono text-[11.5px] text-faint">
                {COPY.worldMap.etaLine(formatDurationText(eta))}
              </span>
            ) : null}
            <input
              role="世界地图详情区-侦察数量输入"
              type="number"
              min={1}
              max={have}
              value={count}
              onChange={(event) => {
                const raw = Number(event.target.value);
                setCount(Number.isFinite(raw) ? Math.min(Math.max(1, Math.floor(raw)), have) : 1);
              }}
              className="w-14 rounded border border-line bg-bg px-1 py-0.5 text-right font-mono text-[12px]"
            />
          </span>
        </label>
      </div>
      <ConfirmButton
        role="世界地图详情区-侦察按钮"
        label={COPY.worldMap.scoutSubmit}
        busy={busy}
        disabledReason={deployBlocked}
        onClick={() =>
          void run(async () => {
            const ok = await world.scout(x, y, count, hero?.selectedHeroId ?? null);
            if (ok) {
              hero?.afterMarch();
            }
          })
        }
      />
    </div>
  );
}
