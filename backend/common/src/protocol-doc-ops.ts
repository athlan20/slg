// 各协议号的对外文档：字段表、专属错误、完整帧示例与 Agent 行为提示。
// 本文件只放账号与会话、查询类协议；建造与推送类见 protocol-doc-ops-build.ts，
// 共用示例常量见 protocol-doc-shared.ts。
// Record<Op, OpDoc> 由类型系统强制覆盖全部协议号：新增协议漏写文档时 typecheck 失败。

import { Op } from './protocol';
import { EXCHANGE_INPUT_PER_GOLD, FARM_COST, INITIAL_RESOURCES } from './rules';
import type { OpDoc, RequestOpDoc } from './protocol-doc';
import { withCityId } from './protocol-doc-ops-city-scope';
import { EMPTY_ARMY } from './protocol-doc-army-consts';
import { REQUEST_LOGIN, REQUEST_LOGOUT } from './protocol-doc-ops-auth';
import {
  AFTER_COST,
  BUILD_VIEW,
  CITY_ID,
  BUILD_ID,
  FARM_BUILT_COSTS,
  FARM_PRODUCTION,
  INITIAL_BUILDINGS_VIEW,
  INITIAL_COSTS,
  INITIAL_LEVELS,
  INITIAL_POPULATION_VIEW,
  INITIAL_PRODUCTION,
  INITIAL_STORAGE,
  QUEUED_BUILD_VIEW,
  STARTED_AT,
  exampleCity,
} from './protocol-doc-shared';
import {
  PUSH_AGENT_STATUS,
  PUSH_BUILD_STATE,
  REQUEST_BUILD,
  REQUEST_BUILD_FARM,
  REQUEST_UPGRADE,
} from './protocol-doc-ops-build';
import {
  PUSH_CITY_STATE,
  REQUEST_CANCEL_BUILD,
  REQUEST_RENAME_CITY,
  REQUEST_RESET_ACCOUNT,
} from './protocol-doc-ops-city';
import {
  PUSH_AGENT_PLAN,
  PUSH_SERVER_BROADCAST,
  REQUEST_AGENT_DAILY_REPORT,
  REQUEST_AGENT_REPORT_PLAN,
  REQUEST_GET_OFFLINE_REPORT,
  REQUEST_GET_LEADERBOARD,
  REQUEST_GET_SERVER_BROADCASTS,
} from './protocol-doc-ops-agent';
import { PUSH_STARVATION_STATE } from './protocol-doc-ops-starvation';
import {
  PUSH_HERO_STATE,
  REQUEST_ASSIGN_HERO,
  REQUEST_DISMISS_HERO,
  REQUEST_GET_HEROES,
  REQUEST_RECRUIT_HERO,
} from './protocol-doc-ops-hero';
import {
  PUSH_WX_QR_STATUS,
  REQUEST_GET_AGENT_TOKEN,
  REQUEST_RESET_AGENT_TOKEN,
  REQUEST_WX_CANCEL,
  REQUEST_WX_CONFIRM,
  REQUEST_WX_QR_CREATE,
  REQUEST_WX_SCAN,
} from './protocol-doc-ops-wechat';
import { REQUEST_GOOGLE_BIND, REQUEST_GOOGLE_LOGIN } from './protocol-doc-ops-google';
import { REQUEST_GITHUB_AUTH_START, REQUEST_OAUTH_REDEEM } from './protocol-doc-ops-github';
import { PUSH_YELLOW_TURBAN_STATE, REQUEST_GET_YELLOW_TURBAN } from './protocol-doc-ops-yt';
import { PUSH_MOVING_TARGET_STATE, REQUEST_GET_MOVING_TARGETS } from './protocol-doc-ops-moving';
import {
  PUSH_TECH_STATE,
  REQUEST_CANCEL_RESEARCH,
  REQUEST_GET_TECHS,
  REQUEST_RESEARCH_TECH,
} from './protocol-doc-ops-tech';
import { PUSH_RECRUIT_STATE, REQUEST_RECRUIT, REQUEST_CANCEL_RECRUIT } from './protocol-doc-ops-army';
import {
  PUSH_MARCH_STATE,
  PUSH_NPC_ATTACK_WARNING,
  PUSH_TILE_STATE,
  REQUEST_GET_TILE,
  REQUEST_GET_WORLD_MAP,
  REQUEST_MARCH,
  REQUEST_RECALL_GARRISON,
} from './protocol-doc-ops-world';
import {
  PUSH_BATTLE_REPORT,
  PUSH_BATTLE_REPORT_COMMENT,
  REQUEST_AGENT_COMMENT_REPORT,
  REQUEST_GET_BATTLE_REPORTS,
  REQUEST_RECALL_MARCH,
  REQUEST_SCOUT,
} from './protocol-doc-ops-battle';
import { PUSH_ATTACK_WARNING, REQUEST_TRUCE } from './protocol-doc-ops-pvp';

