/**
 * 界面文案的唯一出处：面板标题、按钮、提示、说明、状态短语与领域名称都集中在本文件，
 * 组件只引用、不各自硬编码；调整措辞只改这里。
 *
 * 边界：
 * - role 属性是元素定位约定（见 AGENTS.md 前端规范），不属于文案，仍写在组件里；
 * - 由协议数据拼装文案的规则（事件文字、错误码映射、产量摘要）在 api/mapping.ts——
 *   本文件管"写什么字"，mapping.ts 管"怎么从数据拼出来"；
 * - 皮肤名称是主题配置，留在 theme.ts；世界地图的地形名是占位数据的一部分，随
 *   WorldMapView 一并替换，不收入本文件。
 */

import type { BuildingKind, ProductionRates, Resources, TerrainKind, TileKind, TroopKind } from './api/protocol';
import type { Actor } from './types';
import { HERO_COPY } from './copy-hero';

/**
 * 九种一期建筑的界面文案：名称 / 单字格位 / 产出资源键 / 非生产建筑的功能标签。
 * resource 为 null 表示不直接产出（民房→人口上限，军营→征兵（v11 已上线），仓库/城墙随后续玩法）。
 */
export const BUILDING_LABEL: Record<
  BuildingKind,
  { name: string; short: string; resource: keyof ProductionRates | null; tag: string }
> = {
  farm: { name: '农田', short: '田', resource: 'food', tag: '产粮' },
  lumber_mill: { name: '伐木场', short: '木', resource: 'wood', tag: '产木' },
  quarry: { name: '采石场', short: '石', resource: 'stone', tag: '产石' },
  iron_mine: { name: '铁矿', short: '铁', resource: 'iron', tag: '产铁' },
  house: { name: '民房', short: '民', resource: null, tag: '人口' },
  government: { name: '官府', short: '府', resource: 'gold', tag: '产金' },
  barracks: { name: '军营', short: '营', resource: null, tag: '征兵' },
  warehouse: { name: '仓库', short: '仓', resource: null, tag: '保护' },
  wall: { name: '城墙', short: '墙', resource: null, tag: '守城' },
  academy: { name: '书院', short: '院', resource: null, tag: '科技' },
  parade_ground: { name: '校场', short: '校', resource: null, tag: '出兵' },
  beacon: { name: '烽火台', short: '烽', resource: null, tag: '预警' },
  post_station: { name: '驿站', short: '驿', resource: null, tag: '调兵' },
  arrow_tower: { name: '箭塔', short: '箭', resource: null, tag: '守城' },
  tavern: { name: HERO_COPY.building.name, short: HERO_COPY.building.short, resource: null, tag: HERO_COPY.building.tag },
};

/** 建筑详情说明（弹窗用；产量数值以服务端下发为准，规则见 docs/agent-api.md 术语表） */
export const BUILDING_DESC: Record<BuildingKind, string> = {
  farm: '生产粮食（粮）。产量 = 等级 × 每级速率，随建成即时生效；科技 / 野地 / 道具加成尚未上线。',
  lumber_mill: '生产木材（木）。产量规则与农田一致：等级 × 每级速率，受同类加成。',
  quarry: '生产石料（石）。产量规则与农田一致：等级 × 每级速率，受同类加成。',
  iron_mine: '生产铁锭（铁）。产量规则与农田一致：等级 × 每级速率，受同类加成。',
  house: '提高人口上限：上限 = 100 × 等级 ×（等级 + 1）。人口随时间增长至上限，征兵（v11）发起时立即消耗人口。',
  government: '自动产出金币（金），产量 = 等级 × 每级速率，无需配置。',
  barracks: '征募士兵驻守城池（v11）：等级解锁更多兵种；发起时立即扣减资源与人口，队列独立于建造队列（1 征募中 + 2 排队）。',
  warehouse: '按等级提供防掠夺保护（v16）：保护总量 4000 × 等级，粮/木/石/铁固定均分各 1000 × 等级；不改变储量上限。玩家城掠夺随后续阶段接入。',
  wall: '提供守城防御加成（v11）：前 10 级每级 +5%、11~20 级每级 +2%（占位数值，20 级 70%），随城池状态下发。',
  parade_ground: '限制本城同时在外的部队数（v30）：详见建筑效果行。',
  beacon: '来袭预警更早、敌情更清楚（v30）：详见建筑效果行。',
  post_station: '加快自己城池之间的调兵和运输（v30）：详见建筑效果行。',
  arrow_tower: '守城战里不会被消灭的远程单位（v30）：详见建筑效果行。',
  tavern: HERO_COPY.building.desc,
  academy: '科技研究所需（v27）：第 N 级科技要求发起研究的城书院 ≥ N 级。科技账号共享，研究在左侧「科技」面板进行。',
};

/** 兵种的界面文案（v11 一期七种，v33 加二期四种）：名称 / 单字简称（驻军与队列条目用） */
export const TROOP_LABEL: Record<TroopKind, { name: string; short: string }> = {
  porter: { name: '民夫', short: '民' },
  militia: { name: '义兵', short: '义' },
  scout: { name: '斥候', short: '斥' },
  pikeman: { name: '长枪兵', short: '枪' },
  swordsman: { name: '刀盾兵', short: '盾' },
  archer: { name: '弓箭兵', short: '弓' },
  cavalry: { name: '轻骑兵', short: '骑' },
  iron_cavalry: { name: '铁骑兵', short: '铁' },
  supply_wagon: { name: '辎重车', short: '辎' },
  ballista: { name: '床弩', short: '弩' },
  siege_ram: { name: '冲车', short: '冲' },
};

/** 资源名 */
export const RESOURCE_LABEL: Record<keyof Resources, string> = {
  gold: '金',
  wood: '木',
  food: '粮',
  stone: '石',
  iron: '铁',
};

/** 地形名（v12，镜像 backend/common/src/world.ts 的 TERRAIN_INFO.label；v19 新增金矿） */
export const TERRAIN_LABEL: Record<TerrainKind, string> = {
  plain: '平原',
  grass: '草原',
  forest: '森林',
  hill: '丘陵',
  desert: '荒漠',
  marsh: '沼泽',
  lake: '湖泊',
  gold_mine: '金矿',
};

/** 地块类别名（v12） */
export const TILE_KIND_LABEL: Record<TileKind, string> = {
  wilderness: '野地',
  npc_city: 'NPC 城池',
  city: '城池',
};

