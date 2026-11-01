// 城池信息里的计谋显示（v86，AISLG-211）：自己城生效中的「草木皆兵 / 空城计 · 剩余时间」、
// 十面埋伏锁城（出兵按钮据此置灰）、趁火打劫的仓库保护降低。
// 数据来自 GET_STATE 的 city.stratagems（倍数只对城主自己可见）。

import type { CityView } from '../../api/protocol';
import { formatDurationText } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import { useNow } from '../../state/useNow';

/** 剩余秒数（已过期 / 无值返回 0） */
export function remainingSeconds(until: string | null | undefined, now: number): number {
  if (!until) {
    return 0;
  }
  return Math.max(0, Math.ceil((Date.parse(until) - now) / 1000));
}

export function StratagemCityNote({ city }: { city: CityView }) {
  const copy = useCopy();
  const { STRATAGEM_COPY } = copy;
  const stratagems = city.stratagems ?? null;
  const active = stratagems !== null && (stratagems.deception !== null || stratagems.ambushedUntil !== null || stratagems.lootFireUntil !== null);
  const now = useNow(active);
  if (!stratagems) {
    return null;
  }
  const deceptionLeft = stratagems.deception ? remainingSeconds(stratagems.deception.until, now) : 0;
  const ambushLeft = remainingSeconds(stratagems.ambushedUntil, now);
  const lootFireLeft = remainingSeconds(stratagems.lootFireUntil, now);
  if (deceptionLeft <= 0 && ambushLeft <= 0 && lootFireLeft <= 0) {
    return null;
  }
  return (
    <div role="城池页-概况-计谋" className="mb-1.5 flex flex-col gap-0.5">
      {deceptionLeft > 0 && stratagems.deception ? (
        <p
          role="城池页-概况-欺敌"
          className="truncate rounded border border-accent/50 px-2 py-0.5 text-[11.5px] text-accent"
          title={STRATAGEM_COPY.city.deceptionHint}
        >
          {STRATAGEM_COPY.city.deception(stratagems.deception.name, formatDurationText(deceptionLeft))}
        </p>
      ) : null}
      {ambushLeft > 0 ? (
        <p role="城池页-概况-十面埋伏" className="truncate rounded border border-warn/60 px-2 py-0.5 text-[11.5px] text-warn">
          {STRATAGEM_COPY.city.ambushed(formatDurationText(ambushLeft))}
        </p>
      ) : null}
      {lootFireLeft > 0 ? (
        <p role="城池页-概况-趁火打劫" className="truncate rounded border border-warn/40 px-2 py-0.5 text-[11.5px] text-warn">
          {STRATAGEM_COPY.city.lootFire(stratagems.lootFirePercent, formatDurationText(lootFireLeft))}
        </p>
      ) : null}
    </div>
  );
}
