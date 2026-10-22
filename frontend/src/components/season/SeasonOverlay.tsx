/** 换季遮罩与新赛季提示（v65，AISLG-134）：换季维护 / 等待重连期间盖住整屏，不让操作落在过期的世界上；
 *  重连完成（新赛季的状态已重拉）后收起，并弹一次「新赛季开始」的小提示。
 */

import { useEffect, useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import type { SeasonSession } from '../../state/seasonSession';

const TOAST_MS = 4000;

export function SeasonOverlay({ season }: { season: SeasonSession }) {
  const { SEASON_COPY: COPY } = useCopy();
  const [toastOn, setToastOn] = useState(false);
  const toastKey = season.startedToast;

  useEffect(() => {
    if (toastKey === 0) {
      return undefined;
    }
    setToastOn(true);
    const timer = window.setTimeout(() => setToastOn(false), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toastKey]);

  return (
    <>
      {season.masked ? (
        <div role="换季遮罩" className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-6">
          <div role="换季遮罩-面板" className="flex w-full max-w-sm flex-col gap-2 rounded-lg border border-line bg-panel p-5 text-center">
            <h2 className="text-[16px] font-semibold">{COPY.maskTitle}</h2>
            <p className="text-[13px] leading-relaxed text-dim">{season.maintenance ? COPY.maskHint : COPY.maskRetry}</p>
          </div>
        </div>
      ) : null}
      {toastOn ? (
        <div
          role="换季提示-新赛季开始"
          className="fixed bottom-4 left-1/2 z-[58] -translate-x-1/2 rounded-full border border-accent-dim bg-panel px-4 py-1.5 text-[13px] text-accent shadow-lg"
        >
          {COPY.startedToast}
        </div>
      ) : null}
    </>
  );
}