const REQUEST_GET_STATE: RequestOpDoc = {
  kind: 'request',
  name: 'GET_STATE',
  title: '查询当前城池状态',
  preAuth: false,
  summary:
    '返回一座城（缺省主城，即账号创建最早的城；v24 起可传 cityId 查分城）的资源、人口、仓储上限、按类型统计的已建建筑、当前小时产量、建造 / 征兵队列、进行中行军与占领野地（v12）；响应另附 cities：账号全部城池的坐标、名称与等级（主城在前，占领 NPC 城池后出现分城）以及 branch 分城名额。读取时服务端会先把离线累积的产量与人口结算进状态，返回值即权威现状。v24（AISLG-58）起每座分城可独立建造、征兵、出征（城池类协议带 cityId），各城资源 / 人口 / 仓储 / 军队独立结算。',
  requestFields: [],
  dataFields: [
    { name: 'city.id', type: 'string', desc: '城池 UUID。' },
    { name: 'city.name', type: 'string', desc: '城池名称，注册时创建的主城默认为「主城」，可用 RENAME_CITY 修改。' },
    { name: 'city.level', type: 'number', desc: '城池等级（v7 新增；v24 起 = 该城官府等级 levels.government，不另设升级系统；此前恒为 1）。官府升级，城池等级跟着升。' },
    { name: 'city.resources.gold', type: 'number', desc: '金（由官府自动生产）。' },
    { name: 'city.resources.wood', type: 'number', desc: '木。' },
    { name: 'city.resources.food', type: 'number', desc: '粮。' },
    { name: 'city.resources.stone', type: 'number', desc: '石（v3 新增）。' },
    { name: 'city.resources.iron', type: 'number', desc: '铁（v3 新增）。' },
    { name: 'city.deploy', type: 'object', desc: '在外部队数与上限（v30，AISLG-80）：{ count, limit }——count = 本城行军中（含返程、运输、侦察）+ 驻守野地（每块占领野地算一支）的部队数，不计城内驻军；limit = 校场等级（未建校场按 1）。count ≥ limit 时 MARCH / SCOUT 返回 DEPLOY_LIMIT；上线前已在外的部队不受影响。分城各算各的（带 cityId 查询）。' },
    { name: 'city.tower', type: 'object | null', desc: '箭塔数值（v30，AISLG-82）：{ damage 每回合固定伤害, range 射程 }；未建箭塔为 null。仅守城战（NPC 袭击主城）生效，战报 towerDamage 单独列出。' },
    { name: 'city.techs', type: 'object', desc: '账号科技等级（v27，AISLG-77；全账号所有城共享）：{ farming, carrying, marching, storage, scouting, defense }，0 = 未研究。农耕 / 储存已计入 city.production / city.storage，城防已计入 city.defenseBonus；负重与行军加成不在 city 里预计算，客户端预估时自行折算（完整科技表见 GET_TECHS）。' },
    { name: 'city.buildings', type: 'object', desc: '**DEPRECATED（v3 遗留，勿用）**：按类型统计的已建数量，v5 单实例规则下恒为 0 或 1——切勿当作等级，解析城池建筑状态请一律读 city.levels。键集：{ farm, lumber_mill, quarry, iron_mine, house, government, barracks, warehouse, wall, academy, parade_ground, beacon, post_station, arrow_tower }（v7 起九种，v27 起加书院，v30 起再加校场 / 烽火台 / 驿站 / 箭塔共十四种）。' },
    { name: 'city.levels', type: 'object', desc: '各建筑类型的当前等级（v5 新增）：0 = 未建造；产量、人口上限与仓储上限均按等级推导。' },
    { name: 'city.costs', type: 'object', desc: '各建筑「下一步动作」成本（v6 新增，v25 起附时长）：{ build, upgrade, buildSeconds, upgradeSeconds }，按类型；未建时 build 为建造成本、upgrade 为 null，已建未满级时 upgrade 为升级成本（= 建造成本 × 当前等级）、build 为 null，满级成本均为 null；buildSeconds / upgradeSeconds（v25，AISLG-71）为对应动作的单级时长（秒，已按当前全局时间缩放折算），null 语义与对应成本字段一致。发起前可用它展示消耗与耗时并预判资源不足。' },
    { name: 'city.farms', type: 'number', desc: '**DEPRECATED（v3 遗留，勿用）**：兼容字段，= buildings.farm（0/1 已建标记）；等级请读 city.levels.farm。' },
    { name: 'city.production', type: 'object', desc: '当前小时产量（v3 新增，v7 起含 gold）：{ gold, food, wood, stone, iron }；四种生产资源各含 100/小时的基础产量（无对应建筑也产出），建筑产量按等级叠加；金币由官府（100×等级/小时，v19）与占领金矿生产（无基础产量）。产量随建筑建成即时生效。' },
    { name: 'city.population', type: 'object', desc: '人口现状（v7 新增，v8 规则确认，v19 数值修订）：{ current 当前人口, cap 上限（= 50 + 100 × 民房等级 × (民房等级 + 1)，无民房即基线 50）, growthPerHour 每小时增长（基准 = 10 × 民房等级 × (等级 + 1)，无民房为 0；实际 × 全局时间缩放） }；current ≥ cap 时停止增长（新号即 50/50 满编、增速 0，建民房后恢复增长）；征兵将消耗人口。' },
    { name: 'city.army', type: 'object', desc: '城内驻军（v11 新增）：{ porter, militia, scout, pikeman, swordsman, archer, cavalry, iron_cavalry, supply_wagon, ballista, siege_ram }（后四种为 v33 二期兵种），按兵种统计；征兵完成（recruit_completed）时累加。' },
    { name: 'city.armyFoodUsePerHour', type: 'number', desc: '全军小时耗粮（v14 新增，实际值 × 全局时间缩放，与产出同幅）：城内驻军 1 倍 + 行军中/野地驻军 2 倍（单兵耗粮见各兵种 foodUse）。production.food 为毛产量，净粮 = production.food − 本值，可为负；结算把粮食扣到 0 为止、不记负债；**v34（AISLG-107）起断粮不再只是停止增长**：粮食为 0 且净产量为负时，每小时（缩放后）城内驻军每兵种减 10%（见 city.starveAt / city.mutinyNextAt 与 PUSH_STARVATION_STATE）。' },
    { name: 'city.starveAt', type: 'string | null', desc: '预计断粮时间（v34，AISLG-107；ISO 8601）：按当前粮食与净产量（粮毛产量 production.food − armyFoodUsePerHour）推算，已断粮 = 当前时刻，净产量不为负（不会断粮）为 null。距断粮不足 1 小时（缩放后）推送一次预警。' },
    { name: 'city.mutinyNextAt', type: 'string | null', desc: '下一次断粮哗变时刻（v34）：已断粮（粮食 0 且净产量为负）时有值——到点本城城内驻军每个兵种减 10%（向上取整、至少 1 个，在外部队不受影响、不强制召回）；否则 null。'  },
    { name: 'city.timeScale', type: 'number', desc: '当前部署的全局时间缩放（v20 新增，AISLG-38）：文档时长基准 ÷ 本值 = 实际耗时（钳 1 秒）、速率基准 × 本值。客户端需本地折算时长（如掠夺冷却剩余）时用本值，不要按文档数值硬算。' },
    { name: 'city.truceUntil', type: 'string | null', desc: '主城免战截止（v22 新增，AISLG-40）：主城被 NPC 袭击攻破后写入，免战期内（2 × 袭击基准间隔，随 timeScale 缩放）该主城不再进入袭击目标池；从未被攻破为 null。到期自动回到目标池，无事件通知——Agent 规划重建时可据此判断安全窗口。v38（AISLG-122）起被玩家攻破 / 被抢后同样写入（4 小时基准随缩放），玩家与 NPC 共用。' },
    { name: 'city.newbieUntil', type: 'string | null', desc: '新手保护截止（v38，AISLG-122，账号级）：注册后 3 天或任一城官府升到 8 级（v42 校准：原 5 级在加速服几分钟即达，形同虚设），先到为准；期内别人不能侦察 / 攻击你（NEWBIE_PROTECTED），你自己侦察 / 攻击其他玩家会立即失效（事件 newbie_protection_ended，打野地 / NPC 不触发）。已出保为 null。' },
    { name: 'city.shieldUntil', type: 'string | null', desc: '主动免战截止（v38，AISLG-122，账号级）：TRUCE 开启后 12 小时基准随缩放；开着时别人打不了你（含 NPC 袭击目标池跳过）、你也不能出兵打玩家（SELF_TRUCE_ACTIVE，打野地 / NPC 不受限）。未开启为 null。' },
    { name: 'city.shieldNextAt', type: 'string | null', desc: '下一次可开启主动免战的时刻（v38，AISLG-122；每周一次，ISO 8601）；当前可开启为 null。' },
    { name: 'city.durability', type: 'number | null', desc: '分城城防值（v40，AISLG-124）：0..100，被「占领」打赢一击 −35（冲车加成最多再 −15）、归零一击换主；免战结束后每小时回涨 10 至满（免战内不回涨）。主城为 null（永不被占领）。' },
    { name: 'city.famousName / city.productionBonusPercent', type: 'string | null / number', desc: '名城分城标记（v24 新增，AISLG-56）：占领名城得到的分城带名城名（famousName）与独占产量加成百分数（productionBonusPercent，当前 20，已计入 production）；普通城为 null / 0。' },
    { name: 'city.guard', type: 'object | null', desc: '城守（v36 新增，AISLG-115）：该城任命的武将 { heroId, name, famous, lead, force, wit, level, bonusPercent }；未任为 null。产量加成（四资源非金，智力 × 0.1% 封顶 5%）已计入 production；守城战另享攻防加成（见 ASSIGN_HERO）。' },
    { name: 'city.recruitQueue', type: 'array', desc: '征兵队列（v11 新增）：第 1 项为征募中（status=recruiting，dueAt 非空），其余为排队（status=queued，dueAt 为 null）；已取消条目不在其中。' },
    { name: 'city.defenseBonus', type: 'number', desc: '城墙守城防御加成（v11 新增；百分数数值，随城墙等级提升；v27 起含城防科技的额外百分点）：攻城战中守方位于城墙位的受击减免即按此值（机制见术语表「战斗」；具体结算算法不对外公开）。' },
    { name: 'city.marches', type: 'array', desc: '本城进行中的行军（v12 新增）：status=marching 的出征与返程条目，按到达时间排序；到达结算后不在其中（结果见 march_completed 事件与推送）。' },
    { name: 'city.territory', type: 'array', desc: '本城占领的野地（v12 新增）：{ x, y, terrain, level, resource, bonusRate 占领加成/小时, gatherRate 驻军采集/小时, garrison 驻军总数, clusterSize 连片块数（v23 新增，AISLG-59）, clusterBonusPercent 连片产量加成百分数（v23 新增：3–4 块 10 / ≥5 块 20，不足 3 块为 0） }；production 已计入 bonusRate、gatherRate 与连片加成——连片按同地形 + 上下左右相邻计算，占领 / 失守后按最新领地自动重算。' },
    { name: 'cities', type: 'array', desc: 'v12 新增：账号全部城池 { id, name, level, x, y, isMain }，主城在前；v24 起 level = 各城官府等级。未占领 NPC 城池时只有主城一座。' },
    { name: 'branch', type: 'object', desc: 'v24 新增（AISLG-58）：分城名额 { count 现有分城数（不含主城）, limit 上限 = floor(主城官府等级 ÷ 3), minGovernment 占领 NPC 城所需的主城官府最低等级（3） }。名城（AISLG-56）同样计入。' },
    { name: 'city.storage', type: 'object', desc: '储量上限（v7 新增，v8 规则确认；v22 AISLG-41 随全局缩放）：{ gold, food, wood, stone, iron }；四资源各自 = （10000 + 对应资源**建筑产量**（各生产建筑等级 × 每级速率之和，**不含**无建筑的 100/h 基础产量）× 100）× timeScale，金币 = 100 万 × timeScale——上限与产出同幅缩放，填满时长不受缩放影响：四资源恒为基准 100 小时；金币随官府等级与金矿占领加成变化（仅有官府产金时 = 10000 ÷ 官府等级 小时，官府 Lv4 时才是 2500 小时），请用 storage[k] ÷ production[k] 现算。达到上限后停止对应生产；已有超限存量不扣减。仓库不改变储量上限（v21 起防掠夺保护消费方已接入：NPC 袭击主城攻破后可掠量 = max(0, 存量 − 保护额)，保护量 4000×等级、四资源固定均分各 1000×等级；金币不受仓库保护，但 NPC 单次最多抢走存量的 5%（v41 AISLG-125）、玩家互掠为存量的 10%）。' },
    { name: 'city.queue', type: 'array', desc: '建造队列（v4 新增）：第 1 项为在建（status=building，dueAt 非空），其余为排队（status=queued，dueAt 为 null），按入队顺序；已取消的条目不在其中（CANCEL_BUILD 取消）。' },
    {
      name: 'city.building',
      type: 'object | null',
      desc: '兼容字段：当前在建建筑（= queue 中 status=building 的首项），无在建时为 null。',
    },
  ],
  errors: [],
  examples: [
    {
      caption: '初始状态（无在建，自带 1 级官府产金）',
      request: { op: Op.GET_STATE, seq: 2 },
      responses: [
        {
          op: Op.GET_STATE,
          seq: 2,
          ok: true,
          data: {
            cities: [{ id: CITY_ID, name: '主城', level: 1, x: 20, y: 20, isMain: true }],
            city: exampleCity(),
          },
        },
      ],
    },
    {
      caption: '队列中有在建与排队（v4）',
      request: { op: Op.GET_STATE, seq: 3 },
      responses: [
        {
          op: Op.GET_STATE,
          seq: 3,
          ok: true,
          data: {
            city: exampleCity({
              resources: AFTER_COST,
              queue: [BUILD_VIEW, QUEUED_BUILD_VIEW],
              building: BUILD_VIEW,
            }),
          },
        },
      ],
    },
    {
      caption: '一座农田建成后（产量生效）',
      request: { op: Op.GET_STATE, seq: 4 },
      responses: [
        {
          op: Op.GET_STATE,
          seq: 4,
          ok: true,
          data: {
            city: exampleCity({
              resources: AFTER_COST,
              buildings: { ...INITIAL_BUILDINGS_VIEW, farm: 1 },
              levels: { ...INITIAL_LEVELS, farm: 1 },
              costs: FARM_BUILT_COSTS,
              farms: 1,
              production: { ...FARM_PRODUCTION },
            }),
          },
        },
      ],
    },
  ],
  agentNote: '断线重连后先用它对齐本地状态；它不含历史事件（事件用 GET_EVENTS 查询）。资源与人口按时间累积，两次查询之间数值自然增长属正常；达到仓储上限后对应资源不再增长也属正常。解析城池建筑状态请只读 city.levels（city.buildings / city.farms 为 v3 遗留的 0/1 已建标记，已废弃）。',
};

