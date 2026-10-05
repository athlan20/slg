// 英文文案孪生（AISLG-137）：copy.ts 的英文版（顶层标签 + STATUS..RECRUIT_PANEL 段）。
// 每份 satisfy 对应中文的类型，漏译/签名不符在 tsc 直接报错；总装 COPY_EN 在文件末尾。

import { BUILDING_DESC, BUILDING_LABEL, COPY, IDENTITY_LABEL, RESOURCE_LABEL, TERRAIN_LABEL, TILE_KIND_LABEL, TROOP_LABEL } from './copy';
import { HERO_COPY_EN } from './copy-hero-en';
import { AGENT_PANEL_EN, ERRORS_EN, EVENTS_PANEL_EN, LOGIN_EN, NPC_WARNING_EN, SESSION_EN, THEME_EN, TRUCE_COPY_EN } from './copy-en-misc';
import { BATTLE_REPORT_EN, EXCHANGE_EN, LEADERBOARD_EN, MAIN_VIEW_EN, OFFLINE_REPORT_EN, SCOUT_REPORT_EN, SERVER_FEED_EN, WORLD_MAP_EN } from './copy-en-world';

/**
 * 九种一期建筑的界面文案（英文）：名称 / 格位短码 / 产出资源键 / 非生产建筑的功能标签。
 * short 码用两字母缩写（地图格位显示），酒馆沿用 HERO_COPY_EN。
 */
export const BUILDING_LABEL_EN = {
  farm: { name: 'Farm', short: 'Fa', resource: 'food', tag: 'Food' },
  lumber_mill: { name: 'Lumber Mill', short: 'Lu', resource: 'wood', tag: 'Wood' },
  quarry: { name: 'Quarry', short: 'Qy', resource: 'stone', tag: 'Stone' },
  iron_mine: { name: 'Iron Mine', short: 'Ir', resource: 'iron', tag: 'Iron' },
  house: { name: 'House', short: 'Ho', resource: null, tag: 'Pop' },
  government: { name: 'Government Hall', short: 'Go', resource: 'gold', tag: 'Gold' },
  barracks: { name: 'Barracks', short: 'Ba', resource: null, tag: 'Recruit' },
  warehouse: { name: 'Warehouse', short: 'Wa', resource: null, tag: 'Protect' },
  wall: { name: 'Wall', short: 'Wl', resource: null, tag: 'Defense' },
  academy: { name: 'Academy', short: 'Ac', resource: null, tag: 'Tech' },
  parade_ground: { name: 'Parade Ground', short: 'Pd', resource: null, tag: 'Deploy' },
  beacon: { name: 'Beacon Tower', short: 'Be', resource: null, tag: 'Alert' },
  post_station: { name: 'Post Station', short: 'Ps', resource: null, tag: 'Transfer' },
  arrow_tower: { name: 'Arrow Tower', short: 'At', resource: null, tag: 'Defense' },
  tavern: { name: HERO_COPY_EN.building.name, short: HERO_COPY_EN.building.short, resource: null, tag: HERO_COPY_EN.building.tag },
} satisfies typeof BUILDING_LABEL;

/** 建筑详情说明（弹窗用；产量数值以服务端下发为准） */
export const BUILDING_DESC_EN = {
  farm: 'Produces Food. Output = level × per-level rate, effective as soon as the building is completed; tech / wilderness / item bonuses are not available yet.',
  lumber_mill: 'Produces Wood. Output rules are the same as the Farm: level × per-level rate, affected by matching bonuses.',
  quarry: 'Produces Stone. Output rules are the same as the Farm: level × per-level rate, affected by matching bonuses.',
  iron_mine: 'Produces Iron. Output rules are the same as the Farm: level × per-level rate, affected by matching bonuses.',
  house: 'Raises the population cap: cap = 100 × level × (level + 1). Population grows toward the cap over time, and recruiting consumes population immediately when started.',
  government: 'Produces Gold automatically — output = level × per-level rate, no configuration needed.',
  barracks:
    'Recruits soldiers to garrison your city: higher levels unlock more troop types. Resources and population are deducted immediately when started. The recruit queue is separate from the build queue (1 recruiting + 2 queued).',
  warehouse:
    'Provides plunder protection by level: total protection 4000 × level, split evenly across Food/Wood/Stone/Iron at 1000 × level each. It does not change the storage cap. Plundering player cities arrives in a later phase.',
  wall:
    'Provides a city defense bonus: +5% per level for levels 1–10 and +2% per level for levels 11–20 (placeholder values, 70% at level 20). Delivered with the city status.',
  parade_ground: "Limits how many of this city's troops can be out at the same time: see the building effect line.",
  beacon: 'Earlier attack warnings and clearer enemy intel: see the building effect line.',
  post_station: 'Speeds up troop transfers and transport between your own cities: see the building effect line.',
  arrow_tower: 'Ranged units that cannot be destroyed in siege battles: see the building effect line.',
  tavern: HERO_COPY_EN.building.desc,
  academy:
    'Required for tech research: level-N tech requires the Academy of the city starting the research to be level N or higher. Tech is shared across the account; research happens in the "Tech" panel on the left.',
} satisfies typeof BUILDING_DESC;

