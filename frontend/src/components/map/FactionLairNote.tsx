/** 老巢战况（AISLG-241）：选中老巢地块时显示剩余营数、当前营百分比和城墙减伤；灭亡后显示废墟。
 *  数据来自 GET_FACTIONS（session.factions），老巢地块本身只是一块标记过的野地。 */

import type { FactionTileView } from '../../api/protocol-faction';
import { useCopy } from '../../i18n/bundle';
import { getLang } from '../../i18n/lang';
import { useGame } from '../../state/GameContext';

export function FactionLairNote({ faction }: { faction: FactionTileView }) {
  const { EXTRA_MAP } = useCopy();
  const { session } = useGame();
  const F = EXTRA_MAP.faction;
  const name = getLang() === 'en' ? faction.nameEn : faction.name;
  const view = session.factions.state?.factions.find((item) => item.key === faction.key);
  if (faction.destroyed || view?.destroyed) {
    return (
      <p role="选中详情-老巢战况" className="truncate text-[11.5px] text-faint">
        {F.lairHintRuins(name)}
      </p>
    );
  }
  return (
    <p role="选中详情-老巢战况" className="truncate text-[11.5px] text-gold">
      {view ? `${F.camps(view.campsRemaining, view.campsTotal)} · ${F.campRemaining(view.campRemainingPercent)} · ` : ''}
      {F.lairWall}
    </p>
  );
}
