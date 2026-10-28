/** 城池下拉（侧栏与手机顶栏共用，AISLG-191 从 Sidebar 抽出）：全部城池（名字 / 等级 / 主城·分城 / 坐标），
 *  当前城打勾，底部给分城名额。定位与显隐由调用方通过 className / style 决定（桌面侧栏 absolute，手机顶栏 fixed）。
 *  每行右侧的「定位」（AISLG-203）：地图居中并选中该城所在格、切到地图页，不切换当前城池；有坐标的城才显示。
 */

import type { CSSProperties } from 'react';
import { useCopy } from '../../i18n/bundle';
import { tName } from '../../i18n/names';
import type { CityList } from '../../state/useCityList';
import { useMapJump } from '../chat/useMapJump';

interface CityMenuProps {
  cityList: CityList;
  onChoose: (cityId: string) => void;
  /** 点「定位」后调用，由调用方收起下拉 */
  onLocate: () => void;
  /** 定位与显隐类，例如侧栏 `absolute z-30 left-1 top-[52px] max-lg:hidden` */
  className: string;
  style?: CSSProperties;
}

export function CityMenu({ cityList, onChoose, onLocate, className, style }: CityMenuProps) {
  const copy = useCopy();
  const { CITY_COPY, NAV_COPY } = copy;
  const { cities, activeCityId, branch } = cityList;
  const jumpToMap = useMapJump();
  return (
    <div
      role="导航-城池下拉"
      style={style}
      className={`flex min-w-[200px] max-w-[320px] flex-col rounded-md border border-line bg-panel-2 p-1 shadow-2xl ${className}`}
    >
      {cities.map((item) => {
        const active = item.id === activeCityId;
        const x = item.x;
        const y = item.y;
        return (
          <div key={item.id} role="城池下拉-行" className="flex items-stretch gap-1">
            <button
              type="button"
              role="城池下拉-城池"
              title={CITY_COPY.switcher.tabTitle(tName(item.name), item.level, x, y)}
              onClick={() => onChoose(item.id)}
              className={`flex min-w-0 flex-1 cursor-pointer items-baseline justify-between gap-3 rounded px-2.5 py-1.5 text-left text-[12.5px] hover:bg-accent-soft max-lg:min-h-10 ${
                active ? 'text-accent' : ''
              }`}
            >
              <span className="min-w-0 truncate">
                {active ? '✓ ' : ''}
                {tName(item.name)}{' '}
                <small className="text-faint">
                  {CITY_COPY.switcher.levelTag(item.level)} · {item.isMain ? NAV_COPY.cityMain : NAV_COPY.cityBranch}
                </small>
              </span>
              <span className="shrink-0 font-mono text-[11px] text-faint">{x !== null && y !== null ? `${x},${y}` : ''}</span>
            </button>
            {x !== null && y !== null ? (
              <button
                type="button"
                role="城池下拉-定位"
                title={CITY_COPY.switcher.locate}
                onClick={() => {
                  onLocate();
                  jumpToMap(x, y);
                }}
                className="shrink-0 cursor-pointer self-center rounded border border-line px-2 py-0.5 text-[11px] text-dim hover:border-accent hover:text-accent max-lg:min-h-10 max-lg:px-3"
              >
                {CITY_COPY.switcher.locate}
              </button>
            ) : null}
          </div>
        );
      })}
      {branch ? (
        <p role="城池下拉-分城名额" title={CITY_COPY.switcher.branchLocked(branch.minGovernment)} className="border-t border-line-soft px-2.5 pt-1 text-[11px] text-faint">
          {CITY_COPY.switcher.branchQuota(branch.count, branch.limit)}
        </p>
      ) : null}
    </div>
  );
}