/** 兵种的界面文案（英文）：名称 / 格位短码（驻军与队列条目用） */
export const TROOP_LABEL_EN = {
  porter: { name: 'Porter', short: 'Po' },
  militia: { name: 'Militia', short: 'Mi' },
  scout: { name: 'Scout', short: 'Sc' },
  pikeman: { name: 'Spearman', short: 'Sp' },
  swordsman: { name: 'Swordsman', short: 'Sw' },
  archer: { name: 'Archer', short: 'Ar' },
  cavalry: { name: 'Light Cavalry', short: 'Lc' },
  iron_cavalry: { name: 'Heavy Cavalry', short: 'Hc' },
  supply_wagon: { name: 'Supply Wagon', short: 'Sg' },
  ballista: { name: 'Ballista', short: 'Bl' },
  siege_ram: { name: 'Battering Ram', short: 'Br' },
} satisfies typeof TROOP_LABEL;

/** 资源名 */
export const RESOURCE_LABEL_EN = {
  gold: 'Gold',
  wood: 'Wood',
  food: 'Food',
  stone: 'Stone',
  iron: 'Iron',
} satisfies typeof RESOURCE_LABEL;

/** 地形名（镜像 backend/common/src/world.ts 的 TERRAIN_INFO.label） */
export const TERRAIN_LABEL_EN = {
  plain: 'Plains',
  grass: 'Grassland',
  forest: 'Forest',
  hill: 'Hills',
  desert: 'Desert',
  marsh: 'Marsh',
  lake: 'Lake',
  gold_mine: 'Gold Mine',
} satisfies typeof TERRAIN_LABEL;

/** 地块类别名 */
export const TILE_KIND_LABEL_EN = {
  wilderness: 'Wilderness',
  npc_city: 'NPC City',
  city: 'City',
} satisfies typeof TILE_KIND_LABEL;

/** 身份名（事件流标签用） */
export const IDENTITY_LABEL_EN = {
  player: 'Player',
  agent: 'Agent',
  system: 'System',
} satisfies typeof IDENTITY_LABEL;

/** 建筑动作描述：目标等级 > 1 为升级，否则为建造（队列条目、弹窗按钮、本地事件共用） */
export const buildActionText_EN = (targetLevel: number): string =>
  targetLevel > 1 ? `Upgrade to Lv ${targetLevel}` : 'Construction';

/** 共享状态短语：建筑格、队列条目、详情弹窗、顶栏状态灯引用同一组 */
export const STATUS_EN = {
  online: 'Online',
  offline: 'Offline',
  unknown: 'Unknown',
  notBuilt: 'Not built',
  active: 'Building',
  queued: 'Queued',
  waitingStart: 'Waiting to start',
  waitingSettle: 'Waiting to settle',
  activating: 'Activating…',
  remainingSeconds: (seconds: number) => `${seconds}s left`,
  levelNow: (level: number) => `Lv ${level}`,
  levelTransition: (from: number, to: number) => `Lv ${from}→${to}`,
} satisfies typeof COPY['status'];

