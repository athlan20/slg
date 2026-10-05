// 英文文案孪生（AISLG-137）：copy-pages.ts 的九个页面级文案对象，逐成员 satisfies 对应中文对象的类型。
// 各页面（地图 / 城池 / 军队 / 养成 / 情报 / Agent / 总览）的页面级文案：区块标题、空态、摘要行、按钮。
// 沿用旧面板文案的地方直接引用 copy.ts / copy-*.ts，这里只放导航重构后新增的句子。

import {
  ARMY_COPY, BOARD_COPY, CITY_PAGE_COPY, INTEL_COPY, MAPUI_COPY, OVERVIEW_COPY,
  SUMMARY_COPY, TARGET_COPY, WARN_COPY,
} from './copy-pages';

export const MAPUI_COPY_EN = {
  title: 'World Map',
  layerMoving: 'Bandits & Caravans',
  layerYt: 'Yellow Turbans',
  layerMine: 'Territory',
  legendToggle: 'Legend',
  back: 'Back to Map',
} satisfies typeof MAPUI_COPY;

export const TARGET_COPY_EN = {
  summaryTitle: 'Military Intel',
  summaryHint: 'Click a map tile for details and actions',
  movingTitle: 'Bandits & Caravans',
  detailTitle: (x: number, y: number) => `(${x},${y})`,
  close: 'Deselect',
  factDistance: 'Distance',
  factGarrison: 'Garrison',
  factScout: 'Last scouted',
  distance: (cells: number) => `${cells} tiles`,
  unknown: '—',
  notScouted: 'Not scouted',
  loading: 'Loading tile info…',
  ownerNone: 'Unclaimed',
  actions: {
    plunder: 'Plunder',
    occupy: 'Occupy',
    scout: 'Scout',
    clear: 'Clear',
    intercept: 'Intercept',
    reinforce: 'Reinforce',
    recall: 'Withdraw garrison',
    transfer: 'Transfer',
    transport: 'Transport',
  },
  confirm: (action: string) => `Confirm ${action}`,
  noOps: 'No actions available on this tile',
  ownCityHere: 'Your current city',
  otherCityHint: "Other players' cities can only be scouted; PvP is not open yet",
  recallHint: 'The garrison will return to its origin city and abandon occupation of this tile.',
  verdict: {
    power: (power: number) => `Power ${power}`,
    enemy: (power: number) => `Garrison ~${power}`,
    carry: (carry: number) => `Carry ${carry}`,
  },
  heroLabel: 'Hero in party',
} satisfies typeof TARGET_COPY;

export const SUMMARY_COPY_EN = {
  title: 'Military Intel',
  hint: 'Click a map tile for details and actions',
  empty: 'No intel needs your attention right now',
  idle: 'Idle',
  npc: (target: string, level: number | null) => `NPC attack · ${target}${level !== null && level > 0 ? ` Lv${level}` : ''}`,
  npcSub: (min: number, max: number, beacon: number | undefined) => `Troops ~${min}–${max}${beacon !== undefined ? ` · Beacon Lv${beacon}` : ''}`,
  npcCity: 'Main City',
  npcWild: (x: number, y: number) => `Wilderness (${x},${y})`,
  yt: (stage: string) => `Yellow Turban Rebellion · ${stage}`,
  ytStageBoss: 'Lair revealed',
  ytStageOuter: 'Clearing the outskirts',
  ytSub: (cleared: number, total: number, mine: string) => `Cleared ${cleared}/${total} · ${mine}`,
  ytMine: (killed: number, rank: number) => `My contribution ${killed} (rank ${rank})`,
  ytMineNone: 'No contribution yet',
  starve: 'Food shortage warning',
  truce: 'Under truce',
  starveSub: (net: number, left: string | null) => `Net food ${net >= 0 ? '+' : ''}${net}/h${left ? `, out of food in about ${left}` : ''}`,
  truceSub: (left: string) => `Truce ends in ${left}`,
  goRecruit: 'Recruit',
  moving: (count: number) => `Bandits / Caravans · ${count} parties`,
  movingNearest: (label: string, level: number, dist: number | null) => `Nearest: ${label} Lv${level}${dist !== null ? `, ${dist} tiles away` : ''}`,
  movingRecommend: (x: number, y: number) => `Recommended intercept tile (${x},${y})`,
  locate: 'Locate',
  agentNext: 'Agent next step',
  agentNone: 'No report yet',
  agentOnline: 'Online',
  agentOffline: 'Offline',
} satisfies typeof SUMMARY_COPY;

