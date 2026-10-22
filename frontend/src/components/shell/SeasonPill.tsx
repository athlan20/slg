/** 顶栏赛季胶囊（v65，AISLG-134）：常驻「S2 · 剩 18 天」；剩余 ≤ 3 天改用警报色并显示天 + 时分秒。
 *  宽屏（≥1280）用长写法，1280 以下（图标栏 / 手机）用短写法「S2·18天」。倒计时按现实时间，不受 timeScale 影响。
 */

import { formatReportTime } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import type { SeasonInfo } from '../../state/seasonSession';
import { useNow } from '../../state/useNow';

const URGENT_MS = 3 * 86_400_000;
const pill = 'inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] tabular-nums';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

interface SeasonPillProps {
  info: SeasonInfo | null;
}

export function SeasonPill({ info }: SeasonPillProps) {
  const { SEASON_COPY: COPY } = useCopy();
  const now = useNow(info !== null);
  if (info === null) {
    return null;
  }
  const remainMs = Date.parse(info.endsAt) - now;
  if (!Number.isFinite(remainMs)) {
    return null;
  }
  const id = info.id;
  const remainSec = Math.max(0, Math.floor(remainMs / 1000));
  const days = Math.floor(remainSec / 86_400);
  const clock = `${pad(Math.floor((remainSec % 86_400) / 3600))}:${pad(Math.floor((remainSec % 3600) / 60))}:${pad(remainSec % 60)}`;
  const urgent = remainMs <= URGENT_MS;

  let longText: string;
  let shortText: string;
  if (remainMs <= 0) {
    longText = COPY.ending(id);
    shortText = COPY.ending(id);
  } else if (urgent) {
    longText = COPY.urgentLong(id, days, clock);
    shortText = COPY.urgentShort(id, days, clock);
  } else {
    longText = COPY.pillLong(id, days);
    shortText = COPY.pillShort(id, days);
  }

  return (
    <span
      role="导航-赛季倒计时"
      title={COPY.pillTitle(id, formatReportTime(info.endsAt))}
      className={`${pill} ${urgent ? 'border-warn text-warn' : 'border-line bg-panel-2 text-dim'}`}
    >
      <span className="max-xl:hidden">{longText}</span>
      <span className="hidden max-xl:inline">{shortText}</span>
    </span>
  );
}