export const TOPBAR_EN = {
  notLoggedIn: 'Not logged in',
  subtitleOnline: 'Checking status…',
  subtitleOffline: 'An AI-playable Three Kingdoms SLG',
  cityMeta: (name: string, level: number) => `${name} · Lv ${level}`,
  productionPrefix: 'Production',
  productionEmpty: 'None yet (takes effect once resource buildings are built)',
  // 净粮产量：毛产量 − 全军耗粮；耗粮为 0 时退回普通格式（由调用方分支）
  foodNet: (label: string, net: number, upkeep: number) => `${label} ${net >= 0 ? '+' : ''}${net}/h (upkeep ${upkeep}/h)`,
  population: (current: number, cap: number, growthPerHour: number) => `Pop ${current}/${cap} (+${growthPerHour}/h)`,
  // 资源条目的悬浮提示：该资源的储量上限（达上限后停止生产）
  storageHint: (label: string, cap: number) => `${label} storage cap ${cap}`,
  // 免战徽标：主城被攻破 / 被抢后的保护期，剩余时间本地时钟推进
  truceLeft: (left: string) => `Truce · ${left} left`,
  truceHint: 'Truce after your city is breached or raided: until it ends, neither players nor NPCs can attack this city again',
  // 新手保护徽标：注册 3 天或官府 5 级先到为准
  newbieLeft: (left: string) => `Beginner's Protection · ${left} left`,
  newbieHint:
    "While Beginner's Protection is active, no one can scout or attack you; scouting or attacking another player removes it immediately",
  // 主动免战徽标与按钮：每周一次免费、12 小时
  shieldLeft: (left: string) => `Truce Shield · ${left} left`,
  shieldHint:
    'Truce Shield: while it is on, no one can attack you and you cannot march against players (wilderness / NPC targets are unaffected)',
  shieldButton: 'Enable Truce Shield',
  shieldButtonBusy: 'Enabling…',
  shieldNextHint: (left: string) => `Truce Shield cooldown · ${left} left (once per week)`,
  // 仓库快满提醒：≥80% 的资源警示行与悬浮提示（金币不参与，与离线日报同口径）
  storageFullLine: (detail: string) => `⚠ Storage almost full: ${detail}, production beyond the cap will be wasted`,
  storageFullItem: (label: string, percent: number, cap: number) =>
    `${label} at ${percent}% (storage cap ${cap}); production stops at the cap — surplus resources can be exchanged for gold at the Market`,
  storageFullHint:
    'Resources stop growing once the storage cap is reached (existing stock is not deducted); surplus resources can be exchanged for gold at the Market',
  rename: 'Rename City',
  renameTitle: 'Rename City',
  renamePlaceholder: '1..24 characters',
  renameEmpty: 'Name cannot be empty',
  renameCancel: 'Cancel',
  renameSubmit: 'Confirm Rename',
  renameBusy: 'Renaming…',
  self: 'You',
  switchAccount: 'Switch Account',
  switchConfirmBody:
    'Switch account? Once confirmed, the current account is logged out (its session token is revoked) and you return to the login page.',
  switchCancel: 'Cancel',
  switchConfirm: 'Confirm Switch',
  reset: 'Reset',
  resetTitle: 'Reset Account Data',
  resetBody:
    'Confirm reset? All buildings, the build queue, resources, population and event history return to their just-created state, and the city name reverts to "Main City". A reset cannot be undone; your session stays online and you will not be logged out.',
  resetBack: 'Back',
  resetSubmit: 'Confirm Reset',
  resetBusy: 'Resetting…',
  connectionLamp: {
    idle: 'Not connected',
    connecting: 'Connecting',
    online: STATUS_EN.online,
    reconnecting: 'Reconnecting',
  },
  agentLamp: { unknown: STATUS_EN.unknown, online: STATUS_EN.online, offline: STATUS_EN.offline },
} satisfies typeof COPY['topbar'];

export const BUILD_QUEUE_EN = {
  title: 'Build Queue',
  idle: 'Idle',
  running: (count: number) => `${count} in progress`,
  queuedAt: (index: number) => `Queued #${index}`,
  active: STATUS_EN.active,
  queued: STATUS_EN.queued,
  waitingStart: STATUS_EN.waitingStart,
  waitingSettle: STATUS_EN.waitingSettle,
  activating: STATUS_EN.activating,
  remainingSeconds: STATUS_EN.remainingSeconds,
  // 取消排队条目（全额返还成本；在建条目不可取消）
  cancel: 'Cancel',
  cancelTitle: 'Cancel this queued item — the cost is fully refunded',
} satisfies typeof COPY['buildQueue'];

export const CITY_MAP_EN = {
  hint: 'Click a building slot for details (build / upgrade) · Highlighted slots are under construction / queued · One building of each type only',
  noCity: 'City status not loaded yet',
  notBuilt: STATUS_EN.notBuilt,
  noRate: '—',
  queued: STATUS_EN.queued,
  waitingSettle: STATUS_EN.waitingSettle,
  activating: STATUS_EN.activating,
  remainingSeconds: STATUS_EN.remainingSeconds,
  levelNow: STATUS_EN.levelNow,
  levelTransition: STATUS_EN.levelTransition,
} satisfies typeof COPY['cityMap'];