export const CITY_PAGE_COPY_EN = {
  gridTitle: 'In city',
  detailEmptyTitle: 'Building Details',
  placeholder: 'Select a building on the left for details',
  gridMeta: (built: number, total: number) => `${built}/${total} built`,
  statsTitle: 'City Overview',
  statPopulation: 'Population',
  statDeploy: 'Troops Away',
  statDeploySub: '≤ Parade Ground level',
  statDefense: 'Defense Bonus',
  statDefenseSub: 'Walls / Research',
  queueTitle: 'Build Queue',
  queueMeta: (used: number, slots: number) => `${used} / ${slots} slots used`,
  emptySlot: 'Free slot · available for construction',
  deployMeta: 'Troops Away',
} satisfies typeof CITY_PAGE_COPY;

export const ARMY_COPY_EN = {
  recruitTitle: 'Recruit',
  recruitMeta: (barracks: number, popLeft: number) => `Barracks Lv${barracks} · ${popLeft} population left`,
  colTroop: 'Troop',
  colHome: 'In city',
  colOut: 'Away',
  colCount: 'Recruiting',
  locked: (level: number) => `Needs Barracks Lv${level}`,
  noBarracks: 'Barracks not built yet',
  submit: 'Recruit',
  queueTitle: 'Recruit Queue',
  marchTitle: 'Marches',
  marchMeta: (out: number) => `${out} troops away`,
  marchEmpty: 'No troops away',
  marchLocate: 'Locate',
  marchStateMarching: 'Marching',
  marchStateReturn: 'Returning',
  marchStateAmbush: 'Ambushing',
  territoryTitle: 'Territory',
  territoryMeta: (count: number, cap: number) => `${count} / ${cap} (Government Hall level)`,
  tag: {
    porter: 'Transport',
    militia: 'Basic',
    scout: 'Scout',
    pikeman: 'Anti-cavalry',
    swordsman: 'Anti-archer',
    archer: 'Ranged',
    cavalry: 'Anti-ranged',
    iron_cavalry: 'Heavy Cavalry',
    supply_wagon: 'Logistics',
    ballista: 'Siege engine',
    siege_ram: 'Siege',
  } as Record<string, string>,
} satisfies typeof ARMY_COPY;

export const INTEL_COPY_EN = {
  reportsTitle: 'Battle Reports',
  eventsTitle: 'Activity',
  agentLogTitle: 'Agent Activity Log',
  agentLogMeta: (n: number) => `${n} entries`,
  agentLogEmpty: 'The Agent has not taken any actions yet',
  noAgentReport: 'The Agent has not left a daily report yet',
  offlineLoading: 'Loading daily report…',
  fullReport: 'View full report',
} satisfies typeof INTEL_COPY;

export const WARN_COPY_EN = {
  reinforceCity: 'Recruit to reinforce',
  reinforceWild: 'Locate target',
} satisfies typeof WARN_COPY;

export const BOARD_COPY_EN = {
  ytTitle: 'Yellow Turban Rebellion',
} satisfies typeof BOARD_COPY;

export const OVERVIEW_COPY_EN = {
  armyTitle: 'Troops & population',
  goArmy: 'Go to Army ›',
  totalTroops: 'Total troops',
  power: 'Power in city',
  population: 'Population',
  defense: 'Defense Bonus',
  home: 'In city',
  out: 'Away',
  homeOutHint: 'Each cell shows "In city / Away"',
  eventsTitle: 'Recent activity',
  lanesTitle: 'In progress',
} satisfies typeof OVERVIEW_COPY;