/** 身份名（事件流标签用） */
export const IDENTITY_LABEL: Record<Actor, string> = {
  player: '玩家',
  agent: 'Agent',
  system: '系统',
};

/** 建筑动作描述：目标等级 > 1 为升级，否则为建造（队列条目、弹窗按钮、本地事件共用） */
export function buildActionText(targetLevel: number): string {
  return targetLevel > 1 ? `升级至 Lv ${targetLevel}` : '建造';
}

/** 共享状态短语：建筑格、队列条目、详情弹窗、顶栏状态灯引用同一组 */
const STATUS = {
  online: '在线',
  offline: '离线',
  unknown: '未知',
  notBuilt: '未建',
  active: '在建',
  queued: '排队中',
  waitingStart: '等待开工',
  waitingSettle: '等待结算',
  activating: '激活中…',
  remainingSeconds: (seconds: number) => `剩 ${seconds}s`,
  levelNow: (level: number) => `Lv ${level}`,
  levelTransition: (from: number, to: number) => `Lv ${from}→${to}`,
};

const TOPBAR = {
  notLoggedIn: '未登录',
  subtitleOnline: '状态查询中…',
  subtitleOffline: '首期最小闭环',
  cityMeta: (name: string, level: number) => `${name} · Lv ${level}`,
  productionPrefix: '产量',
  productionEmpty: '暂无（建造资源建筑后生效）',
  /** 净粮产量（v14）：毛产量 − 全军耗粮；耗粮为 0 时退回普通格式（由调用方分支） */
  foodNet: (label: string, net: number, upkeep: number) => `${label} ${net >= 0 ? '+' : ''}${net}/h（耗粮 ${upkeep}/h）`,
  population: (current: number, cap: number, growthPerHour: number) =>
    `人口 ${current}/${cap}（+${growthPerHour}/h）`,
  /** 资源条目的悬浮提示：该资源的储量上限（达上限后停止生产） */
  storageHint: (label: string, cap: number) => `${label}储量上限 ${cap}`,
  /** 免战徽标（v22 AISLG-40）：主城被 NPC 攻破后的保护期，剩余时间本地时钟推进。
   *  v38（AISLG-122）起被玩家攻破 / 被抢同样进入免战（4 小时基准） */
  truceLeft: (left: string) => `免战中 · 剩 ${left}`,
  truceHint: '城被攻破 / 被抢后的免战期：免战结束前玩家和 NPC 都不能再打这座城',
  /** 新手保护徽标（v38 AISLG-122）：注册 3 天或官府 5 级先到为准 */
  newbieLeft: (left: string) => `新手保护 · 剩 ${left}`,
  newbieHint: '新手保护期内别人不能侦察 / 攻击你；你去侦察或攻击其他玩家会立即失效',
  /** 主动免战徽标与按钮（v38 AISLG-122）：每周一次免费、12 小时 */
  shieldLeft: (left: string) => `免战中 · 剩 ${left}`,
  shieldHint: '主动免战：开着时别人打不了你，你也不能出兵打玩家（打野地 / NPC 不受影响）',
  shieldButton: '开启免战',
  shieldButtonBusy: '开启中…',
  shieldNextHint: (left: string) => `免战冷却 · 剩 ${left}（每周一次）`,
  /** 仓库快满提醒（AISLG-73）：≥80% 的资源警示行与悬浮提示（金币不参与，与离线日报同口径） */
  storageFullLine: (detail: string) => `⚠ 仓库快满：${detail}，超出上限的产出会作废`,
  storageFullItem: (label: string, percent: number, cap: number) =>
    `${label}已装 ${percent}%（储量上限 ${cap}），达到上限后停止产出；多出的资源可在集市兑换成金币`,
  storageFullHint: '资源达到储量上限后停止增长（已有存量不扣减）；多出的资源可在集市兑换成金币',
  rename: '城池改名',
  renameTitle: '城池改名',
  renamePlaceholder: '1..24 字符',
  renameEmpty: '名称不能为空',
  renameCancel: '取消',
  renameSubmit: '确认改名',
  renameBusy: '改名中…',
  self: '本人',
  switchAccount: '切换账号',
  switchConfirmBody: '是否切换账号？确认后当前账号将退出登录（吊销会话令牌），回到登录页面。',
  switchCancel: '取消',
  switchConfirm: '确认切换',
  reset: '重置',
  resetTitle: '重置账号数据',
  resetBody:
    '确认重置？全部建筑、建造队列、资源、人口与事件记录将回到开号初始状态，城名恢复为「主城」。重置不可撤销；会话保持在线，不会退出登录。',
  resetBack: '返回',
  resetSubmit: '确认重置',
  resetBusy: '重置中…',
  connectionLamp: {
    idle: '未连接',
    connecting: '连接中',
    online: STATUS.online,
    reconnecting: '重连中',
  },
  agentLamp: { unknown: STATUS.unknown, online: STATUS.online, offline: STATUS.offline },
};

const BUILD_QUEUE = {
  title: '建造队列',
  idle: '空闲',
  running: (count: number) => `进行中 ${count} 条`,
  queuedAt: (index: number) => `排队 ${index}`,
  active: STATUS.active,
  queued: STATUS.queued,
  waitingStart: STATUS.waitingStart,
  waitingSettle: STATUS.waitingSettle,
  activating: STATUS.activating,
  remainingSeconds: STATUS.remainingSeconds,
  /** 取消排队条目（全额返还成本；在建条目不可取消） */
  cancel: '取消',
  cancelTitle: '取消该排队条目，全额返还成本',
};

const CITY_MAP = {
  hint: '点击建筑格查看详情（建造 / 升级） · 高亮为在建 / 排队中 · 每种建筑仅一座',
  noCity: '尚未获取城池状态',
  notBuilt: STATUS.notBuilt,
  noRate: '—',
  queued: STATUS.queued,
  waitingSettle: STATUS.waitingSettle,
  activating: STATUS.activating,
  remainingSeconds: STATUS.remainingSeconds,
  levelNow: STATUS.levelNow,
  levelTransition: STATUS.levelTransition,
};