export const BUILDING_MODAL_EN = {
  closeAria: 'Close details',
  levelLabel: 'Level',
  productionLine: (resourceLabel: string, rate: number) => `+${rate}/h ${resourceLabel}`,
  populationLine: (current: number, cap: number, growthPerHour: number) => `Pop ${current}/${cap} · +${growthPerHour}/h`,
  // 城墙效果行：守城防御加成
  defenseLine: (bonus: number) => `City defense bonus +${bonus}%`,
  // 军营效果行：当前等级已解锁的兵种数
  barracksLine: (unlocked: number, total: number) => `Recruitable troop types ${unlocked}/${total}`,
  // 仓库效果行：防掠夺保护量（总量 + 单资源）
  warehouseLine: (total: number, perResource: number) => `Plunder protection ${total} (${perResource} per resource)`,
  // 兜底占位（当前每种建筑均有专属效果行，理论上不可达）
  pendingFeature: 'Feature coming in a later phase',
  costLabel: 'Cost',
  // 连升整链：消耗行前缀与整链时长
  costChainLabel: (count: number) => `Full chain cost (${count} levels)`,
  durationLine: (duration: string) => `Takes ${duration}`,
  // 单级动作时长：服务端下发，已按当前加速折算
  durationAction: (duration: string) => `Takes ${duration}`,
  targetLabel: 'Target Level',
  targetOption: (level: number, single: boolean) => `Lv ${level}${single ? ' (single)' : ''}`,
  hintChain:
    'The full chain cost is deducted upfront and occupies one queue slot, advancing level by level; queued chains can be cancelled (full refund) and cannot be interrupted once started',
  submitChain: (level: number) => `Chain-upgrade to Lv ${level}`,
  insufficient: '(missing)',
  queueLabel: 'Queue:',
  queueNotIn: 'Not in queue',
  queueActive: STATUS_EN.active,
  queueQueued: STATUS_EN.queued,
  hintLevelMax: (max: number) => `Level cap reached (Lv ${max})`,
  hintInQueue: 'This building is already under construction/upgrade — start the next one after it finishes',
  hintQueueFull: 'Queue is full (1 building + 2 queued)',
  hintUpgradeCost: 'Upgrade cost = build cost × current level',
  hintEnqueue: 'Starts immediately when nothing is under construction; otherwise joins the queue',
  submitBuild: (name: string) => `Build ${name}`,
} satisfies typeof COPY['buildingModal'];

export const RECRUIT_PANEL_EN = {
  title: 'Barracks & Garrison',
  // 头部摘要：城墙提供的守城防御加成
  defenseMeta: (bonus: number) => `City defense bonus +${bonus}%`,
  armyLabel: 'City garrison',
  armyEmpty: 'No garrison yet',
  queueLabel: 'Recruit Queue',
  queueIdle: 'No recruit tasks',
  active: 'Recruiting',
  queuedAt: (index: number) => `Queued #${index}`,
  waitingStart: 'Waiting to start',
  waitingSettle: STATUS_EN.waitingSettle,
  activating: STATUS_EN.activating,
  remainingSeconds: STATUS_EN.remainingSeconds,
  // 取消排队条目（全额返还资源与人口；征募中不可取消）
  cancel: 'Cancel',
  cancelTitle: 'Cancel this queued item — resources and population fully refunded',
  formTitle: 'Start Recruitment',
  troopLabel: 'Troop Type',
  countLabel: 'Count',
  submit: 'Recruit',
  costLabel: 'Cost',
  populationCost: (amount: number) => `Population ${amount}`,
  insufficient: '(missing)',
  durationLine: (seconds: number) => `Takes ${seconds}s`,
  // 本批入伍后的持续耗粮：单兵 foodUse × 数量，每小时持续扣减
  foodUseLine: (perHour: number) => `Upkeep ${perHour}/h afterwards`,
  hintNeedBarracks: (level: number) => `Requires Barracks Lv ${level}`,
  hintNoBarracks: 'No Barracks built yet (build one in the city view to unlock recruitment)',
  hintQueueFull: 'Recruit queue is full (1 recruiting + 2 queued)',
  hintUnlocked: 'Unlocked',
} satisfies typeof COPY['recruitPanel'];

export const COPY_EN = {
  status: STATUS_EN,
  topbar: TOPBAR_EN,
  buildQueue: BUILD_QUEUE_EN,
  cityMap: CITY_MAP_EN,
  buildingModal: BUILDING_MODAL_EN,
  recruitPanel: RECRUIT_PANEL_EN,
  mainView: MAIN_VIEW_EN,
  worldMap: WORLD_MAP_EN,
  battleReport: BATTLE_REPORT_EN,
  scoutReport: SCOUT_REPORT_EN,
  offlineReport: OFFLINE_REPORT_EN,
  serverFeed: SERVER_FEED_EN,
  npcWarning: NPC_WARNING_EN,
  truce: TRUCE_COPY_EN,
  exchange: EXCHANGE_EN,
  leaderboard: LEADERBOARD_EN,
  agentPanel: AGENT_PANEL_EN,
  eventsPanel: EVENTS_PANEL_EN,
  login: LOGIN_EN,
  theme: THEME_EN,
  errors: ERRORS_EN,
  session: SESSION_EN,
} satisfies typeof COPY;
// 与 copy.ts 同样不写 as const：COPY_EN 的类型即英文文案的基准类型，字符串保持 string 放宽。
