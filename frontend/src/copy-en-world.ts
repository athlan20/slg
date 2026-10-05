// 英文文案孪生（AISLG-137）：copy.ts 的世界地图段（mainView / worldMap / leaderboard /
// serverFeed / exchange / offlineReport / scoutReport / battleReport）。satisfies 索引校验。

import { COPY } from './copy';

export const MAIN_VIEW_EN = {
  tabCity: 'City',
  tabWorld: 'World Map',
  cityMeta: (builtTotal: number, hasActive: boolean) =>
    `${builtTotal} building types built${hasActive ? ' · under construction' : ''}`,
  cityMetaLoading: 'Status pending',
  worldMeta: '1000×1000 · Click a tile for details and to march out',
  worldNote:
    'March out to Plunder (troops carry resources back by load; the cooldown is shown in tile details) or ' +
    'Occupy (limit = Government Hall level). NPC cities can only be plundered and require scouting first. ' +
    'Player cities and wilderness owned by others are not march targets yet (opening with the PvP phase).',
} satisfies typeof COPY['mainView'];

/** 世界地图视图：控件、地块详情、出征与召回 */
export const WORLD_MAP_EN = {
  loading: 'Loading map…',
  loadFailed: 'Failed to load the map. Retrying automatically…',
  blockRange: (x: number, y: number, w: number, h: number) => `Block (${x},${y})–(${x + w - 1},${y + h - 1})`,
  worldSize: (size: number) => `World ${size}×${size}`,
  centerCity: 'To Main City',
  pan: (dx: number, dy: number) => `Pan map (${dx},${dy})`,
  jumpTo: 'Go',
  jumpAria: (x: number, y: number) => `Jump to coordinates (${x},${y})`,
  jumpInvalid: 'Coordinates must be integers within the world bounds',
  jumpX: 'X coordinate',
  jumpY: 'Y coordinate',
  empty: 'No tile data in this area',
  legendTitle: 'Legend',
  legendWilderness: 'Wilderness (number = level)',
  legendOwnTile: 'Occupied by you',
  legendNpcCity: 'NPC City',
  legendCity: 'Player City',
  legendOwnCity: 'Your City',
  legendEnemyTile: 'Occupied by others',
  legendLevel: 'Wilderness level (higher level = stronger defenders)',
  legendTerrain: 'Terrain',
  legendMarks: 'Markers',
  keyHint: 'Hold and drag to pan the map · Arrow keys move the selection; crossing an edge wraps around',
  tipAction: 'Click for details / march out',
  viewCenter: (x: number, y: number) => `View center (${x},${y})`,
  detailTitle: (x: number, y: number) => `Tile (${x},${y})`,
  detailEmpty: 'Click a tile on the map to view details',
  detailClose: 'Close tile details',
  detailLoading: 'Loading details…',
  ownerRow: (name: string) => `Occupied by: ${name}`,
  ownerNone: 'Unclaimed',
  garrisonRow: (count: number) => `Garrison ${count}`,
  protectionNewbie: (left: string) => `Beginner's Protection · ${left} left (cannot be scouted / attacked)`,
  protectionTruce: (left: string) => `Truce · ${left} left (cannot be attacked)`,
  protectionShield: (left: string) => `Truce Shield · ${left} left (cannot be attacked)`,
  protectionOwnerChanged: (left: string) =>
    `Owner-change protection · ${left} left (just changed hands, cannot be taken again yet)`,
  nativePowerRow: (power: number) => `Native defender Power ${power}`,
  npcStockRow: 'Plunderable stockpile (scout snapshot)',
  npcNotScouted: 'NPC city details require scouting first (SCOUT)',
  npcScoutedAt: (clock: string) => `Intel snapshot ${clock}`,
  npcTierRich: 'Rich stockpile',
  npcTierNormal: 'Average stockpile',
  npcTierLow: 'Low stockpile',
  npcTierEmpty: 'Looted bare',
  npcTierHint: (label: string) => `Stockpile status: ${label} (exact amounts require scouting)`,
  npcTierEmptyHint: 'Looted bare — plundering yields nothing',
  wildernessBonusRow: (resourceLabel: string, rate: number) => `Occupation bonus ${resourceLabel} +${rate}/h`,
  wildernessGatherRow: (resourceLabel: string, rate: number) => `Garrison gathering ${resourceLabel} +${rate}/h`,
  scoutTitle: 'Send Scouts',
  scoutHint: 'Send scouts for intel on defenders / walls / stockpile (no battle; scouts return home)',
  scoutCountLabel: (available: number) => `Scouts (in city: ${available})`,
  scoutSubmit: 'Scout',
  scoutBusy: 'Scouting…',
  scoutNoScout: 'No scouts in the city (recruitable from Barracks Lv 2)',
  attackTitle: 'Send Troops',
  attackHintPlayer:
    'Player cities resolve as siege battles (wall, arrow towers and city guard apply). On victory, surviving ' +
    'troops plunder what they can carry: 45% of each resource and 15% of gold — the bigger your Government ' +
    'Hall advantage, the less is taken. The owner receives an incoming-attack warning.',
  attackHintEnemyWild:
    "Take over another player's wilderness: field battles have no walls — defeat the garrison and the tile " +
    'becomes yours (occupation limit = Government Hall level; when the limit is full the tile becomes ' +
    'unclaimed). The owner receives an incoming-attack warning; with no garrison you take it outright.',
  confirmOccupyEnemyWild: 'March to Take Over',
  attackHintEnemyBranch:
    "Take over another player's Branch City: each siege victory lowers city durability by 35 (more with " +
    'Battering Rams); at zero the city changes hands on the spot (same slot rules as occupying an NPC city). ' +
    'Occupying plunders no resources. After a victory the city enters a 4-hour truce and its durability stops ' +
    'regenerating — taking a full city takes at least 3 attacks 8 hours apart.',
  confirmOccupyEnemyBranch: 'March to Siege',
  durabilityRow: (value: number) => `City durability ${value}/100`,
  durabilityHint:
    'Each siege victory takes off 35 (up to 15 more with Battering Rams). It regenerates by 10 per hour ' +
    'after the truce ends. At zero, one victory flips the city.',
  attackHintNpc:
    'On victory, surviving troops plunder the stockpile by carry capacity (gold included; stockpiles do not ' +
    'regenerate — once looted, it is gone). NPC cities can only be plundered, and their details require ' +
    'scouting first.',
  attackHintOwn: 'Target already occupied by this account: this march reinforces the garrison (no battle)',
  attackNoArmy: 'No troops in the city (recruit at the Barracks first, then march out)',
  attackTroopLabel: (name: string, available: number) => `${name} (in city: ${available})`,
  attackSubmit: 'March',
  confirmPlunder: 'Confirm march · Plunder',
  confirmOccupy: 'Confirm march · Occupy',
  confirmReinforce: 'Confirm reinforcement',
  troopPickTitle: 'Choose Troops',
  troopPickHint: 'Enter the troops to send first',
  troopAll: 'All troops',
  troopClear: 'Clear',
  troopMax: 'Max',
  troopTotalLine: (count: number) => `Total ${count} units`,
  troopWeaker: (power: number, enemy: number) =>
    `Formation Power ${power} is below the native defenders (${enemy}) — you may lose`,
  attackBusy: 'Marching…',
  attackPowerLine: (power: number) => `Formation Power ${power}`,
  taskTitle: 'March Task',
  taskPlunder: 'Plunder',
  taskPlunderHint:
    'On victory, troops carry resources back by load (terrain resource × 1500 × level; no gold). Ownership ' +
    'is unchanged and the troops return home. The target then enters a plunder cooldown (shortened by the ' +
    'global speed-up).',
  taskOccupy: 'Occupy',
  taskOccupyHint: (limit: number, owned: number) =>
    `On victory, surviving troops garrison the tile and gain the bonus (occupation limit = Government Hall level ${limit}, currently ${owned})`,
  taskCarryLine: (carry: number) => `Formation load ${carry}`,
  etaLine: (duration: string) => `Arrives ~${duration}`,
  taskCooldownRow: (remaining: string) =>
    `Plunder cooldown (${remaining} before you can plunder again; occupying is unaffected)`,
  transferTitle: 'Transfer Troops to Branch City',
  transferHint:
    "The target is a Branch City of this account: on arrival the formation merges into that city's garrison (no battle)",
  transferSubmit: 'Transfer',
  recallTitle: 'Garrison Management',
  recallHint: 'Recalling abandons the occupation (the bonus stops immediately); troops march back to the city',
  recallSubmit: 'Recall all garrisons',
  recallBusy: 'Recalling…',
  marchesTitle: 'Marches in Progress',
  marchesEmpty: 'No marches',
  marchAttack: (x: number, y: number) => `March → (${x},${y})`,
  marchScout: (x: number, y: number) => `Scout → (${x},${y})`,
  marchTransfer: (x: number, y: number) => `Transfer → (${x},${y})`,
  marchReturn: (x: number, y: number) => `Return ← (${x},${y})`,
  marchPlunder: (x: number, y: number) => `Plunder → (${x},${y})`,
  marchOccupy: (x: number, y: number) => `Occupy → (${x},${y})`,
  marchReinforce: (x: number, y: number) => `Reinforce → (${x},${y})`,
  marchDue: (clock: string) => `Arrives ~${clock}`,
  marchRecallBtn: 'Withdraw',
  marchRecallBusy: 'Withdrawing…',
  territoryTitle: 'Occupied Wilderness',
  territoryEmpty: 'No wilderness occupied yet (surviving troops hold tiles after a victorious march)',
  territoryRow: (terrain: string, level: number, resourceLabel: string, rate: number) =>
    `${terrain} Lv${level} · ${resourceLabel} +${rate}/h`,
  territoryGarrison: (count: number) => `Garrison ${count}`,
  territoryView: 'View',
  territoryCluster: (size: number, percent: number) => `Cluster ${size} · +${percent}%`,
  clusterTip: (label: string, size: number, percent: number) =>
    `${size} connected tiles, ${label} output +${percent}%`,
  reportsTitle: 'Battle Reports',
  reportsEmpty: 'No reports yet (generated after battles settle)',
  reportsLoading: 'Loading reports…',
  reportsRefresh: 'Refresh',
  reportsLoadOlder: 'Load older reports',
  reportWon: 'Victory',
  reportLost: 'Defeat',
  reportKindWilderness: 'Wilderness',
  reportKindNpcCity: 'NPC City',
  reportKindNpcRaid: 'NPC Raid',
  reportKindCityRaid: 'Main City Raided',
  reportRoleAttacker: 'Attacker',
  reportRoleDefender: 'Defender',
  reportMyLosses: (troops: string) => `Our side lost ${troops}`,
  reportOpenHint: 'View battle report details',
  reportKindScout: 'Scout',
  reportScoutHint: 'View scout report',
  reportScoutGarrison: (count: number) => `Defenders ${count}`,
  lastScoutAgo: (ago: string) => `Last scouted: ${ago} ago`,
  lastScoutView: 'View scout report',
  lastScoutLoading: 'Looking up scout records…',
  lastScoutMissing: 'The scout record is not among recent events (scout again to refresh intel)',
} satisfies typeof COPY['worldMap'];

