/** 城池概况（城池页左下，只读）：五种资源的存量 / 上限与每小时净产、人口、在外部队、守城加成。
 *  建造 / 升级前看一眼就知道缺什么、仓满没有。 */

import { type Resources } from '../../api/protocol';
import { compactNumber } from '../../api/format';
import { useCopy } from '../../i18n/bundle';
import type { CityView } from '../../api/protocol';
import { Card } from '../ui/Card';
import { PagedList } from '../ui/PagedList';

export function CityStatsCard({ city }: { city: CityView | null }) {
  const copy = useCopy();
  const { CITY_PAGE_COPY, RESOURCE_LABEL } = copy;
  // 资源遍历顺序来自文案包的资源键（各语言一致）
  const KEYS = Object.keys(RESOURCE_LABEL) as Array<keyof Resources>;
  const tiles: Array<{ key: string; label: string; value: string; sub: string; warn?: boolean }> = [];
  if (city) {
    for (const key of KEYS) {
      const cap = city.storage[key];
      const percent = cap > 0 ? Math.floor((city.resources[key] / cap) * 100) : 0;
      const net = key === 'food' ? city.production.food - city.armyFoodUsePerHour : city.production[key];
      tiles.push({
        key,
        label: RESOURCE_LABEL[key],
        value: `${compactNumber(city.resources[key])} / ${compactNumber(cap)}`,
        sub: `${net >= 0 ? '+' : ''}${net}/h · ${percent}%`,
        warn: net < 0 || (key !== 'gold' && percent >= 90),
      });
    }
    tiles.push(
      { key: 'pop', label: CITY_PAGE_COPY.statPopulation, value: `${compactNumber(city.population.current)} / ${compactNumber(city.population.cap)}`, sub: `+${city.population.growthPerHour}/h` },
      { key: 'deploy', label: CITY_PAGE_COPY.statDeploy, value: `${city.deploy.count} / ${city.deploy.limit}`, sub: CITY_PAGE_COPY.statDeploySub },
      { key: 'def', label: CITY_PAGE_COPY.statDefense, value: `+${city.defenseBonus}%`, sub: CITY_PAGE_COPY.statDefenseSub },
    );
  }
  // 每行 4 格，分页：高度不够时翻页，不裁切
  const rows: Array<typeof tiles> = [];
  for (let i = 0; i < tiles.length; i += 4) {
    rows.push(tiles.slice(i, i + 4));
  }
  return (
    <Card role="城池页-概况" title={CITY_PAGE_COPY.statsTitle}>
      <PagedList
        role="城池页-概况-列表"
        items={rows}
        keyOf={(_, index) => index}
        gap={6}
        gapClass="gap-1.5"
        renderRow={(row) => (
          <div className="grid grid-cols-4 gap-1.5">
            {row.map((tile) => (
              <div key={tile.key} className="min-w-0 rounded-[5px] border border-line-soft bg-panel-2 px-2 py-0.5">
                <span className="block text-[10.5px] text-faint">{tile.label}</span>
                <b className="block truncate font-mono text-[12.5px] font-medium tabular-nums" title={tile.value}>
                  {tile.value}
                </b>
                <span className={`block truncate font-mono text-[10.5px] compact:hidden ${tile.warn ? 'text-warn' : 'text-faint'}`}>{tile.sub}</span>
              </div>
            ))}
          </div>
        )}
      />
    </Card>
  );
}