const REQUEST_GET_EVENTS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_EVENTS',
  title: '查询历史事件',
  preAuth: false,
  summary:
    '按需拉取账号的历史事件（建造与征兵的开始/入队/完成/取消、城池改名、账号重置、行军与占领结算、NPC 袭击、Agent 上下线）。默认返回最新 50 条并按事件 id 倒序；给 sinceId 时改为返回该 id 之后的旧→新事件。',
  requestFields: [
    {
      name: 'limit',
      type: 'number',
      desc: '可选。返回条数上限 1..200，默认 50；越界或缺失时取默认值。',
    },
    {
      name: 'beforeId',
      type: 'number',
      desc: '可选。分页游标：返回 id 小于该值的最新事件（倒序），用于翻更早的历史。',
    },
    {
      name: 'sinceId',
      type: 'number',
      desc: '可选。增量游标：返回 id 大于该值的旧→新事件（正序），用于补读断线期间的事件；与 beforeId 互斥。',
    },
  ],
  dataFields: [
    { name: 'events', type: 'array', desc: '事件数组，顺序见各游标说明。' },
    { name: 'events[].id', type: 'number', desc: '事件自增 id，可作为 beforeId / sinceId 游标。' },
    {
      name: 'events[].type',
      type: 'string',
      desc: "事件类型：'build_started' | 'build_queued' | 'build_completed' | 'build_cancelled'（v7） | 'recruit_started' | 'recruit_queued' | 'recruit_completed' | 'recruit_cancelled'（v11） | 'march_started' | 'march_completed' | 'wilderness_occupied' | 'wilderness_lost' | 'npc_city_occupied' | 'npc_raid'（v12） | 'city_renamed'（v7） | 'account_reset'（v9，重置后事件流只剩这一条） | 'agent_connected' | 'agent_disconnected' | 'resource_exchanged'（v22，集市兑换成交，detail = { resource, amount, gold, rate }） | 'npc_attack_warning'（v23，NPC 袭击预警，detail = { x, y, target, terrain, level, armyMin, armyMax, arriveAt, attackId }） | 'starvation_warning' / 'mutiny'（v34，断粮预警 / 哗变） | 'hero_recruited' / 'hero_dismissed' / 'hero_arrears' / 'hero_wounded' / 'hero_level_up' / 'hero_granted' / 'guard_changed'（v36，AISLG-114/115/116，武将：招募 / 解雇 / 欠饷 / 重伤 / 升级 / 获得名将 / 城守任命）。",
    },
    { name: 'events[].initiator', type: "'player' | 'agent' | null", desc: '发起事件的连接声明的登录类型。' },
    { name: 'events[].cityId', type: 'string | null', desc: '关联城池 id，无关联时为 null。' },
    { name: 'events[].buildId', type: 'string | null', desc: '关联建造 / 征兵 / 行军条目 id，无关联时为 null。' },
    { name: 'events[].detail', type: 'object', desc: '事件详情：建造开始/入队含 { kind, cost, level }（队列激活时另含 fromQueue: true；连续升级 UPGRADE toLevel 的整链另含 toLevel——此时 cost 是整链总额、level 是首个推进的等级，v37）、完成含 { kind, level }、建造取消含 { kind, level, refund }（v7）、征兵开始/入队含 { troop, count, cost, population }（队列激活时另含 fromQueue: true）、征兵完成含 { troop, count }、征兵取消含 { troop, count, refund, population }（v11）、行军出发含 { x, y, troops, purpose, arriveAt }（v16：plunder / occupy 出征另含 task）、行军结算含 { x, y, purpose, outcome（plunder_won / battle_won / battle_lost / reinforced / returned / aborted / scouted / transferred）, …胜负与战利品明细；battle_lost 详情含 survivors 与 returning（幸存部队撤回的返程行军 id，全灭为 null，v15）；plunder_won（v16）含 loot（按负重装填的战利品，v21 起含金币）、carry（幸存部队负重）与 returning（幸存部队返程行军 id）；battle_won 在 purpose=occupy 时含 occupied（false 时附 denial=TERRITORY_LIMIT） }、野地占领含 { x, y, terrain, level, resource, bonusRate, gatherRate }、占领失效含 { x, y, cause（npc_attack / recall）, … }、NPC 城池占领含 { x, y, cityId, name, buildings, loot }、NPC 袭击含 { x, y, target（wilderness=袭击野地 / city=袭击主城，v21）, level（编成推导等级，v21）, outcome（garrison_lost / repelled）, npcPower, …（target=city 且 outcome=garrison_lost 时另含 loot，v21） }（v12）、改名含 { from, to }（v7）、账号重置无附加详情（v9）。' },
    { name: 'events[].createdAt', type: 'string', desc: '事件时间（ISO 8601）。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      request: { op: Op.GET_EVENTS, seq: 3, data: { limit: 20 } },
      responses: [
      {
        op: Op.GET_EVENTS,
        seq: 3,
        ok: true,
        data: {
          events: [
            {
              id: 102,
              type: 'build_started',
              initiator: 'agent',
              cityId: CITY_ID,
              buildId: BUILD_ID,
              detail: { kind: 'farm', cost: FARM_COST },
              createdAt: STARTED_AT,
            },
            {
              id: 101,
              type: 'agent_connected',
              initiator: 'agent',
              cityId: null,
              buildId: null,
              detail: {},
              createdAt: '2026-09-25T07:59:00.000Z',
            },
          ],
        },
      },
    ],
    },
    {
      caption: 'limit 超出范围（失败响应无 data）',
      request: { op: Op.GET_EVENTS, seq: 19, data: { limit: 0 } },
      responses: [
        {
          op: Op.GET_EVENTS,
          seq: 19,
          ok: false,
          error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' },
        },
      ],
    },
  ],
  agentNote: '断线补状态的组合：GET_STATE 拿现状 + GET_EVENTS（sinceId=本地最后事件 id）补增量。事件只在主动查询时返回，不会补推。**游标注意**：sinceId 是**不含**该 id 的严格大于；事件 id 在写入时分配、提交时才可见，后台结算（Worker）与你自己的操作并发时，id 较小的事件可能比 id 较大的晚几十毫秒才可见——所以补增量时建议把 sinceId 取「本地最后事件 id − 50」左右并按事件 id 去重，不要恰好用最后一个 id。判断某次占领 / 行军结算是否入账，可按 march_started / march_completed 事件里的 buildId（行军 id）对账，也可以用 beforeId 倒序翻页确认。',
};

