import type { FamousTileView } from '../api/protocol';
import { CITY_COPY } from '../copy-cities';

/** 名城说明（v24 AISLG-56）：一行摘要 = 名称 / 当前阶段 / 占领独占加成；外围恢复时限与打法提示放在悬停全文里，
 *  让玩家打之前就知道值不值，又不撑高右侧详情面板。 */
export function FamousCityNote({ famous }: { famous: FamousTileView }) {
  const outer = famous.stage === 'outer';
  const full = [
    CITY_COPY.famous.title(famous.name),
    outer ? CITY_COPY.famous.stageOuter : CITY_COPY.famous.stageKeeper,
    CITY_COPY.famous.bonus(famous.bonusPercent),
    famous.recoversAt ? CITY_COPY.famous.recoversAt(new Date(famous.recoversAt).toLocaleTimeString()) : null,
    outer ? CITY_COPY.famous.hintOuter : CITY_COPY.famous.hintKeeper,
  ]
    .filter(Boolean)
    .join('\n');
  return (
    <p role="世界地图详情区-名城说明" title={full} className="truncate rounded border border-gold/50 px-2 py-0.5 text-[11.5px] text-gold">
      {CITY_COPY.famous.title(famous.name)} · {outer ? CITY_COPY.famous.stageOuter : CITY_COPY.famous.stageKeeper} · {CITY_COPY.famous.bonus(famous.bonusPercent)}
    </p>
  );
}
