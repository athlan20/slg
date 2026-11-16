// 英文文案孪生：copy-luoyang.ts 的英文版。

import type { LUOYANG_COPY } from './copy-luoyang';

export const LUOYANG_COPY_EN = {
  title: 'Luoyang Contest',
  owner: (name: string, alliance: string | null) => `Lord of Luoyang: ${name}${alliance ? ` · ${alliance}` : ''}`,
  noOwner: 'Luoyang is still an NPC city (two-stage attack, no window restriction)',
  windowOpen: (end: string) => `Contest window open until ${end}`,
  windowClosed: (next: string) => `Window closed; next opens ${next}`,
  bonus: (percent: number) => `All cities of the holder alliance gain +${percent}% resource production`,
  assist: (cap: number) => `Luoyang accepts up to ${cap} reinforcing armies`,
  durability: (value: number) => `Durability ${value}/100`,
  decree: {
    title: 'Decree',
    active: (name: string, until: string) => `${name} · until ${until}`,
    none: 'No active decree',
    next: (at: string) => `Next decree available ${at}`,
    publish: 'Publish decree',
    pick: 'Choose a decree',
    kinds: {
      recruit: 'Recruit time −15%',
      march: 'March speed +10%',
      research: 'Research time −15%',
    },
    published: 'Decree published',
    note: 'Only the holder alliance leader can publish, once every 7 days for 7 days; expires immediately when Luoyang changes hands.',
  },
  errors: {
    fallback: 'Luoyang action failed, please retry',
    DECREE_NOT_HOLDER: 'Only the Lord of Luoyang alliance leader can publish a decree',
    DECREE_COOLDOWN: 'A decree can be published once every 7 days',
    LUOYANG_CLOSED: 'Luoyang is open only on Saturdays 21:00–23:00 Beijing time',
    INVALID_PARAMS: 'Invalid parameters',
  },
  broadcast: {
    soon: (start: string, end: string) => `Luoyang contest window opens at ${start} and closes at ${end}`,
    started: (end: string) => `Luoyang contest window is open, closes at ${end}`,
    ended: () => 'Luoyang contest window has closed',
    holder: (username: string, alliance: string | null) =>
      `${username} became the Governor of Luoyang${alliance ? ` (Lord of Luoyang for ${alliance})` : ''}`,
    decree: (kind: string, until: string) => `The Lord of Luoyang alliance issued a decree: ${kind}, until ${until}`,
  },
  close: 'Close',
} satisfies typeof LUOYANG_COPY;