const REQUEST_GET_AGENT_INFO: RequestOpDoc = {
  kind: 'request',
  name: 'GET_AGENT_INFO',
  title: '查询 Agent 信息',
  preAuth: false,
  summary: '返回当前 Agent 是否在线、各在线 Agent 连接的上线时间、Agent 最近上报的计划（v10 起的 plan 快照），以及 Agent 近期事件（最新 10 条，只含 initiator 为 agent 的事件）；账号绑定状态（wechatBound / googleBound / githubBound + githubLogin，供网页设置区；Agent 令牌不在此下发——它经 GET_AGENT_TOKEN 专门协议、仅玩家连接可查，v46）。v49 起不再返回 directive（作战方针已移除：玩家改与自己的 Agent 直接讨论）。',
  requestFields: [],
  dataFields: [
    { name: 'agentOnline', type: 'boolean', desc: '是否存在至少一条声明为 Agent 的在线连接。' },
    { name: 'connections', type: 'array', desc: '当前在线的 Agent 连接列表。' },
    { name: 'connections[].role', type: "'agent'", desc: '恒为 agent（本列表只含 Agent 连接）。' },
    { name: 'connections[].connectedAt', type: 'string', desc: '该连接的上线时间（ISO 8601）。' },
    { name: 'plan', type: 'object | null', desc: 'Agent 最近一次上报的计划（v10 新增；从未上报为 null），结构与 AGENT_REPORT_PLAN 响应的 plan 相同。' },
    { name: 'plan.nextAction', type: 'string | null', desc: '当前下一步动作；已清除为 null。' },
    { name: 'plan.overallPlan', type: 'string | null', desc: '当前整体计划；已清除为 null。' },
    { name: 'plan.updatedAt', type: 'string', desc: '最近一次上报时间（ISO 8601）。' },
    { name: 'recentEvents', type: 'array', desc: 'Agent 近期事件，元素结构与 GET_EVENTS 的 events 相同。' },
    { name: 'wechatBound', type: 'boolean', desc: '账号是否已绑定微信（v43 新增）；服务端没配置微信扫码登录时恒为 false。' },
    { name: 'googleBound', type: 'boolean', desc: '账号是否已绑定 Google（v44 新增）；服务端没配置 GOOGLE_CLIENT_ID 时恒为 false。' },
    { name: 'githubBound', type: 'boolean', desc: '账号是否已绑定 GitHub（v45 新增）；服务端没配置 GitHub OAuth App 时恒为 false。' },
    { name: 'githubLogin', type: 'string | null', desc: '绑定的 GitHub 用户名（v45 新增；未绑定为 null）。用户名可在 GitHub 改名，绑定键是数字 id，此处仅展示。' },
  ],
  errors: [],
  examples: [
    {
      request: { op: Op.GET_AGENT_INFO, seq: 4 },
      responses: [
      {
        op: Op.GET_AGENT_INFO,
        seq: 4,
        ok: true,
        data: {
          agentOnline: true,
          connections: [{ role: 'agent', connectedAt: '2026-09-25T07:59:00.000Z' }],
          plan: {
            nextAction: '攒木料到 5000 后升 2 级伐木场',
            overallPlan: '先补齐四种资源建筑到 Lv3，再攒资源建军营并开始征兵',
            updatedAt: '2026-09-25T08:00:30.000Z',
          },
          wechatBound: true,
          recentEvents: [
            {
              id: 101,
              type: 'agent_connected',
              initiator: 'agent',
              cityId: null,
              buildId: null,
              detail: {},
              createdAt: '2026-09-25T07:59:00.000Z',
            },
          ],
        },
      },
    ],
    },
  ],
  agentNote: '玩家网页用它渲染 Agent 面板；Agent 也可用它确认同账号的其他 Agent 连接是否在线。',
};