/** 全服排行榜弹窗 */
export const LEADERBOARD_EN = {
  title: 'Server Leaderboard',
  close: 'Close leaderboard',
  refresh: 'Refresh',
  refreshing: 'Refreshing…',
  loadFailed: 'Failed to load the leaderboard. Please try again.',
  power: 'Overall Power',
  territory: 'Territories',
  plunder: 'Total Plunder',
  model: 'Model Leaderboard',
  updatedAt: (time: string) => `Snapshot ${time}`,
  rankColumn: 'Rank',
  playerColumn: 'Player',
  modelColumn: 'Model (self-reported by Agent)',
  modelValueColumn: 'Top 10 Avg Power',
  valueColumn: 'Value',
  myRank: (rank: number, value: number) => `My rank: #${rank} · ${value}`,
  myRankNone: 'Not ranked yet',
  agentBadge: 'Agent',
  agentModelBadge: (model: string) => `${model} · self-reported`,
  modelPlayers: (count: number) => `${count} accounts`,
  modelTop: (username: string, value: number) => `Top: ${username} · ${value}`,
  modelRule:
    'Methodology: accounts whose Agent has been online in the last 7 days, ranked by the average Power of ' +
    'the top 10 accounts on that model; undeclared models count as "Undeclared", ' +
    'models outside the list as "Other". Models are self-reported by the Agent at login and are not verified.',
  empty: 'No leaderboard data yet (the server refreshes every 10 minutes)',
} satisfies typeof COPY['leaderboard'];

