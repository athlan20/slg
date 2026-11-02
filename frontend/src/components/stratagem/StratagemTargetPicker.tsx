// 施计弹窗里的目标选择（v86，AISLG-211）：从武将卡 / 顶栏进入（没带目标）时，在这里选
// 「自己的一座城」（欺敌）/「世界地图上选中的敌方城」（攻心 + 情报）/「自己的返程部队」（金蝉脱壳）。
// 从地图 / 行军列表 / 来袭预警进入时目标已经带上，这一块不显示。

import type { StratagemKind } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import type { StratagemTargetRef } from '../../state/stratagemSession';

/** 自己的城：只能施欺敌类 */
const OWN_CITY: StratagemKind[] = ['phantom_army', 'empty_fort'];
/** 敌方玩家的城：攻心三计 + 情报 */
const ENEMY_CITY: StratagemKind[] = ['burn_granary', 'loot_fire', 'ambush_all_sides', 'spy_trail'];
/** 自己的返程部队：金蝉脱壳 */
const OWN_RETURN: StratagemKind[] = ['golden_cicada'];

export function StratagemTargetPicker({ onPick }: { onPick: (target: StratagemTargetRef) => void }) {
  const copy = useCopy();
  const { STRATAGEM_COPY } = copy;
  const { session } = useGame();
  const myCities = session.cityList.cities;
  const detail = session.world.detail;
  const myAccountId = session.account?.accountId ?? null;
  // 世界地图上选中的敌方玩家的城
  const enemyCity =
    detail && detail.kind === 'city' && detail.owner !== null && detail.owner.accountId !== myAccountId && detail.owner.cityId
      ? { id: detail.owner.cityId, name: detail.owner.cityName ?? '', x: detail.x, y: detail.y }
      : null;
  const returns = (session.city?.marches ?? []).filter((march) => march.purpose === 'return' && march.status === 'marching');

  return (
    <section role="施计弹窗-选目标" className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold text-faint">{STRATAGEM_COPY.panel.targetTitle}</span>
      <div className="flex flex-wrap gap-1">
        {myCities.map((city) => (
          <button
            key={city.id}
            type="button"
            role={`施计弹窗-选目标-自己城-${city.name}`}
            onClick={() => onPick({ cityId: city.id, label: `${city.name}（${city.x ?? 0},${city.y ?? 0}）`, only: OWN_CITY })}
            className="cursor-pointer rounded border border-line px-1.5 py-0.5 text-[11.5px] text-dim hover:text-accent"
          >
            {city.name}（{city.x ?? 0},{city.y ?? 0}）
          </button>
        ))}
        {enemyCity ? (
          <button
            type="button"
            role="施计弹窗-选目标-敌方城"
            onClick={() => onPick({ cityId: enemyCity.id, label: `${enemyCity.name}（${enemyCity.x},${enemyCity.y}）`, only: ENEMY_CITY })}
            className="cursor-pointer rounded border border-warn/60 px-1.5 py-0.5 text-[11.5px] text-warn"
          >
            {enemyCity.name}（{enemyCity.x},{enemyCity.y}）
          </button>
        ) : null}
        {returns.map((march) => (
          <button
            key={march.id}
            type="button"
            role="施计弹窗-选目标-返程部队"
            onClick={() => onPick({ marchId: march.id, label: `(${march.x},${march.y})`, only: OWN_RETURN })}
            className="cursor-pointer rounded border border-accent/60 px-1.5 py-0.5 text-[11.5px] text-accent"
          >
            {STRATAGEM_COPY.entry.cicada}（{march.x},{march.y}）
          </button>
        ))}
      </div>
      {enemyCity === null && returns.length === 0 && myCities.length === 0 ? (
        <p className="text-[11.5px] text-faint">{STRATAGEM_COPY.panel.targetMissing}</p>
      ) : null}
    </section>
  );
}