const BUILDING_MODAL = {
  closeAria: '关闭详情',
  levelLabel: '等级',
  productionLine: (resourceLabel: string, rate: number) => `产 ${resourceLabel} +${rate}/h`,
  populationLine: (current: number, cap: number, growthPerHour: number) =>
    `人口 ${current}/${cap} · +${growthPerHour}/h`,
  /** 城墙效果行（v11）：守城防御加成，占位 = 等级 × 5% */
  defenseLine: (bonus: number) => `守城加成 +${bonus}%`,
  /** 军营效果行（v11）：当前等级已解锁的兵种数 */
  barracksLine: (unlocked: number, total: number) => `可征兵种 ${unlocked}/${total}`,
  /** 仓库效果行（v16）：防掠夺保护量（总量 + 单资源） */
  warehouseLine: (total: number, perResource: number) => `防掠夺保护 ${total}（每资源 ${perResource}）`,
  /** 兜底占位（当前九种建筑均有专属效果行，理论上不可达） */
  pendingFeature: '功能随后续玩法上线',
  costLabel: '消耗',
  /** 连升整链（v22，AISLG-68）：消耗行前缀与整链时长 */
  costChainLabel: (count: number) => `整链消耗（${count} 级）`,
  durationLine: (duration: string) => `整链耗时 ${duration}`,
  /** 单级动作时长（v25 AISLG-71）：服务端下发，已按当前加速折算 */
  durationAction: (duration: string) => `耗时 ${duration}`,
  targetLabel: '目标等级',
  targetOption: (level: number, single: boolean) => `Lv ${level}${single ? '（单级）' : ''}`,
  hintChain: '整链成本一次预扣、占 1 个队列位逐级推进；排队中可取消（全额返还），开工后不可中断',
  submitChain: (level: number) => `连升至 Lv ${level}`,
  insufficient: '（缺）',
  queueLabel: '队列：',
  queueNotIn: '不在队列中',
  queueActive: STATUS.active,
  queueQueued: STATUS.queued,
  hintLevelMax: (max: number) => `已达等级上限（Lv ${max}）`,
  hintInQueue: '该建筑正在建造/升级中，完成后可再发起',
  hintQueueFull: '队列已满（1 在建 + 2 排队）',
  hintUpgradeCost: '升级成本 = 建造成本 × 当前等级',
  hintEnqueue: '无在建立即开工，否则入队',
  submitBuild: (name: string) => `建造${name}`,
};

const RECRUIT_PANEL = {
  title: '军营与驻军',
  /** 头部摘要：城墙提供的守城防御加成（v11，占位 = 城墙等级 × 5%） */
  defenseMeta: (bonus: number) => `守城加成 +${bonus}%`,
  armyLabel: '城内驻军',
  armyEmpty: '暂无驻军',
  queueLabel: '征兵队列',
  queueIdle: '无征兵任务',
  active: '征募中',
  queuedAt: (index: number) => `排队 ${index}`,
  waitingStart: '等待开始',
  waitingSettle: STATUS.waitingSettle,
  activating: STATUS.activating,
  remainingSeconds: STATUS.remainingSeconds,
  /** 取消排队条目（全额返还资源与人口；征募中不可取消） */
  cancel: '取消',
  cancelTitle: '取消该排队条目，全额返还资源与人口',
  formTitle: '发起征兵',
  troopLabel: '兵种',
  countLabel: '数量',
  submit: '征兵',
  costLabel: '消耗',
  populationCost: (amount: number) => `人口 ${amount}`,
  insufficient: '（缺）',
  durationLine: (seconds: number) => `耗时 ${seconds}s`,
  /** 本批入伍后的持续耗粮（v14）：单兵 foodUse × 数量，每小时持续扣减 */
  foodUseLine: (perHour: number) => `此后耗粮 ${perHour}/h`,
  hintNeedBarracks: (level: number) => `需军营 Lv ${level}`,
  hintNoBarracks: '尚未建造军营（城内视图建造后解锁征兵）',
  hintQueueFull: '征兵队列已满（1 征募中 + 2 排队）',
  hintUnlocked: '已解锁',
};

const MAIN_VIEW = {
  tabCity: '城内',
  tabWorld: '世界地图',
  cityMeta: (builtTotal: number, hasActive: boolean) => `已建 ${builtTotal} 种${hasActive ? ' · 建造中' : ''}`,
  cityMetaLoading: '状态待查询',
  worldMeta: '1000×1000 · 点击地块查看详情与出征',
  worldNote: '出征可选掠夺（按部队负重携回资源，冷却时长见地块详情）或占领（上限 = 官府等级）；NPC 城池仅可掠夺且详情需先侦察；玩家城池与他人的野地暂不可出征（随玩家对抗阶段开放）。',
};

