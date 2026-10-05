/** 兵力与人口概览（总览页左下）：总兵力 / 综合战力 / 人口 / 守城加成四个数，11 个兵种的「城内 / 在外」一览。
 *  只读摘要，点击进军队页征兵 / 调度。 */

import { TROOP_KINDS, TROOP_POWER, type TroopKind } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { useNav } from '../../state/NavContext';
import { activeMarches } from '../../state/progressItems';
import { Card } from '../ui/Card';

export function ArmyOverviewCard() {
  const copy = useCopy();
  const { COPY, DEFENSE_COPY, OVERVIEW_COPY, TROOP_LABEL } = copy;
  const { session } = useGame();
  const { go } = useNav();
  const city = session.city;

  const out: Partial<Record<TroopKind, number>> = {};
  for (const march of city ? activeMarches(city) : []) {
    for (const kind of TROOP_KINDS) {
      out[kind] = (out[kind] ?? 0) + (march.troops[kind] ?? 0);
    }
  }
  const home = (kind: TroopKind) => city?.army[kind] ?? 0;
  const total = TROOP_KINDS.reduce((sum, kind) => sum + home(kind) + (out[kind] ?? 0), 0);
  const power = TROOP_KINDS.reduce((sum, kind) => sum + home(kind) * TROOP_POWER[kind], 0);
  const stats: Array<[string, string]> = city
    ? [
        [OVERVIEW_COPY.totalTroops, total.toLocaleString('en-US')],
        [OVERVIEW_COPY.power, power.toLocaleString('en-US')],
        [OVERVIEW_COPY.population, `${city.population.current.toLocaleString('en-US')} / ${city.population.cap.toLocaleString('en-US')}`],
        [OVERVIEW_COPY.defense, `+${city.defenseBonus}%`],
      ]
    : [];

  return (
    <Card
      role="总览页-兵力概览"
      title={OVERVIEW_COPY.armyTitle}
      meta={city ? DEFENSE_COPY.deploy.meta(city.deploy.count, city.deploy.limit) : undefined}
      actions={
        <button type="button" role="总览页-去军队" onClick={() => go('army')} className="ml-1 cursor-pointer text-[11.5px] text-accent hover:underline">
          {OVERVIEW_COPY.goArmy}
        </button>
      }
    >
      <div role="总览页-兵力概览-数据" className="grid shrink-0 grid-cols-4 gap-1.5 max-sm:grid-cols-2">
        {stats.map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-0.5">
            <span className="block text-[10.5px] text-faint">{label}</span>
            <b className="block truncate font-mono text-[12.5px] font-medium tabular-nums" title={value}>
              {value}
            </b>
          </div>
        ))}
      </div>
      <div role="总览页-兵种一览" className="grid min-h-0 flex-1 grid-cols-4 content-start gap-1.5 overflow-hidden max-sm:grid-cols-3">
        {TROOP_KINDS.map((kind) => {
          const idle = home(kind) + (out[kind] ?? 0) === 0;
          return (
            <div
              key={kind}
              title={`${TROOP_LABEL[kind].name}：${OVERVIEW_COPY.home} ${home(kind)} · ${OVERVIEW_COPY.out} ${out[kind] ?? 0}`}
              className={`min-w-0 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-0.5 ${idle ? 'opacity-50' : ''}`}
            >
              <span className="block truncate text-[11.5px] text-dim">{TROOP_LABEL[kind].name}</span>
              <span className="block truncate font-mono text-[11.5px] tabular-nums">
                {home(kind)}
                <span className="text-faint"> / {out[kind] ?? 0}</span>
              </span>
            </div>
          );
        })}
      </div>
      <p className="shrink-0 text-[10.5px] text-faint">{COPY.recruitPanel.armyLabel}：{OVERVIEW_COPY.homeOutHint}</p>
    </Card>
  );
}