/** EXCHANGE（op 37，v22 AISLG-42）：集市兑换——四基础资源按固定汇率换金币 */
export const REQUEST_EXCHANGE: RequestOpDoc = {
  kind: 'request',
  name: 'EXCHANGE',
  title: '集市兑换（资源 → 金币）',
  preAuth: false,
  summary: `把四种基础资源（粮/木/石/铁）之一按固定汇率换成金币（v22 新增，AISLG-42——满级 / 满仓后的**可持续资源出口**）：汇率 = ${EXCHANGE_INPUT_PER_GOLD} 单位资源 → 1 金（金币不可逆向兑换）。兑换即时入账、不钳储量上限（与掠夺入账同规则）；无队列、无冷却、可反复调用。存量不足返回 INSUFFICIENT_RESOURCES（附 shortfall 与 retryAfterSeconds，口径同 UPGRADE）。产出 resource_exchanged 事件（detail = { resource, amount, gold, rate }）。定位说明：兑换产出远低于官府产金（官府 Lv10 = 1000 金/h），不构成最优策略，只为过满资源保底变现。`,
  requestFields: [
    { name: 'resource', type: "'food' | 'wood' | 'stone' | 'iron'", desc: '必填。要兑换的资源（金币不可作为输入）。' },
    { name: 'amount', type: 'number', desc: `必填。兑换数量（正整数）；换得金币 = floor(amount ÷ ${EXCHANGE_INPUT_PER_GOLD})，不足 ${EXCHANGE_INPUT_PER_GOLD} 单位（换不出 1 金）返回 INVALID_PARAMS。` },
  ],
  dataFields: [
    { name: 'exchange', type: 'object', desc: '成交回执：{ resource, amount, gold（换得金币）, rate（当前汇率 = 输入单位 / 金） }。' },
    { name: 'city', type: 'object', desc: '兑换后的城池状态（字段同 GET_STATE；资源与金币已更新）。' },
  ],
  errors: ['INVALID_PARAMS', 'INSUFFICIENT_RESOURCES'],
  examples: [
    {
      caption: '把 4000 存粮换成 1000 金',
      request: { op: Op.EXCHANGE, seq: 1, data: { resource: 'food', amount: 4000 } },
      responses: [
        { op: Op.EXCHANGE, seq: 1, ok: true, data: { exchange: { resource: 'food', amount: 4000, gold: 1000, rate: EXCHANGE_INPUT_PER_GOLD }, city: '（兑换后的城池状态，字段同 GET_STATE）' } },
      ],
    },
    {
      caption: '存量不足：附缺口与重试等待秒数',
      request: { op: Op.EXCHANGE, seq: 2, data: { resource: 'wood', amount: 2000 } },
      responses: [
        { op: Op.EXCHANGE, seq: 2, ok: false, error: { code: 'INSUFFICIENT_RESOURCES', message: '资源不足以支付建造' }, data: { shortfall: { wood: 320 }, retryAfterSeconds: 21, city: '（当前城池状态）' } },
      ],
    },
  ],
  agentNote: `满级 / 满仓后的资源去处：四资源顶满上限后产出冻结，用本协议把过满资源换成金币（金币是官府升级与征募的通用货币）；兑换不设冷却，可按需分批。汇率 ${EXCHANGE_INPUT_PER_GOLD}:1 为占位决策。`,
};