/** 世界地图视图（v12）：控件、地块详情、出征与召回 */
const WORLD_MAP = {
  loading: '地图加载中…',
  loadFailed: '地图加载失败，稍后自动重试',
  blockRange: (x: number, y: number, w: number, h: number) => `区块 (${x},${y})–(${x + w - 1},${y + h - 1})`,
  worldSize: (size: number) => `世界 ${size}×${size}`,
  centerCity: '回主城',
  pan: (dx: number, dy: number) => `平移地图 (${dx},${dy})`,
  jumpTo: '跳转',
  jumpAria: (x: number, y: number) => `跳转到坐标 (${x},${y})`,
  jumpInvalid: '坐标需为世界范围内的整数',
  jumpX: 'x 坐标',
  jumpY: 'y 坐标',
  empty: '该区域没有地块数据',
  legendTitle: '图例',
  legendWilderness: '野地（数字为等级）',
  legendOwnTile: '本方占领',
  legendNpcCity: 'NPC 城池',
  legendCity: '玩家城池',
  legendOwnCity: '本方城池',
  legendEnemyTile: '他方占领',
  legendLevel: '野地等级（越高守军越强）',
  legendTerrain: '地形',
  legendMarks: '标记',
  keyHint: '按住拖动浏览地图 · 方向键移动选择，越过边缘自动翻页',
  tipAction: '点击查看详情 / 出征',
  viewCenter: (x: number, y: number) => `视野中心 (${x},${y})`,
  detailTitle: (x: number, y: number) => `地块 (${x},${y})`,
  detailEmpty: '点击地图上的地块查看详情',
  detailClose: '关闭地块详情',
  detailLoading: '详情查询中…',
  ownerRow: (name: string) => `占领：${name}`,
  ownerNone: '无主',
  garrisonRow: (count: number) => `驻军 ${count}`,
  /** 对方城池 / 野地的保护状态（v38 AISLG-122 / v39 AISLG-123）：任一截止未到即受保护 */
  protectionNewbie: (left: string) => `新手保护中 · 剩 ${left}（不能被侦察 / 攻击）`,
  protectionTruce: (left: string) => `免战中 · 剩 ${left}（不能被攻击）`,
  protectionShield: (left: string) => `主动免战中 · 剩 ${left}（不能被攻击）`,
  protectionOwnerChanged: (left: string) => `换主保护中 · 剩 ${left}（刚易主，不能再抢）`,
  nativePowerRow: (power: number) => `原住守军战力 ${power}`,
  npcStockRow: '可掠夺库存（侦察快照）',
  npcNotScouted: 'NPC 城池详情需先侦察（SCOUT）',
  npcScoutedAt: (clock: string) => `情报快照 ${clock}`,
  /** NPC 城库存档位（v23 AISLG-55）：地图档位标记与悬浮提示 */
  npcTierRich: '库存丰厚',
  npcTierNormal: '库存一般',
  npcTierLow: '库存见底',
  npcTierEmpty: '已被掠空',
  npcTierHint: (label: string) => `库存${label}（具体数量需侦察）`,
  npcTierEmptyHint: '已被掠空，掠夺无收益',
  wildernessBonusRow: (resourceLabel: string, rate: number) => `占领加成 ${resourceLabel} +${rate}/h`,
  wildernessGatherRow: (resourceLabel: string, rate: number) => `驻军采集 ${resourceLabel} +${rate}/h`,
  /** 侦察表单（v13） */
  scoutTitle: '斥候侦察',
  scoutHint: '派斥候获取守军构成 / 城墙 / 库存情报（不战斗，斥候返程）',
  scoutCountLabel: (available: number) => `斥候数量（城内 ${available}）`,
  scoutSubmit: '侦察',
  scoutBusy: '侦察中…',
  scoutNoScout: '城内没有斥候（军营 Lv2 起可征募）',
  /** 出征表单 */
  attackTitle: '派兵出征',
  attackHintPlayer: '玩家城按守城战结算（城墙 / 箭塔 / 城守生效）；胜利后按幸存部队负重掠走可抢部分（四资源 45%、金币 15%，官府差越大抢得越少），对方会收到来袭预警',
  attackHintEnemyWild: '抢占他人的野地：野地战无城墙，打掉对方驻军后地块归你（名额 = 官府等级；名额满则地块变无主）；对方会收到来袭预警，守方没驻军则直接拿下',
  confirmOccupyEnemyWild: '出兵抢占',
  attackHintEnemyBranch: '攻占他人的分城：守城战打赢一次城防 −35（带冲车降得更多），归零当场换城（名额条件同占 NPC 城）；占领不抢资源，打赢后该城免战 4 小时、城防不回涨，占满一座至少打 3 次隔 8 小时',
  confirmOccupyEnemyBranch: '出兵攻城',
  durabilityRow: (value: number) => `城防值 ${value}/100`,
  durabilityHint: '守城战打赢一击 −35（冲车最多再 −15）；免战结束后每小时回涨 10；归零一击换主',
  attackHintNpc: '战胜将按幸存部队负重掠夺库存（含金币，库存不再生、掠空就没了；NPC 城池仅支持掠夺，建议先侦察）',
  attackHintOwn: '目标已被本账号占领：此次出征为增援驻军（不战斗）',
  attackNoArmy: '城内没有驻军（军营征兵后可出征）',
  attackTroopLabel: (name: string, available: number) => `${name}（城内 ${available}）`,
  attackSubmit: '出征',
  confirmPlunder: '确认出征 · 掠夺',
  confirmOccupy: '确认出征 · 占领',
  confirmReinforce: '确认增援',
  troopPickTitle: '选择出征兵力',
  troopPickHint: '请先填写出征兵力',
  troopAll: '全军',
  troopClear: '清空',
  troopMax: '全部',
  troopTotalLine: (count: number) => `共 ${count} 人`,
  troopWeaker: (power: number, enemy: number) => `编队战力 ${power} 低于原住守军 ${enemy}，可能打不过`,
  attackBusy: '出征中…',
  attackPowerLine: (power: number) => `编队战力 ${power}`,
  /** 出征任务（v16）：野地可选掠夺 / 占领；NPC 固定掠夺 */
  taskTitle: '出征任务',
  taskPlunder: '掠夺',
  taskPlunderHint: '胜利按负重携回资源（地形资源 × 1500 × 等级，v19 校准；无金币），不改归属、部队返程；目标有掠夺冷却（时长随全局加速缩短）',
  taskOccupy: '占领',
  taskOccupyHint: (limit: number, owned: number) => `胜利后幸存部队驻守并获得加成（占领上限 = 官府等级 ${limit}，当前 ${owned}）`,
  taskCarryLine: (carry: number) => `编队负重 ${carry}`,
  /** 行军时长预估（AISLG-72）：编队 / 侦察表单预览行，按最慢兵种与距离本地折算 */
  etaLine: (duration: string) => `预计 ${duration}到达`,
  taskCooldownRow: (remaining: string) => `掠夺冷却中（${remaining} 后可再掠，占领不受限）`,
  /** 调兵（v13：目标为本账号分城） */
  transferTitle: '调兵至分城',
  transferHint: '目标为本账号分城：编队到达后并入该城驻军（不战斗）',
  transferSubmit: '调兵',
  /** 召回 */
  recallTitle: '驻军管理',
  recallHint: '召回将放弃占领（加成立即停止），部队返程回城',
  recallSubmit: '召回全部驻军',
  recallBusy: '召回中…',
  /** 行军与领地列表 */
  marchesTitle: '进行中行军',
  marchesEmpty: '暂无行军',
  marchAttack: (x: number, y: number) => `出征 → (${x},${y})`,
  marchScout: (x: number, y: number) => `侦察 → (${x},${y})`,
  marchTransfer: (x: number, y: number) => `调兵 → (${x},${y})`,
  marchReturn: (x: number, y: number) => `返程 ← (${x},${y})`,
  marchPlunder: (x: number, y: number) => `掠夺 → (${x},${y})`,
  marchOccupy: (x: number, y: number) => `占领 → (${x},${y})`,
  marchReinforce: (x: number, y: number) => `增援 → (${x},${y})`,
  marchDue: (clock: string) => `预计 ${clock} 到达`,
  marchRecallBtn: '撤回',
  marchRecallBusy: '撤回中…',
  territoryTitle: '占领的野地',
  territoryEmpty: '尚未占领野地（出征获胜后由幸存部队驻占）',
  territoryRow: (terrain: string, level: number, resourceLabel: string, rate: number) =>
    `${terrain} Lv${level} · ${resourceLabel} +${rate}/h`,
  territoryGarrison: (count: number) => `驻军 ${count}`,
  territoryView: '查看',
  /** 连片加成（v23 AISLG-59）：领地列表行标注与地图悬浮提示 */
  territoryCluster: (size: number, percent: number) => `连片 ${size} · +${percent}%`,
  clusterTip: (label: string, size: number, percent: number) => `连片 ${size} 块，${label}产量 +${percent}%`,
  /** 战报列表（v13；详情走 battleReport 弹窗，点击行打开） */
  reportsTitle: '战斗战报',
  reportsEmpty: '暂无战报（战斗结算后生成）',
  reportsLoading: '战报查询中…',
  reportsRefresh: '刷新',
  reportsLoadOlder: '加载更早战报',
  reportWon: '胜',
  reportLost: '负',
  reportKindWilderness: '野地',
  reportKindNpcCity: 'NPC 城池',
  reportKindNpcRaid: 'NPC 袭击',
  reportKindCityRaid: '主城被袭',
  reportRoleAttacker: '攻方',
  reportRoleDefender: '守方',
  reportMyLosses: (troops: string) => `我方损失 ${troops}`,
  reportOpenHint: '查看战报详情',
  /** 侦察记录（v23 AISLG-62）：与战报同列表展示，标签区分 */
  reportKindScout: '侦察',
  reportScoutHint: '查看侦察报告',
  reportScoutGarrison: (count: number) => `守军 ${count}`,
  /** 地块详情：上次侦察时间与报告入口 */
  lastScoutAgo: (ago: string) => `上次侦察：${ago}前`,
  lastScoutView: '查看侦察报告',
  lastScoutLoading: '正在找侦察记录…',
  lastScoutMissing: '侦察记录不在最近事件里（可重新侦察刷新情报）',
};

