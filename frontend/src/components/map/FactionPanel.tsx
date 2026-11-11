/** 五方势力面板（v99，AISLG-239；v101，AISLG-241 加营数；v107，AISLG-249 加压制档）：地图页右栏的卡片——
 *  五家的名称、首领、老巢坐标、当前半径、持城数与老巢剩余营数 / 当前营剩余百分比（已灭亡的写「已灭亡」），
 *  以及当前压制档与三项效果（围城军比例 / 吞城间隔 / 每周吞分城上限）。数据来自 GET_FACTIONS
 *  （会话切片在 state/factionSession.ts，每分钟重拉）；开关关闭（enabled=false）或本季还没有老巢时整块不渲染。
 *  老巢坐标对全服公开（不受战争迷雾影响），这里直接给出。中文 / 英文名都来自服务端字段，随界面语言取。
 */

import type { FactionView, GetFactionsResponseData } from '../../api/protocol-faction';
import { useCopy } from '../../i18n/bundle';
import { getLang } from '../../i18n/lang';
import { Card } from '../ui/Card';
import { FACTION_SOLID_COLORS, factionLeaderName, factionName } from './factionLayer';

interface FactionPanelProps {
  state: GetFactionsResponseData | null;
  /** 点某一家：把地图居中到它的老巢 */
  onFocusLair?: (lair: { x: number; y: number }) => void;
}

/** 一行的文案：名称 / 首领 / 老巢 / 半径 / 持城 / 营数 / 压制档（F 为 copy-extra-map 的 faction 文案组） */
function rowText(
  faction: FactionView,
  F: ReturnType<typeof useCopy>['EXTRA_MAP']['faction'],
): {
  name: string;
  leader: string;
  lair: string;
  radius: string;
  cities: string;
  camps: string;
  suppression: string;
  suppressionEffects: string;
} {
  const lang = getLang();
  return {
    name: factionName(faction, lang),
    leader: factionLeaderName(faction, lang),
    lair: F.lair(faction.lair.x, faction.lair.y),
    radius: F.radius(faction.radius),
    cities: F.cities(faction.cityCount),
    // v101（AISLG-241）：剩余营数 + 当前营剩余百分比（与实际一致，含已灭亡）
    camps: faction.destroyed
      ? F.destroyed
      : `${F.camps(faction.campsRemaining, faction.campsTotal)} · ${F.campRemaining(faction.campRemainingPercent)}`,
    // v107（AISLG-249）：当前压制档 + 三项效果（老巢被打掉的营越多越虚；已灭亡不给压制）
    suppression: F.suppression(faction.suppression?.level ?? 0),
    suppressionEffects: F.suppressionEffects(
      faction.suppression?.siegePercent ?? 100,
      faction.suppression?.swallowIntervalHours ?? 6,
      faction.suppression?.weeklyBranchCap ?? 2,
    ),
  };
}

export function FactionPanel({ state, onFocusLair }: FactionPanelProps) {
  const { EXTRA_MAP } = useCopy();
  const F = EXTRA_MAP.faction;
  const factions = state?.enabled ? state.factions : [];
  if (factions.length === 0) {
    return null;
  }
  return (
    <Card role="势力面板" title={F.panelTitle} meta={`D${state?.day ?? 0} · ${F.radius(state?.radius ?? 0)}`}>
      <div role="势力面板-列表" aria-label={F.panelAria} className="flex flex-col gap-0.5">
        {factions.map((faction) => {
          const text = rowText(faction, F);
          // v107（AISLG-249）：被压制（有档位）的行用醒目色，0 档 / 已灭亡保持暗淡
          const suppressed = !faction.destroyed && (faction.suppression?.level ?? 0) > 0;
          return (
            <button
              key={faction.key}
              type="button"
              role={`势力面板-行-${text.name}`}
              title={F.lairHint(text.name, text.leader)}
              onClick={() => onFocusLair?.(faction.lair)}
              className="grid cursor-pointer grid-cols-[auto_1fr_auto] items-baseline gap-x-2 rounded px-1 py-[2px] text-left text-[12px] hover:bg-accent-soft"
            >
              <span role="势力面板-色标" aria-hidden="true" className="inline-block h-[8px] w-[8px] rounded-sm" style={{ backgroundColor: FACTION_SOLID_COLORS[faction.key] }} />
              <span role="势力面板-名称" className="truncate font-semibold text-fg">
                {text.name}
              </span>
              <span role="势力面板-持城" className="font-mono text-[11px] text-faint">
                {F.citiesLabel} {text.cities}
              </span>
              <span role="势力面板-详情" className="col-start-2 col-end-4 truncate text-[11px] text-dim">
                {F.leaderLabel} {text.leader} · {F.lairLabel} {text.lair}
              </span>
              <span
                role="势力面板-老巢战况"
                className={`col-start-2 col-end-4 truncate font-mono text-[11px] ${faction.destroyed ? 'text-danger' : 'text-dim'}`}
              >
                {text.camps}
              </span>
              <span
                role="势力面板-压制"
                title={F.suppressionHint}
                className={`col-start-2 col-end-4 truncate text-[11px] ${suppressed ? 'text-warn' : 'text-faint'}`}
              >
                <span role="势力面板-压制档">{text.suppression}</span>
                {' · '}
                <span role="势力面板-压制效果" className="font-mono">
                  {text.suppressionEffects}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}
