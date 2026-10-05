/** 养成页（两等分）：武将（含酒馆）· 科技。 */

import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { HeroPanel } from '../HeroPanel';
import { TechPanel } from '../TechPanel';
import { PageGrid } from './PageGrid';

export function GrowthPage() {
  const copy = useCopy();
  const { HERO_COPY, TECH_COPY } = copy;
  const { session } = useGame();
  return (
    <PageGrid
      role="养成页"
      layout="p-growth"
      blocks={[
        { key: 'hero', label: '武将', tab: HERO_COPY.panel.title, node: <HeroPanel city={session.city} cityList={session.cityList} session={session.heroSession} /> },
        { key: 'tech', label: '科技', tab: TECH_COPY.panel.title, node: <TechPanel city={session.city} session={session.techSession} /> },
      ]}
    />
  );
}
