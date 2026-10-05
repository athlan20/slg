/** 流寇与商队列表（v28 AISLG-78，地图页右栏未选中时）：种类 / 等级 / 现在所在格 / 还有多久消失 / 守军与携带量范围，
 *  分页（行定高、文本截断）。点「定位」把地图移到它当前所在格并选中（出现截击表单）；路线与时刻表在地图上点路线格查看。
 */

import { movingIndexAt, type MovingTargetView } from '../../api/protocol';
import { formatDurationText } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import { tName } from '../../i18n/names';
import { useNow } from '../../state/useNow';
import type { WorldSession } from '../../state/worldSession';
import { PagedList } from '../ui/PagedList';

export function MovingTargetList({ targets, world }: { targets: MovingTargetView[]; world: WorldSession }) {
  const copy = useCopy();
  const { MOVING_COPY } = copy;
  const now = useNow(targets.length > 0);
  const alive = targets.filter((target) => now < Date.parse(target.endsAt));

  return (
    <PagedList
      role="左列-流寇与商队"
      items={alive}
      keyOf={(target) => target.id}
      empty={
        <p role="左列-流寇与商队-空态" className="py-2 text-[12px] text-faint" title={MOVING_COPY.panel.hint}>
          {MOVING_COPY.panel.empty}
        </p>
      }
      renderRow={(target) => {
        const index = movingIndexAt(target, now);
        const cell = index === null ? null : target.route[index];
        return (
          <div
            role="左列-流寇与商队-条目"
            title={`${target.kind === 'bandit' ? MOVING_COPY.panel.banditNote : MOVING_COPY.panel.caravanNote}\n${MOVING_COPY.panel.hint}`}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-1"
          >
            <span className="min-w-0">
              <b className={`block truncate text-[12px] font-semibold ${target.kind === 'bandit' ? 'text-warn' : 'text-gold'}`}>
                {MOVING_COPY.panel.row(tName(target.label), target.level)}
                <span className="ml-1.5 font-mono text-[11px] font-normal text-faint">
                  {MOVING_COPY.panel.leaves(formatDurationText(Math.max(0, Math.ceil((Date.parse(target.endsAt) - now) / 1000))))}
                </span>
              </b>
              <small className="block truncate font-mono text-[11px] text-faint">
                {cell ? `${MOVING_COPY.panel.nowAt(cell.x, cell.y)} · ` : ''}
                {MOVING_COPY.panel.strength(target.garrisonTotal.min, target.garrisonTotal.max)} · {MOVING_COPY.panel.loot(target.stockTotal.min, target.stockTotal.max)}
              </small>
            </span>
            {cell ? (
              <button
                type="button"
                role="左列-流寇与商队-定位"
                className="btn"
                onClick={() => {
                  world.centerOn(cell.x, cell.y);
                  world.selectTile(cell.x, cell.y);
                }}
              >
                {MOVING_COPY.panel.locate}
              </button>
            ) : null}
          </div>
        );
      }}
    />
  );
}