/** 全服播报：顶部滚动条文案 */
export const SERVER_FEED_EN = {
  tag: '[Server]',
  expandHint: 'View recent highlights',
} satisfies typeof COPY['serverFeed'];

/** 集市兑换弹窗：粮/木/石/铁按汇率换金币 */
export const EXCHANGE_EN = {
  open: 'Market',
  title: 'Market Exchange',
  subtitle: 'Exchange surplus Food / Wood / Stone / Iron for gold (4 units = 1 gold; not reversible)',
  closeAria: 'Close market exchange',
  amountLabel: (available: number) => `Amount to exchange (you have ${available})`,
  all: 'All',
  rateLine: (rate: number) => `Rate ${rate} : 1`,
  preview: (gold: number, left: number, label: string) => `Get ${gold} gold, leaving ${left} ${label}`,
  tooSmall: (rate: number) => `At least ${rate} units are needed for 1 gold`,
  cancel: 'Cancel',
  submit: 'Exchange',
  busy: 'Exchanging…',
} satisfies typeof COPY['exchange'];

/** 离线日报弹窗：收获 / 损失 / 现状与 Agent 的话 */
export const OFFLINE_REPORT_EN = {
  title: 'Offline Report',
  subtitle: 'What happened while you were away',
  close: 'Close offline report',
  durationMinutes: (minutes: number) => `${minutes} min`,
  durationHours: (hours: number, minutes: number) => `${hours} h ${minutes} min`,
  gainsTitle: 'Gains',
  gainsNone: 'No income while offline',
  gainsLine: (detail: string) => `Gained ${detail}`,
  lossesTitle: 'Losses',
  lossesNone: 'All quiet while you were away',
  battlesRow: (n: number) => `${n} battles fought`,
  troopsLostRow: (n: number) => `${n} troops lost`,
  npcRaidsRow: (n: number) => `${n} NPC raids`,
  wildernessLostRow: (n: number) => `${n} wilderness tiles lost to NPC attacks`,
  statusTitle: 'Status',
  statusCalm: 'All resource levels normal',
  storageFullRow: (label: string, percent: number) =>
    `Warehouse ${label} nearly full (${percent}%) — overflow production is being wasted`,
  agentTitle: "Agent's note",
  writtenAt: (time: string) => `Written ${time}`,
  acknowledge: 'Got it, continue',
  openButton: 'Offline Report',
  loadingFailed: 'Failed to load the report. Please try again.',
} satisfies typeof COPY['offlineReport'];