/** 全服排行榜弹窗（v23，AISLG-61；v50 AISLG-133 新增模型榜与自报模型标注） */
const LEADERBOARD = {
  title: '全服排行榜',
  close: '关闭排行榜',
  refresh: '刷新',
  refreshing: '刷新中…',
  loadFailed: '排行榜加载失败，请重试',
  power: '综合战力',
  territory: '领地数量',
  plunder: '累计掠夺',
  model: '模型榜',
  updatedAt: (time: string) => `快照 ${time}`,
  rankColumn: '名次',
  playerColumn: '玩家',
  modelColumn: '模型（Agent 自报）',
  modelValueColumn: '前 10 名平均战力',
  valueColumn: '数值',
  myRank: (rank: number, value: number) => `我的名次：第 ${rank} 名 · ${value}`,
  myRankNone: '暂未上榜',
  agentBadge: 'Agent',
  /** 玩家榜上的自报模型标注（如 claude-opus-5-5·自报） */
  agentModelBadge: (model: string) => `${model}·自报`,
  /** 模型榜行内：该模型的账号数 */
  modelPlayers: (count: number) => `${count} 个账号`,
  /** 模型榜行内：该模型战力第一的玩家 */
  modelTop: (username: string, value: number) => `第一：${username} · ${value}`,
  /** 模型榜排名口径说明（验收：排名规则与页面说明一致） */
  modelRule: '口径：最近 7 天 Agent 上线过的账号，按该模型实力前 10 名的平均战力排名；不声明归「未声明」，名单外归「其他」。模型为 Agent 登录时自报，未经核实。',
  empty: '榜单还没有数据（服务端每 10 分钟刷新一次）',
};

/** 全服播报（v23，AISLG-60）：顶部滚动条文案 */
const SERVER_FEED = {
  tag: '【全服】',
  expandHint: '查看最近大事',
};

/** 集市兑换弹窗（v22 后端 EXCHANGE 能力，AISLG-67 补前端入口）：粮/木/石/铁按 4:1 换金币 */
const EXCHANGE = {
  open: '集市',
  title: '集市兑换',
  subtitle: '把多出的粮 / 木 / 石 / 铁换成金币（4 单位换 1 金，金币不可逆兑）',
  closeAria: '关闭集市兑换',
  amountLabel: (available: number) => `兑换数量（持有 ${available}）`,
  all: '全部',
  rateLine: (rate: number) => `汇率 ${rate} : 1`,
  preview: (gold: number, left: number, label: string) => `可换金币 ${gold}，兑换后${label}剩 ${left}`,
  tooSmall: (rate: number) => `至少 ${rate} 单位才能换出 1 金币`,
  cancel: '取消',
  submit: '兑换',
  busy: '兑换中…',
};

/** 离线日报弹窗（v23，AISLG-54）：收获 / 损失 / 现状与 Agent 的话 */
const OFFLINE_REPORT = {
  title: '离线日报',
  subtitle: '你不在时发生了什么',
  close: '关闭离线日报',
  durationMinutes: (minutes: number) => `${minutes} 分钟`,
  durationHours: (hours: number, minutes: number) => `${hours} 小时 ${minutes} 分钟`,
  gainsTitle: '收获',
  gainsNone: '离线期间没有进账',
  gainsLine: (detail: string) => `进账 ${detail}`,
  lossesTitle: '损失',
  lossesNone: '离线期间风平浪静',
  battlesRow: (n: number) => `发生战斗 ${n} 场`,
  troopsLostRow: (n: number) => `部队减员 ${n}`,
  npcRaidsRow: (n: number) => `NPC 袭击 ${n} 次`,
  wildernessLostRow: (n: number) => `被 NPC 攻破 ${n} 块野地`,
  statusTitle: '现状',
  statusCalm: '各项资源水位正常',
  storageFullRow: (label: string, percent: number) => `仓库${label}快满了（${percent}%），产出正在作废`,
  agentTitle: 'Agent 的话',
  writtenAt: (time: string) => `${time} 写`,
  acknowledge: '知道了，继续',
  openButton: '离线日报',
  loadingFailed: '日报加载失败，请重试',
};

