/** 养成页（两等分）：武将（含酒馆）· 科技。 */

import { useGame } from '../../state/GameContext';
import { HeroPanel } from '../HeroPanel';
import { TechPanel } from '../TechPanel';
import { PageGrid } from './PageGrid';

export function GrowthPage() {
  const { session } = useGame();
  return (
    <PageGrid
      role="养成页"
      layout="p-growth"
      blocks={[
        { key: 'hero', label: '武将', node: <HeroPanel city={session.city} cityList={session.cityList} session={session.heroSession} /> },
        { key: 'tech', label: '科技', node: <TechPanel city={session.city} session={session.techSession} /> },
      ]}
    />
  );
}
