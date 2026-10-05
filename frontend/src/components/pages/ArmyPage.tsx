/** 军队页（三等分）：征兵 · 行军 · 领地。1024–1279 两栏（领地隐藏）；手机分段条切换。 */

import { useGame } from '../../state/GameContext';
import { MarchesCard } from '../army/MarchesCard';
import { RecruitPanel } from '../RecruitPanel';
import { TerritoryPanel } from '../TerritoryPanel';
import { PageGrid } from './PageGrid';

export function ArmyPage() {
  const { session } = useGame();
  return (
    <PageGrid
      role="军队页"
      layout="p-army"
      blocks={[
        {
          key: 'recruit',
          label: '征兵',
          node: (
            <RecruitPanel
              city={session.city}
              connection={session.connection}
              recruitError={session.recruitError}
              onStartRecruit={(troop, count) => void session.startRecruit(troop, count)}
              onCancelRecruit={(id) => void session.cancelRecruit(id)}
            />
          ),
        },
        { key: 'march', label: '行军', node: <MarchesCard role="军队页-行军" /> },
        { key: 'territory', label: '领地', hideMd: true, node: <TerritoryPanel /> },
      ]}
    />
  );
}