/** 侦察报告弹窗（v23，AISLG-62）：守军构成、战力对比、库存与情报时间 */
const SCOUT_REPORT = {
  title: '侦察报告',
  close: '关闭侦察报告',
  location: (x: number, y: number) => `(${x},${y})`,
  ownerRow: (name: string) => ` · 占领者 ${name}`,
  minutesAgo: (minutes: number) => `${minutes} 分钟`,
  hoursAgo: (hours: number, minutes: number) => `${hours} 小时 ${minutes} 分钟`,
  daysAgo: (days: number) => `${days} 天`,
  scoutedAtAgo: (ago: string) => `侦察于 ${ago}前`,
  garrisonTitle: '守军构成（侦察快照）',
  garrisonNone: '侦察时该地块没有驻军',
  garrisonTotal: (count: number) => `合计 ${count}`,
  garrisonPower: (power: number) => `战力 ${power}`,
  powerHint: (power: number) => `战力 ${power}`,
  wallRow: (percent: number) => `城墙减伤 ${percent}%`,
  stockTitle: '可掠夺库存（侦察快照）',
  stockEmpty: '库存已被掠空',
  compareRow: (myPower: number, myCount: number) => `我方城内驻军 ${myCount}（战力 ${myPower}）`,
  verdictSafe: (ratio: number) => `战力约 ${ratio} 倍于守军，胜面较大`,
  verdictEven: `战力接近，五五开——建议多带些兵力或混编远程`,
  verdictDanger: `战力不足，打不过——先征兵或换个目标`,
  staleHint: '情报是侦察时刻的快照，守军与库存可能已变化',
};

/** 战报详情弹窗（v13）：双方编成损益、伤害走势与逐回合明细的文案 */
const BATTLE_REPORT = {
  closeAria: '关闭战报详情',
  close: '关闭',
  /** 战报 ID（排查问题时对账用，AISLG-44） */
  idBadge: (id: number) => `#${id}`,
  /** Agent 点评（v23 AISLG-53）：战报弹窗顶部展示 */
  commentTitle: 'AI 军师点评',
  commentAt: (time: string) => `${time} 写`,
  kindWilderness: '野地遭遇战',
  kindNpcCity: 'NPC 攻城战',
  kindNpcRaid: 'NPC 袭击',
  kindCityRaid: '守城战（被袭击）',
  kindPvpRaid: '攻城战（玩家）',
  kindPvpWilderness: '野地争夺（玩家）',
  kindPvpConquest: '攻城夺城（玩家）',
  resultWon: '胜 利',
  resultLost: '战 败',
  roleAttacker: '攻',
  roleDefender: '守',
  sideMine: '我方',
  sideEnemy: '敌方',
  location: (x: number, y: number) => `(${x},${y})`,
  roundsMeta: (rounds: number) => `${rounds} 回合`,
  endWiped: '守方全灭',
  endAttackerWiped: '攻方全灭',
  endRoundLimit: '回合耗尽，攻方未能突破',
  wallBadge: (percent: number) => `守方城墙减伤 ${percent}%`,
  statTroops: '兵力',
  statLosses: '损失',
  statSurvivors: '幸存',
  statDamage: '总输出',
  /** 射程行（v23 AISLG-49）：双方最远射程与远程兵数量，判断「够不够得到对方」 */
  rangeLine: (maxRange: number, ranged: number) => `最远射程 ${maxRange} · 远程兵 ${ranged}`,
  rangeTip: '远程兵 = 射程超过近战基准的单位（当前为弓箭兵）。对方最远射程远超我方时，他打得到你、你够不到他',
  versus: 'VS',
  damageShareLabel: '输出占比',
  chartTitle: '伤害走势',
  chartMine: '我方累计伤害',
  chartEnemy: '敌方累计伤害',
  chartApproach: '接敌推进',
  roundsTitle: (rounds: number) => `逐回合明细（${rounds}）`,
  roundDamage: (mine: number, enemy: number) => `${mine} / ${enemy}`,
  roundKilled: (mine: number, enemy: number) => `阵亡 ${mine} / ${enemy}`,
  roundChipTip: (round: number, mineDamage: number, enemyDamage: number, mineKilled: number, enemyKilled: number) =>
    `第 ${round} 回合：我方输出 ${mineDamage}、阵亡 ${mineKilled}；敌方输出 ${enemyDamage}、阵亡 ${enemyKilled}`,
  returnNote: '幸存部队随返程行军回城，到达后才入城',
  noTroops: '无兵力',
  /** 按 id 反查（事件流入口）的加载态 */
  loading: '战报加载中…',
  loadFailed: '战报加载失败（可能已被清理）',
};

const AGENT_PANEL = {
  offline: STATUS.offline,
  rowScope: '委托范围',
  rowScopeValue: '全部（首期默认）',
  rowConnection: '连接状态',
  connectionsOnline: (count: number) => `在线 · ${count} 条连接`,
  querying: '查询中…',
  rowLastOnline: '最近上线',
  rowLastAction: '最近动作',
  none: '—',
  planNext: '下一步动作',
  planOverall: '整体计划',
  planEmpty: 'Agent 尚未上报计划',
  planSectionTitle: 'Agent 汇报的计划',
  docSection: '给 AI 用的现成文档',
  docButton: '复制给 AI',
  docCopied: '已复制，整段贴给你的 AI 即可',
  docFailed: '复制失败，请重试',
  docTokenHint: '提示词里含有你的令牌，只发给你自己的 Agent。',
  /** MCP 插件配置（AISLG-131）：Claude Desktop / Cursor 加一段配置即可让 AI 直接玩游戏 */
  mcpButton: '复制 MCP 配置',
  mcpCopied: '已复制，贴到 AI 工具的 MCP 配置里',
  mcpFailed: '复制失败，请重试',
  /** 复制的 MCP 配置：npx 拉起 slg-mcp，令牌已内嵌；写进 Claude Desktop / Cursor 的 mcpServers */
  mcpPrompt: (wsUrl: string, token: string) =>
    `把下面的配置加进 AI 工具的 MCP 设置（Claude Desktop：设置 → 开发者 → 编辑配置；Cursor：~/.cursor/mcp.json，结构相同），我就能直接玩《SLG》：\n` +
    `{\n` +
    `  "mcpServers": {\n` +
    `    "slg": {\n` +
    `      "command": "npx",\n` +
    `      "args": ["-y", "slg-mcp"],\n` +
    `      "env": {\n` +
    `        "SLG_TOKEN": "${token}",\n` +
    `        "SLG_SERVER": "${wsUrl}"\n` +
    `      }\n` +
    `    }\n` +
    `  }\n` +
    `}\n` +
    `需要 Node.js ≥ 20。装好后对我说「帮我打三国」。配置里含有你的 Agent 令牌，只写进你本机的配置文件。`,
  /** 复制的固定提示语：不内联文档正文，让用户的 Agent 自己去请求文档地址；
   *  v46（AISLG-129）第四行带本账号的永久 Agent 令牌，Agent 拿到即可登录 */
  docPrompt: (docUrl: string, wsUrl: string, token: string) =>
    `我要委托你接入《SLG》游戏的 Agent API，请自行获取并阅读接入文档：\n` +
    `1. 用 HTTP GET 抓取接入文档（Markdown）：${docUrl}\n` +
    `2. 通读文档后，按文档建立 WebSocket 连接，用下面的令牌登录（LOGIN {token, asAgent: true}），并完成首次请求（协议版本以文中 version 为准）。\n` +
    `服务器地址（WebSocket）：${wsUrl}\n` +
    `Agent 令牌（token）：${token}`,
};

