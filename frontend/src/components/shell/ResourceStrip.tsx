/** 顶栏资源条：金粮木石铁 + 人口六格。每格 = 存量、每小时净产量、离满仓百分比与细进度条；
 *  ≥ 90% 警示色（仓库快满，超出上限的产出作废）。粮的净产量 = 毛产量 − 全军耗粮。
 */

import { STORAGE_FULL_WARN_PERCENT, type CityView, type Resources } from '../../api/protocol';
import { compactNumber } from '../../api/format';
import { COPY, RESOURCE_LABEL } from '../../copy';
import { TOP_COPY } from '../../copy-ui';

const KEYS = Object.keys(RESOURCE_LABEL) as Array<keyof Resources>;
/** 进度条警示线：docs 第 3 节「≥90% 变警示色」 */
const ALERT_PERCENT = 90;

export function ResourceStrip({ city }: { city: CityView }) {
  return (
    <div role="顶栏-资源" className="grid min-w-0 flex-1 grid-cols-3 gap-1.5 lg:grid-cols-6">
      {KEYS.map((key) => {
        const cap = city.storage[key];
        const percent = cap > 0 ? Math.min(100, Math.floor((city.resources[key] / cap) * 100)) : 0;
        const net = key === 'food' ? city.production.food - city.armyFoodUsePerHour : city.production[key];
        const warn = percent >= ALERT_PERCENT;
        const label = RESOURCE_LABEL[key];
        const title =
          key !== 'gold' && percent >= STORAGE_FULL_WARN_PERCENT
            ? COPY.topbar.storageFullItem(label, percent, cap)
            : COPY.topbar.storageHint(label, cap);
        return (
          <div
            key={key}
            role={`顶栏-资源-${label}`}
            title={title}
            className={`min-w-0 rounded-[5px] border bg-panel-2 px-2 pb-1 pt-0.5 ${warn ? 'border-warn/50' : 'border-line-soft'}`}
          >
            <div className="flex items-baseline gap-1.5 whitespace-nowrap">
              <span className="text-[11px] text-faint">{label}</span>
              <span role={`顶栏-资源-${label}-存量`} className="font-mono text-[13px] tabular-nums">
                {compactNumber(city.resources[key])}
              </span>
            </div>
            <div className="flex items-baseline gap-1 whitespace-nowrap font-mono text-[10.5px] leading-tight tabular-nums">
              <span role={`顶栏-资源-${label}-产量`} className={net < 0 ? 'text-st-error' : 'text-ok'}>
                {TOP_COPY.net(net)}
              </span>
              <span className={`ml-auto max-xl:hidden ${warn ? 'text-warn' : 'text-faint'}`}>{percent}%</span>
            </div>
            <div className="mt-0.5 h-0.5 overflow-hidden rounded bg-line short:hidden">
              <i className={`block h-full ${warn ? 'bg-warn' : 'bg-accent-dim'}`} style={{ width: `${percent}%` }} />
            </div>
          </div>
        );
      })}
      <PopulationCell city={city} />
    </div>
  );
}

function PopulationCell({ city }: { city: CityView }) {
  const { current, cap, growthPerHour } = city.population;
  const percent = cap > 0 ? Math.min(100, Math.floor((current / cap) * 100)) : 0;
  return (
    <div
      role="顶栏-人口"
      title={COPY.topbar.population(current, cap, growthPerHour)}
      className="min-w-0 rounded-[5px] border border-line-soft bg-panel-2 px-2 pb-1 pt-0.5"
    >
      <div className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-[11px] text-faint">{TOP_COPY.popShort}</span>
        <span className="font-mono text-[13px] tabular-nums">{compactNumber(current)}</span>
      </div>
      <div className="flex items-baseline gap-1 whitespace-nowrap font-mono text-[10.5px] leading-tight tabular-nums text-faint">
        <span className="truncate">{TOP_COPY.popCap(cap)}</span>
      </div>
      <div className="mt-0.5 h-0.5 overflow-hidden rounded bg-line short:hidden">
        <i className="block h-full bg-accent-dim" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
