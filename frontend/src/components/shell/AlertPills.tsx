/** 顶栏警报胶囊：NPC 来袭（红色闪烁倒计时，点开来袭提醒）/ 断粮倒计时 / 免战倒计时；没有就不显示。
 *  1024–1279 隐藏断粮 / 免战胶囊（总览军情里有），< 1024 整组隐藏（docs 第 3 节断点）。
 */

import type { NpcAttackWarningPushData } from '../../api/protocol';
import type { CityView } from '../../api/protocol';
import { formatDurationText } from '../../api/format';
import { COPY } from '../../copy';
import { STARVE_COPY } from '../../copy-starvation';
import { TOP_COPY } from '../../copy-ui';
import { useNow } from '../../state/useNow';

interface AlertPillsProps {
  city: CityView | null;
  incoming: NpcAttackWarningPushData[];
  onOpenWarning: () => void;
}

const pill = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px]';

export function AlertPills({ city, incoming, onOpenWarning }: AlertPillsProps) {
  const truceDeadline = city?.truceUntil ? Date.parse(city.truceUntil) : NaN;
  const starveAt = city?.starveAt ?? null;
  const mutinyNextAt = city?.mutinyNextAt ?? null;
  const active = incoming.length > 0 || Number.isFinite(truceDeadline) || starveAt !== null || mutinyNextAt !== null;
  const now = useNow(active);

  const first = incoming[0];
  const truceLeft = Number.isFinite(truceDeadline) ? truceDeadline - now : 0;
  const leadMs = 3_600_000 / Math.max(1, city?.timeScale ?? 1);
  let starve: string | null = null;
  if (mutinyNextAt !== null) {
    starve = STARVE_COPY.starving(formatDurationText(Math.max(0, Math.ceil((Date.parse(mutinyNextAt) - now) / 1000))));
  } else if (starveAt !== null && Date.parse(starveAt) - now <= leadMs) {
    starve = STARVE_COPY.soon(formatDurationText(Math.max(0, Math.ceil((Date.parse(starveAt) - now) / 1000))));
  }

  return (
    <div role="导航-警报" className="flex shrink-0 items-center gap-1.5 max-lg:hidden">
      {first ? (
        <button
          type="button"
          role="警报-NPC来袭"
          title={first.attacker ? COPY.npcWarning.titlePlayer : COPY.npcWarning.title}
          onClick={onOpenWarning}
          className={`${pill} animate-pulse cursor-pointer border-st-error bg-st-error/10 text-st-error`}
        >
          ⚠ {(first.attacker ? TOP_COPY.alertPlayer : TOP_COPY.alertNpc)(first.target === 'city' ? TOP_COPY.alertNpcCity : `(${first.x},${first.y})`)}
          {incoming.length > 1 ? ` ×${incoming.length}` : ''}
          <b className="font-mono tabular-nums">{formatDurationText(Math.max(0, Math.ceil((Date.parse(first.arriveAt) - now) / 1000)))}</b>
        </button>
      ) : null}
      {starve ? (
        <span role="警报-断粮" title={STARVE_COPY.hint} className={`${pill} border-warn text-warn max-xl:hidden`}>
          {starve}
        </span>
      ) : null}
      {truceLeft > 0 ? (
        <span role="警报-免战" title={COPY.topbar.truceHint} className={`${pill} border-line bg-panel-2 text-ok max-xl:hidden`}>
          {TOP_COPY.alertTruce(formatDurationText(Math.ceil(truceLeft / 1000)))}
        </span>
      ) : null}
    </div>
  );
}