const EVENTS_PANEL = {
  title: '最近事件',
  empty: '暂无事件。登录、建造与推送的结果会显示在这里。',
  loadingOlder: '正在加载更早的事件…',
  noMore: '已加载全部事件',
  /** 战斗类事件携带 reportId（v13）：点击打开对应战报弹窗 */
  viewReport: '战报',
  /** 侦察完成事件携带 intel（v23 AISLG-62）：点击打开侦察报告弹窗 */
  viewScoutReport: '侦察',
};

const LOGIN = {
  title: '账号',
  booting: '自动登录中',
  loggedOut: '尚未登录',
  bootingBody: '正在用保存的登录状态自动登录…',
  username: '用户名',
  usernamePlaceholder: '输入用户名',
  password: '密码',
  passwordPlaceholder: '6..64 字符',
  busy: '登录中…',
  submit: '登录',
  note: '真实登录走 WebSocket（协议见 docs/agent-api.md）：用户名密码仅用于登录已有账号（v48 起不再自动注册，新账号请用 Google / GitHub 登录创建）；浏览器只保存服务端签发的会话令牌。',
  /** v47（AISLG-130）国际站（无密码登录）的说明 */
  noteInternational: '本站为国际站，用 Google 或 GitHub 登录；老账号先在国内站用密码登录并绑定 Google / GitHub，即可用同一账号进入本站。',
  /** v47：国际站但两个第三方入口都未配置时的兜底提示 */
  thirdPartyUnavailable: '本站的 Google / GitHub 登录暂时不可用，请稍后再试。',
  /** 开源仓库入口（登录页底部），指向 github.com/athlan20/slg */
  repoLink: '开源项目 · GitHub',
};

const THEME = {
  label: '皮肤',
};

/** 错误码的人读提示：映射逻辑（错误码 → 哪条）在 api/mapping.ts，字面文案在这里 */
const ERRORS = {
  /** 资源 / 人口缺口后缀（AISLG-69）：拼在 INSUFFICIENT_* 静态文案之后 */
  shortfall: {
    eta: (duration: string) => `（约 ${duration}攒够）`,
    /** 净产量 ≤ 0（如粮被军队吃穿）时服务端给不出攒够时间 */
    noRate: '（当前净产量攒不够，可裁军减耗或去集市兑换）',
    /** 无民房时人口增速为 0 */
    populationNoGrowth: '（当前人口不增长：建民房后恢复）',
  },
  login: {
    invalidCredentials: '用户名或密码不正确',
    /** v48：密码登录不存在的用户名（注册通道已关闭） */
    signupClosed: '该用户名不存在：密码登录不再支持注册，请用 Google / GitHub 登录创建账号',
    invalidParams: '用户名需 1..32 字符，密码需 6..64 字符',
    sessionInvalid: '登录状态已过期，请重新登录',
    /** v47：Agent 用账号密码登录被拒 */
    agentPasswordLogin: 'Agent 不能用账号密码登录，请改用玩家提供的 Agent 令牌（见「复制给 AI」的提示词）',
    /** v47：国际站不开放密码登录 */
    passwordLoginDisabled: '本站不开放账号密码登录，请使用 Google / GitHub 登录',
    fallback: '登录失败',
  },
  agent: {
    fallback: '操作失败，请重试',
  },
  build: {
    insufficientResources: '资源不足以支付建造或升级（当前资源见顶栏）',
    queueFull: '建造队列已满，等队首完成后可再发起',
    buildingExists: '该类型建筑已存在或正在建造/升级中，不可重复发起',
    buildingNotBuilt: '该类型尚未建造，请先建造再升级',
    buildingLevelMax: '建筑已达等级上限，无法继续升级',
    buildNotCancellable: '只能取消排队中的建造任务',
    invalidParams: '建筑类型不合法',
    fallback: '发起建造失败',
  },
  rename: {
    invalidParams: '名称去掉首尾空白后需为 1..24 字符',
    fallback: '改名失败',
  },
  reset: {
    fallback: '重置账号失败',
  },
  recruit: {
    troopNotAvailable: '该兵种需要更高等级的军营',
    insufficientResources: '资源不足以支付本次征募（当前资源见顶栏）',
    insufficientPopulation: '人口不足以征募该数量（人口随时间增长，民房提高上限）',
    queueFull: '征兵队列已满，等队首完成后可再发起',
    notCancellable: '只能取消排队中的征兵任务',
    invalidParams: '征兵参数不合法（兵种未知或数量越界）',
    fallback: '发起征兵失败',
  },
  exchange: {
    insufficientResources: '持有的该资源不够这次兑换',
    invalidParams: '兑换数量需为正整数，且至少 4 单位才能换出 1 金币',
    fallback: '兑换失败，请重试',
  },
  world: {
    targetNotAttackable: '该目标当前不可出征（玩家城池或他人占领的地块；玩家对抗随后续阶段开放）',
    insufficientTroops: '城内兵力不足以派出该编队（行军中的部队不在城内）',
    tileNotOccupied: '该地块未被本账号占领，无法召回驻军',
    invalidParams: '出征参数不合法（坐标越界、编队为空或任务值非法）',
    plunderCooldown: '该地块已被成功掠夺，处于掠夺冷却（占领不受冷却限制）',
    taskInvalidForTarget: '该任务不适用于此目标（NPC 城池仅支持掠夺）',
    territoryLimit: '占领野地数已达官府等级上限（升级官府或召回一块野地后再占领）',
    fallback: '操作失败',
  },
};