/** 侦察报告弹窗：守军构成、战力对比、库存与情报时间 */
export const SCOUT_REPORT_EN = {
  title: 'Scout Report',
  close: 'Close scout report',
  location: (x: number, y: number) => `(${x},${y})`,
  ownerRow: (name: string) => ` · Occupied by ${name}`,
  minutesAgo: (minutes: number) => `${minutes} min`,
  hoursAgo: (hours: number, minutes: number) => `${hours} h ${minutes} min`,
  daysAgo: (days: number) => `${days} d`,
  scoutedAtAgo: (ago: string) => `Scouted ${ago} ago`,
  garrisonTitle: 'Defender composition (scout snapshot)',
  garrisonNone: 'No garrison on this tile when scouted',
  garrisonTotal: (count: number) => `Total ${count}`,
  garrisonPower: (power: number) => `Power ${power}`,
  powerHint: (power: number) => `Power ${power}`,
  wallRow: (percent: number) => `Wall damage reduction ${percent}%`,
  stockTitle: 'Plunderable stockpile (scout snapshot)',
  stockEmpty: 'Stockpile already looted bare',
  compareRow: (myPower: number, myCount: number) => `Garrison in your city ${myCount} (Power ${myPower})`,
  verdictSafe: (ratio: number) => `Power is about ${ratio}× the defenders — good odds`,
  verdictEven: 'Power is close — a coin flip. Bring more troops or mix in ranged units',
  verdictDanger: 'Not enough Power to win — recruit more troops or pick another target',
  staleHint: 'Intel is a snapshot from the moment of scouting; defenders and stockpile may have changed',
} satisfies typeof COPY['scoutReport'];