export const OP_DOC: Record<Op, OpDoc> = {
  [Op.LOGIN]: REQUEST_LOGIN,
  [Op.LOGOUT]: REQUEST_LOGOUT,
  [Op.GET_STATE]: withCityId(REQUEST_GET_STATE),
  [Op.GET_EVENTS]: REQUEST_GET_EVENTS,
  [Op.GET_AGENT_INFO]: REQUEST_GET_AGENT_INFO,
  [Op.BUILD_FARM]: withCityId(REQUEST_BUILD_FARM),
  [Op.BUILD]: withCityId(REQUEST_BUILD),
  [Op.UPGRADE]: withCityId(REQUEST_UPGRADE),
  [Op.CANCEL_BUILD]: REQUEST_CANCEL_BUILD,
  [Op.RENAME_CITY]: withCityId(REQUEST_RENAME_CITY),
  [Op.RESET_ACCOUNT]: REQUEST_RESET_ACCOUNT,
  [Op.AGENT_REPORT_PLAN]: REQUEST_AGENT_REPORT_PLAN,
  [Op.RECRUIT]: withCityId(REQUEST_RECRUIT),
  [Op.CANCEL_RECRUIT]: REQUEST_CANCEL_RECRUIT,
  [Op.GET_WORLD_MAP]: REQUEST_GET_WORLD_MAP,
  [Op.GET_TILE]: REQUEST_GET_TILE,
  [Op.MARCH]: withCityId(REQUEST_MARCH),
  [Op.EXCHANGE]: withCityId(REQUEST_EXCHANGE),
  [Op.RECALL_GARRISON]: REQUEST_RECALL_GARRISON,
  [Op.SCOUT]: withCityId(REQUEST_SCOUT),
  [Op.RECALL_MARCH]: REQUEST_RECALL_MARCH,
  [Op.GET_BATTLE_REPORTS]: REQUEST_GET_BATTLE_REPORTS,
  [Op.AGENT_COMMENT_REPORT]: REQUEST_AGENT_COMMENT_REPORT,
  [Op.AGENT_DAILY_REPORT]: REQUEST_AGENT_DAILY_REPORT,
  [Op.GET_OFFLINE_REPORT]: REQUEST_GET_OFFLINE_REPORT,
  [Op.GET_SERVER_BROADCASTS]: REQUEST_GET_SERVER_BROADCASTS,
  [Op.GET_LEADERBOARD]: REQUEST_GET_LEADERBOARD,
  [Op.GET_TECHS]: withCityId(REQUEST_GET_TECHS),
  [Op.GET_HEROES]: withCityId(REQUEST_GET_HEROES),
  [Op.RECRUIT_HERO]: withCityId(REQUEST_RECRUIT_HERO),
  [Op.DISMISS_HERO]: withCityId(REQUEST_DISMISS_HERO),
  [Op.ASSIGN_HERO]: withCityId(REQUEST_ASSIGN_HERO),
  [Op.TRUCE]: REQUEST_TRUCE,
  [Op.WX_QR_CREATE]: REQUEST_WX_QR_CREATE,
  [Op.WX_SCAN]: REQUEST_WX_SCAN,
  [Op.WX_CONFIRM]: REQUEST_WX_CONFIRM,
  [Op.WX_CANCEL]: REQUEST_WX_CANCEL,
  [Op.GET_AGENT_TOKEN]: REQUEST_GET_AGENT_TOKEN,
  [Op.RESET_AGENT_TOKEN]: REQUEST_RESET_AGENT_TOKEN,
  [Op.GOOGLE_LOGIN]: REQUEST_GOOGLE_LOGIN,
  [Op.GOOGLE_BIND]: REQUEST_GOOGLE_BIND,
  [Op.GITHUB_AUTH_START]: REQUEST_GITHUB_AUTH_START,
  [Op.OAUTH_REDEEM]: REQUEST_OAUTH_REDEEM,
  [Op.RESEARCH_TECH]: withCityId(REQUEST_RESEARCH_TECH),
  [Op.CANCEL_RESEARCH]: REQUEST_CANCEL_RESEARCH,
  [Op.GET_MOVING_TARGETS]: REQUEST_GET_MOVING_TARGETS,
  [Op.GET_YELLOW_TURBAN]: REQUEST_GET_YELLOW_TURBAN,
  [Op.PUSH_BUILD_STATE]: PUSH_BUILD_STATE,
  [Op.PUSH_AGENT_STATUS]: PUSH_AGENT_STATUS,
  [Op.PUSH_CITY_STATE]: PUSH_CITY_STATE,
  [Op.PUSH_AGENT_PLAN]: PUSH_AGENT_PLAN,
  [Op.PUSH_RECRUIT_STATE]: PUSH_RECRUIT_STATE,
  [Op.PUSH_MARCH_STATE]: PUSH_MARCH_STATE,
  [Op.PUSH_TILE_STATE]: PUSH_TILE_STATE,
  [Op.PUSH_BATTLE_REPORT]: PUSH_BATTLE_REPORT,
  [Op.PUSH_BATTLE_REPORT_COMMENT]: PUSH_BATTLE_REPORT_COMMENT,
  [Op.PUSH_NPC_ATTACK_WARNING]: PUSH_NPC_ATTACK_WARNING,
  [Op.PUSH_SERVER_BROADCAST]: PUSH_SERVER_BROADCAST,
  [Op.PUSH_TECH_STATE]: PUSH_TECH_STATE,
  [Op.PUSH_MOVING_TARGET_STATE]: PUSH_MOVING_TARGET_STATE,
  [Op.PUSH_YELLOW_TURBAN_STATE]: PUSH_YELLOW_TURBAN_STATE,
  [Op.PUSH_STARVATION_STATE]: PUSH_STARVATION_STATE,
  [Op.PUSH_HERO_STATE]: PUSH_HERO_STATE,
  [Op.PUSH_ATTACK_WARNING]: PUSH_ATTACK_WARNING,
  [Op.PUSH_WX_QR_STATUS]: PUSH_WX_QR_STATUS,
};