/** 会话层的提示与本地事件文案（useGameSession 用） */
const SESSION = {
  disconnected: '连接断开，正在自动重连…',
  reconnected: '已重新连接',
  tokenLost: '登录凭证已丢失，请重新登录',
  sessionExpired: '登录状态已过期，请重新登录',
  loginSuccess: '以玩家身份登录成功',
  autoLoginSuccess: (username: string) => `已用保存的登录状态自动登录（${username}）`,
  autoLoginFailed: (message: string) => `自动登录失败：${message}`,
  connectFailed: '无法连接服务',
  buildQueued: (name: string, action: string) => `${name}${action}加入队列`,
  buildStarted: (name: string, action: string, dueClock: string) => `发起${name}${action}，预计 ${dueClock} 到期`,
  /** 连续升级（v22，AISLG-68）：整链一次预扣、逐级推进；dueClock 为首级到期 */
  buildChainQueued: (name: string, toLevel: number, count: number) =>
    `${name}连升至 Lv ${toLevel}（共 ${count} 级）加入队列`,
  buildChainStarted: (name: string, toLevel: number, count: number, totalSeconds: number, dueClock: string) =>
    `发起${name}连升至 Lv ${toLevel}（共 ${count} 级，整链 ${totalSeconds}s），首级预计 ${dueClock} 到期`,
  buildRejected: (message: string) => `发起被拒绝（${message}）`,
  buildFailedFallback: '发起建造失败',
  buildCancelled: (name: string, action: string) => `取消${name}${action}，成本已全额返还`,
  cancelRejected: (message: string) => `取消被拒绝（${message}）`,
  cancelFailedFallback: '取消建造失败',
  recruitStarted: (name: string, count: number, dueClock: string) =>
    `开始征募${name} ×${count}，预计 ${dueClock} 完成`,
  recruitQueued: (name: string, count: number) => `${name} ×${count}加入征兵队列`,
  recruitCancelled: (name: string, count: number) => `取消征募${name} ×${count}，资源与人口已全额返还`,
  recruitRejected: (message: string) => `征兵被拒绝（${message}）`,
  recruitFailedFallback: '发起征兵失败',
  cancelRecruitRejected: (message: string) => `取消征兵被拒绝（${message}）`,
  cancelRecruitFailedFallback: '取消征兵失败',
  marchStarted: (x: number, y: number, dueClock: string) => `部队出征 → (${x},${y})，预计 ${dueClock} 到达`,
  recallStarted: (x: number, y: number, dueClock: string) => `驻军自 (${x},${y}) 启程返城，预计 ${dueClock} 到达，占领已放弃`,
  scoutStarted: (x: number, y: number, count: number, dueClock: string) =>
    `斥候 ×${count} 侦察 (${x},${y})，预计 ${dueClock} 到达（情报随事件送达）`,
  exchanged: (resourceLabel: string, amount: number, gold: number) =>
    `集市兑换：${resourceLabel} ${amount} → 金币 ${gold}`,
  marchRecalled: (dueClock: string) => `在途部队已折返，预计 ${dueClock} 回城`,
  marchRejected: (message: string) => `出征被拒绝（${message}）`,
  marchFailedFallback: '发起出征失败',
  recallRejected: (message: string) => `召回被拒绝（${message}）`,
  recallFailedFallback: '召回驻军失败',
};

/** NPC 来袭预警弹窗（v23 AISLG-57 推送，AISLG-66 前端消费）：立即弹出留时间增援或撤退 */
const NPC_WARNING = {
  /** 玩家来袭（v38 AISLG-122，推送带 attacker 时）与 NPC 来袭共用一个弹窗 */
  titlePlayer: '⚔ 玩家来袭预警',
  title: '⚠ NPC 来袭预警',
  closeAria: '关闭预警',
  targetLabel: '目标：',
  targetCity: '你的主城',
  attackerLabel: '进攻方：',
  attackerRow: (username: string, cityName: string) => `${username}（从 ${cityName} 出兵）`,
  targetWild: (x: number, y: number, terrain: string, level: number) =>
    `你占领的野地 (${x},${y})${terrain ? ` ${terrain}` : ''} Lv${level}`,
  arriveLabel: '预计到达：',
  arriveLeft: (left: string) => `（剩 ${left}）`,
  armyLabel: '敌方兵力：',
  /** 兵力为 ±20% 估算区间，精确编成见战后战报 */
  armyNote: '（估算）',
  adviceCity: '主城被攻破会被掠夺资源（随后进入免战期）。来得及的话：城墙升级、城内留足驻军。',
  advicePlayer:
    '对方是玩家部队：来得及就从别的城调兵增援（选中自己的城派兵即调兵）、把资源花掉（建造 / 征兵锁资源）；守不住也不会被占领，被攻破后该城进入免战期。',
  adviceWild:
    '来得及增援就选中该野地派兵（增援不战斗、并入驻军）；守不住就选中野地「召回全部驻军」——召回即放弃占领，袭击随之作废。',
  acknowledge: '知道了',
};

/** 主动免战动作与状态文案（v38 AISLG-122） */
const TRUCE_COPY = {
  startedText: (until: string | null) =>
    until ? `主动免战已开启，至 ${until}（期间别人打不了你，你也不能出兵打玩家）` : '主动免战已开启',
  errAlreadyActive: '主动免战已在生效中，无需重复开启',
  errWeeklyUsed: '本周的免战已用过（每周一次免费）',
  errWeeklyUsedLeft: (seconds: number) => {
    const hours = Math.ceil(seconds / 3600);
    return `本周的免战已用过（每周一次），约 ${hours} 小时后再开`;
  },
  errFallback: '开启免战失败，请稍后重试',
};

export const COPY = {
  status: STATUS,
  topbar: TOPBAR,
  buildQueue: BUILD_QUEUE,
  cityMap: CITY_MAP,
  buildingModal: BUILDING_MODAL,
  recruitPanel: RECRUIT_PANEL,
  mainView: MAIN_VIEW,
  worldMap: WORLD_MAP,
  battleReport: BATTLE_REPORT,
  scoutReport: SCOUT_REPORT,
  offlineReport: OFFLINE_REPORT,
  serverFeed: SERVER_FEED,
  npcWarning: NPC_WARNING,
  truce: TRUCE_COPY,
  exchange: EXCHANGE,
  leaderboard: LEADERBOARD,
  agentPanel: AGENT_PANEL,
  eventsPanel: EVENTS_PANEL,
  login: LOGIN,
  theme: THEME,
  errors: ERRORS,
  session: SESSION,
};
// 不写 as const（AISLG-137）：英文孪生（copy-en*.ts）要以本对象的类型为基准（satisfies typeof），
// 字符串需放宽为 string，否则英文文案会被字面量类型卡死。

