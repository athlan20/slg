/** 截击表单（v28 AISLG-78；v35 AISLG-112 到了先埋伏）：选中的格恰好在某个移动目标（流寇 / 运粮商队）尚未过去的路线上时出现。
 *  多个目标经过同一格时单选；按当前编队给「立即接战 / 将埋伏约 X、预计 hh:mm 接战 / 赶不上」判断，
 *  并提供「推荐截击格」一键换格。判断口径见 state/interceptPlan。
 */

import { useMemo, useState } from 'react';
import { INTERCEPT_REACH } from '../../../api/protocol';
import { formatClock } from '../../../api/format';
import { carryBonusPercent, marchBonusPercent, marchTravelSeconds } from '../../../api/marchPlan';
import { useCopy } from '../../../i18n/bundle';
import { tName } from '../../../i18n/names';
import { useDeployBlockedText } from '../../../state/deployContext';
import { interceptVerdict, recommendCell, type InterceptCandidate } from '../../../state/interceptPlan';
import { ConfirmButton } from './ConfirmButton';
import type { TargetCtx } from './targetTypes';
import { TroopPicker, troopTotal } from './TroopPicker';

interface InterceptFormProps {
  ctx: TargetCtx;
  candidates: InterceptCandidate[];
  /** 推荐截击格一键选中（切换面板选中的地块） */
  onPickCell: (x: number, y: number) => void;
}

export function InterceptForm({ ctx, candidates, onPickCell }: InterceptFormProps) {
  const copy = useCopy();
  const { COPY, MOVING_COPY, DEFENSE_COPY } = copy;
  const { world, city, x, y, origin, hero, now, troops, setTroops, busy, run } = ctx;
  const [pickedId, setPickedId] = useState<string | null>(null);
  const deployBlocked = useDeployBlockedText(DEFENSE_COPY.deploy.full);
  const picked = candidates.find((item) => item.target.id === pickedId) ?? candidates[0];
  const total = troopTotal(troops);

  // 到达预估：按当前编队与出发城距离折算；未编队 / 无坐标不给判断
  const etaSeconds = origin && total > 0 ? marchTravelSeconds(origin.x, origin.y, x, y, troops, city.timeScale, marchBonusPercent(city.techs)) : null;
  const arriveMs = etaSeconds !== null ? now + etaSeconds * 1000 : null;
  const verdict = interceptVerdict(picked.target, x, y, now, arriveMs);
  const recommend = useMemo(() => recommendCell(picked.target, origin, troops, city, now), [picked.target, origin, troops, city, now]);
  const showRecommend = recommend !== null && !(recommend.x === x && recommend.y === y);

  return (
    <div role="世界地图详情区-截击表单" className="flex min-h-0 flex-1 flex-col gap-1.5">
      <p className="line-clamp-2 text-[11.5px] text-faint" title={MOVING_COPY.intercept.hint(INTERCEPT_REACH)}>
        {MOVING_COPY.intercept.hint(INTERCEPT_REACH)}
      </p>
      <div role="截击表单-目标选择" className="flex flex-col gap-0.5">
        {candidates.map(({ target, index }) => (
          <label key={target.id} className="flex cursor-pointer items-center gap-1.5 truncate text-[12px] text-dim">
            <input role="截击表单-目标单选" type="radio" name="intercept-target" checked={picked.target.id === target.id} onChange={() => setPickedId(target.id)} />
            <span className="truncate">{MOVING_COPY.intercept.passAt(tName(target.label), target.level, formatClock(target.route[index].at))}</span>
          </label>
        ))}
      </div>
      {arriveMs !== null ? (
        <p role="截击表单-到达预估" className="truncate font-mono text-[11.5px] text-faint">
          {MOVING_COPY.intercept.etaLine(formatClock(new Date(arriveMs).toISOString()), formatClock(picked.target.route[picked.index].at))}
        </p>
      ) : null}
      {verdict ? (
        <p role="截击表单-接战判断" className={`line-clamp-2 text-[12px] ${verdict.tone === 'ok' ? 'text-ok' : 'text-warn'}`} title={verdict.text}>
          {verdict.text}
        </p>
      ) : null}
      {showRecommend && recommend ? (
        <button
          type="button"
          role="截击表单-推荐截击格"
          onClick={() => onPickCell(recommend.x, recommend.y)}
          className="cursor-pointer truncate rounded border border-gold/50 px-2 py-0.5 text-left text-[12px] text-gold hover:bg-gold/10"
        >
          {MOVING_COPY.intercept.recommend(recommend.x, recommend.y, formatClock(new Date(recommend.engageMs).toISOString()))}
        </button>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <TroopPicker army={city.army} value={troops} onChange={setTroops} showCarry carryBonusPercent={carryBonusPercent(city.techs)} etaSeconds={etaSeconds} />
      </div>
      <ConfirmButton
        label={MOVING_COPY.intercept.submit}
        busy={busy}
        disabledReason={deployBlocked ?? (total <= 0 ? COPY.worldMap.troopPickHint : null)}
        onClick={() =>
          void run(async () => {
            const ok = await world.march(x, y, troops, undefined, undefined, picked.target.id, hero?.selectedHeroId ?? null);
            if (ok) {
              setTroops({});
              hero?.afterMarch();
            }
          })
        }
      />
    </div>
  );
}
