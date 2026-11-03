/** 产出图层（AISLG-216）：格子底部居中的「资源图标 + +N」（每小时），自己的地再叠一条 3px 储量条；
 *  视野缩到 15 格以上时格子太小，只留图标，数字放进悬浮提示。
 *  数据与档位判定在 yieldTable（纯函数），这里只管画。
 */

import { formatClock } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import { formatYieldRate, type ReserveTier, type YieldInfo } from './yieldTable';

/** 储量条 / 档位文字的颜色（充足绿、一般橙、枯竭红） */
export const RESERVE_TONE: Record<ReserveTier, string> = {
  ample: 'bg-st-online',
  normal: 'bg-warn',
  depleted: 'bg-st-error',
};

const TIER_TEXT: Record<ReserveTier, string> = {
  ample: 'text-st-online',
  normal: 'text-warn',
  depleted: 'text-st-error',
};

/** 是否显示产量数字：视野边长 ≥ 15 格（缩到 15×15～20×20）时只显示图标 */
export function showYieldNumber(win: { w: number; h: number }): boolean {
  return Math.max(win.w, win.h) < 15;
}

/** 本地时刻到分（HH:mm）：储量预计时刻只要时分 */
function clockHM(iso: string): string {
  return formatClock(iso).slice(0, 5);
}

export function TileYield({ info, showNumber }: { info: YieldInfo; showNumber: boolean }) {
  const Y = useCopy().EXTRA_MAP.yield;
  const glyph = Y.glyph[info.resource];
  const amount = formatYieldRate(info.rate);
  const depleted = info.tier === 'depleted';
  return (
    <>
      <span
        role="世界地图-产出"
        aria-label={Y.aria(glyph, amount)}
        title={`${Y.rate(amount)}${info.tier ? ` · ${Y.tier[info.tier]}` : ''}`}
        className={`pointer-events-none absolute inset-x-0 bottom-[3px] flex items-baseline justify-center gap-[1px] font-mono leading-none ${depleted ? 'text-dim' : 'text-fg'} text-[clamp(7px,1.1cqw,11px)]`}
      >
        <b className={`font-semibold ${depleted ? 'text-dim' : 'text-gold'}`}>{glyph}</b>
        {showNumber ? <span className="tabular-nums">{`+${amount}`}</span> : null}
      </span>
      {info.reservePct !== null ? (
        <span role="世界地图-储量条" aria-label={`${Math.round(info.reservePct * 100)}%`} className="absolute inset-x-0 bottom-0 h-[3px] overflow-hidden bg-line/60">
          <i className={`block h-full ${RESERVE_TONE[info.tier ?? 'ample']}`} style={{ width: `${Math.max(2, Math.round(info.reservePct * 100))}%` }} />
        </span>
      ) : null}
    </>
  );
}

/** 地块悬浮提示里的产出与储量三行（拿不到数值时只写档位） */
export function YieldTipLines({ info }: { info: YieldInfo }) {
  const Y = useCopy().EXTRA_MAP.yield;
  const amount = formatYieldRate(info.rate);
  const haveValue = info.reserve.current !== null && info.reserve.cap !== null;
  return (
    <div role="世界地图视野-产出提示" className="text-dim">
      <div>{Y.rate(amount)}</div>
      {info.tier ? (
        <div className={TIER_TEXT[info.tier]}>
          {Y.tier[info.tier]}
          {haveValue ? ` · ${Y.reserveValue(formatYieldRate(info.reserve.current ?? 0), formatYieldRate(info.reserve.cap ?? 0))}` : ''}
        </div>
      ) : null}
      {info.reserve.eta ? (
        // 只要时分（formatClock 带秒）：预计 HH:mm 采空 / 回满
        <div className="text-faint">{info.reserve.eta.kind === 'empty' ? Y.etaEmpty(clockHM(info.reserve.eta.at)) : Y.etaFull(clockHM(info.reserve.eta.at))}</div>
      ) : null}
      {info.tier === 'depleted' ? <div className="text-faint">{Y.depletedNote}</div> : null}
    </div>
  );
}