/** 战报详情弹窗：双方编成损益、伤害走势与逐回合明细 */
export const BATTLE_REPORT_EN = {
  closeAria: 'Close battle report details',
  close: 'Close',
  idBadge: (id: number) => `#${id}`,
  commentTitle: 'AI Strategist Comment',
  commentAt: (time: string) => `Written ${time}`,
  kindWilderness: 'Wilderness Encounter',
  kindNpcCity: 'NPC City Siege',
  kindNpcRaid: 'NPC Raid',
  kindCityRaid: 'City Defense (Raided)',
  kindPvpRaid: 'City Siege (Player)',
  kindPvpWilderness: 'Wilderness Contest (Player)',
  kindPvpConquest: 'City Conquest (Player)',
  resultWon: 'Victory',
  resultLost: 'Defeat',
  roleAttacker: 'Atk',
  roleDefender: 'Def',
  sideMine: 'Our side',
  sideEnemy: 'Enemy side',
  location: (x: number, y: number) => `(${x},${y})`,
  roundsMeta: (rounds: number) => `${rounds} rounds`,
  endWiped: 'Defenders wiped out',
  endAttackerWiped: 'Attackers wiped out',
  endRoundLimit: 'Rounds exhausted — attackers failed to break through',
  wallBadge: (percent: number) => `Defender wall damage reduction ${percent}%`,
  statTroops: 'Troops',
  statLosses: 'Losses',
  statSurvivors: 'Survivors',
  statDamage: 'Total damage',
  rangeLine: (maxRange: number, ranged: number) => `Max range ${maxRange} · Ranged units ${ranged}`,
  rangeTip:
    "Ranged units = units whose range exceeds the melee baseline (currently Archers). When the enemy's max " +
    'range far exceeds ours, they can hit you and you cannot reach them',
  versus: 'VS',
  damageShareLabel: 'Damage share',
  chartTitle: 'Damage over time',
  chartMine: 'Our cumulative damage',
  chartEnemy: 'Enemy cumulative damage',
  chartApproach: 'Closing in',
  roundsTitle: (rounds: number) => `Round-by-round (${rounds})`,
  roundDamage: (mine: number, enemy: number) => `${mine} / ${enemy}`,
  roundKilled: (mine: number, enemy: number) => `Fallen ${mine} / ${enemy}`,
  roundChipTip: (round: number, mineDamage: number, enemyDamage: number, mineKilled: number, enemyKilled: number) =>
    `Round ${round}: our side dealt ${mineDamage} and lost ${mineKilled}; enemy side dealt ${enemyDamage} and lost ${enemyKilled}`,
  returnNote: 'Surviving troops head back with the return march and enter the city only on arrival',
  noTroops: 'No troops',
  loading: 'Loading battle report…',
  loadFailed: 'Failed to load the battle report (it may have been cleared)',
} satisfies typeof COPY['battleReport'];
