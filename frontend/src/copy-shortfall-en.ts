// English twin of copy-shortfall.ts (AISLG-137).

import { SHORTFALL_COPY } from './copy-shortfall';

export const SHORTFALL_COPY_EN = {
  openTitle: 'Click to see how to get this',
  openAria: (label: string) => `See how to get ${label}`,
  closeAria: 'Close ways to obtain',
  hintClick: 'Tap the marked cost to choose how to make up the shortfall',
  title: (label: string, missing: number) => `Short ${label} ${missing}`,
  have: (have: number, need: number) => `Have ${have} / need ${need}`,
  eta: (duration: string, rate: number) => `About ${duration} to save up (now +${rate}/h)`,
  noRate: 'Net production cannot save this up — exchange, plunder, or upgrade the matching building',
  chevron: '▾',
  exchange: {
    title: 'Go to the Market',
    hintCovered: (need: number) => `Your Food / Wood / Stone / Iron can cover ${need} gold`,
    hintShort: 'Not enough of the four resources for one full exchange — convert some first',
    prefill: (gold: number) => `Still short ${gold} gold; exchange amount prefilled to the shortfall`,
  },
  building: {
    titleBuild: (name: string) => `Build ${name}`,
    titleUpgrade: (name: string) => `Upgrade ${name}`,
    hintBuild: (label: string) => `Produces ${label} once completed`,
    hintUpgrade: (label: string) => `Upgrading raises ${label} output`,
  },
  map: {
    titleGold: 'Occupy a Gold Mine on the map',
    hintGold: 'Gold Mines cannot be plundered; occupying one produces gold over time',
    titleOther: 'Plunder or occupy on the map',
    hintOther: (label: string) => `Plunder matching wilderness for ${label} now, or occupy for ongoing bonus`,
  },
} satisfies typeof SHORTFALL_COPY;
