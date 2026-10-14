/** 养成页：武将（含酒馆）· 科技 · 竞技场 · 任务。≥1280 三栏两行（竞技场占右侧整列，任务横跨下排）；1279 及以下用分段条一次一块（见 shell.css 的 .p-growth）。 */

import { useCopy } from '../../i18n/bundle';
import { useGame } from '../../state/GameContext';
import { HeroPanel } from '../HeroPanel';
import { QuestPanel } from '../QuestPanel';
import { TechPanel } from '../TechPanel';
import { ArenaPanel } from '../ArenaPanel';
import { PageGrid } from './PageGrid';

export function GrowthPage() {
  const copy = useCopy();
  const { HERO_COPY, TECH_COPY, ARENA_COPY, QUEST_COPY } = copy;
  const { session } = useGame();
  return (
    <PageGrid
      role="养成页"
      layout="p-growth"
      blocks={[
        { key: 'hero', label: '武将', tab: HERO_COPY.panel.title, node: <HeroPanel city={session.city} cityList={session.cityList} session={session.heroSession} /> },
        { key: 'tech', label: '科技', tab: TECH_COPY.panel.title, node: <TechPanel city={session.city} session={session.techSession} /> },
        { key: 'arena', label: '竞技场', tab: ARENA_COPY.panel.title, areaClass: 'a-arena', node: <ArenaPanel heroes={session.heroSession.state?.heroes ?? []} session={session.arenaSession} /> },
        { key: 'quest', label: QUEST_COPY.panel.title, tab: QUEST_COPY.panel.title, areaClass: 'a-quest', node: <QuestPanel session={session.questSession} /> },
      ]}
    />
  );
}
