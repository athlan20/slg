// 世界类协议的对外文档（GET_WORLD_MAP / GET_TILE / MARCH / RECALL_GARRISON /
// PUSH_MARCH_STATE / PUSH_TILE_STATE，v12 起、v13 更新）。
// 账号与查询类见 protocol-doc-ops.ts；建造类见 protocol-doc-ops-build.ts；
// 征兵类见 protocol-doc-ops-army.ts；战斗 / 侦察 / 战报类见 protocol-doc-ops-battle.ts；
// 共用示例常量见 protocol-doc-shared.ts。
// 数值引用 common/src/world.ts 与 battle.ts 的真实常量，保证文档与服务端一致。

import { MARCH_HERO_FIELD_DESC } from './protocol-doc-ops-hero';
import { atBaseTimeScale } from './time-scale';
import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { ACCOUNT_ID, CITY_ID, STARTED_AT } from './protocol-doc-shared';
import {
  DEFAULT_MARCH_SECONDS_PER_TILE,
  WILDERNESS_LEVEL_MAX,
  WORLD_SIZE,
  DEFAULT_MAP_WINDOW,
  MAX_MAP_WINDOW,
  PLUNDER_POOL_GOLD_PER_LEVEL,
  PLUNDER_POOL_RESOURCE_PER_LEVEL,
  marchTravelSeconds,
  wildernessBonusRate,
  wildernessGatherRate,
} from './world';
import { TROOP_POWER, armyPower, nativeGarrison, npcRaidArmy } from './battle';
import { PLUNDER_COOLDOWN_HOURS } from './plunder';
import { TROOP_INFO } from './troops';
import { TROOP_KINDS } from './protocol';

/** 单兵负重（文档示例引用；数值来源 troops.ts 的 TROOP_INFO.carry） */
const TROOP_CARRY: Record<string, number> = Object.fromEntries(
  TROOP_KINDS.map((kind) => [kind, TROOP_INFO[kind].carry]),
);

const MARCH_ID = 'e5f2cc35-f086-47a1-9b3c-2d4e5f6a7b8c';
/** 示例：主城 (16,20) → 野地 (12,17)，Chebyshev 距离 4 */
const MARCH_TRAVEL_SECONDS = atBaseTimeScale(() => marchTravelSeconds(16, 20, 12, 17));
const MARRIVE_AT = new Date(Date.parse(STARTED_AT) + MARCH_TRAVEL_SECONDS * 1000).toISOString();

const EMPTY_ARMY = Object.fromEntries(TROOP_KINDS.map((kind) => [kind, 0]));

const MARCH_VIEW = {
  id: MARCH_ID,
  fromCityId: CITY_ID,
  x: 12,
  y: 17,
  troops: { ...EMPTY_ARMY, militia: 20, archer: 4 },
  purpose: 'plunder',
  status: 'marching',
  initiator: 'player',
  startedAt: STARTED_AT,
  arriveAt: MARRIVE_AT,
  resolvedAt: null,
  targetId: null,
  cargo: null,
  ambushAt: null,
  heroId: null,
} as const;

const TILE_WILDERNESS = {
  x: 12,
  y: 17,
  terrain: 'forest',
  kind: 'wilderness',
  level: 3,
  owner: null,
  garrison: 0,
} as const;

const TILE_OWNED = {
  x: 12,
  y: 17,
  terrain: 'forest',
  kind: 'wilderness',
  level: 3,
  owner: { accountId: ACCOUNT_ID, username: 'example-player', cityId: CITY_ID, cityName: '主城' },
  garrison: 9,
} as const;

const TILE_NPC_CITY = {
  x: 30,
  y: 6,
  terrain: 'plain',
  kind: 'npc_city',
  level: 2,
  owner: null,
  // v17 起 NPC 城驻军总数需侦察：未侦察为 0（示例账号未侦察该城）
  garrison: 0,
} as const;

export const REQUEST_GET_WORLD_MAP: RequestOpDoc = {
  kind: 'request',
  name: 'GET_WORLD_MAP',
  title: '查询世界地图窗口（v12）',
  preAuth: false,
  summary: `以窗口方式查询世界地图（世界为 ${WORLD_SIZE}×${WORLD_SIZE} 的方格，服务端启动时一次性生成）。请求给窗口左上角 (x, y) 与宽高 (w, h)；缺省以账号主城为中心取 ${DEFAULT_MAP_WINDOW}×${DEFAULT_MAP_WINDOW}。窗口起点 (x, y) 按世界边界钳制；w/h 须为 1..${MAX_MAP_WINDOW} 的整数，非法或越界（0、负数、超过上限、非整数）视为未提供、取缺省 ${DEFAULT_MAP_WINDOW}，不做钳制放大（v17 明确）。每个地块返回地形（plain 平原 / grass 草原 / forest 森林 / hill 丘陵 / desert 荒漠 / marsh 沼泽 / lake 湖泊 / gold_mine 金矿——v19 新增，占领产金、不可掠夺）、类别（wilderness 野地 / npc_city NPC 城池 / city 玩家城池）、野地或 NPC 城池等级、占领者（玩家名与城池）与驻军总数。大地图用多次窗口拼接；服务端不推送整图变化，地块级变化走 PUSH_TILE_STATE（漏推由按需重查覆盖）。`,
  requestFields: [
    { name: 'x', type: 'number', desc: `可选。窗口左上角 x，0..${WORLD_SIZE - 1}；缺省按主城居中折算，超出部分按边界钳制。` },
    { name: 'y', type: 'number', desc: `可选。窗口左上角 y，0..${WORLD_SIZE - 1}；缺省按主城居中折算，超出部分按边界钳制。` },
    { name: 'w', type: 'number', desc: `可选。窗口宽度，1..${MAX_MAP_WINDOW} 的整数；缺省、非法或越界取 ${DEFAULT_MAP_WINDOW}（v17：不做钳制放大）。` },
    { name: 'h', type: 'number', desc: `可选。窗口高度，1..${MAX_MAP_WINDOW} 的整数；缺省、非法或越界取 ${DEFAULT_MAP_WINDOW}（v17：不做钳制放大）。` },
  ],
  dataFields: [
    { name: 'size', type: 'number', desc: '世界边长（世界为 size×size 方格）。' },
    { name: 'x / y / w / h', type: 'number', desc: '本次窗口的左上角与宽高（已按世界边界钳制后的实际值）。' },
    { name: 'tiles', type: 'array', desc: '窗口内地块，按 y 行 x 列排序。' },
    { name: 'tiles[].x / tiles[].y', type: 'number', desc: '地块坐标。' },
    { name: 'tiles[].terrain', type: "'plain' | 'grass' | 'forest' | 'hill' | 'desert' | 'marsh' | 'lake' | 'gold_mine'", desc: '地形（v19 新增 gold_mine 金矿：占领产金、掠夺为空池；加成映射见 GET_TILE 的字段说明）。' },
    { name: 'tiles[].kind', type: "'wilderness' | 'npc_city' | 'city'", desc: '地块类别：野地 / NPC 城池 / 玩家城池（主城与分城）。' },
    { name: 'tiles[].level', type: 'number', desc: `野地等级（1..${WILDERNESS_LEVEL_MAX}）或 NPC 城池等级（1..3）；玩家城池为 0。` },
    { name: 'tiles[].owner', type: 'object | null', desc: '占领者（占领野地或城池地块归属的城池）：{ accountId, username, cityId, cityName }；无主为 null。' },
    { name: 'tiles[].garrison', type: 'number', desc: '地块驻军总数；未占领野地为 0（原住守军不计入驻军总数；其编成见 GET_TILE 的 nativePower 与侦察）；NPC 城池需侦察（v17）：未侦察为 0，已侦察为最近一次侦察快照的总数。' },
    { name: 'tiles[].npcStockTier', type: "'rich' | 'normal' | 'low' | 'empty' | null", desc: "NPC 城池库存档位（v23 新增，AISLG-55）：相对该城初始库存——rich 丰厚（>60%）/ normal 一般（20%–60%）/ low 见底（<20%）/ empty 已空；只给档位不给精确数值（精确库存仍要走 SCOUT 侦察）；非 NPC 城为 null。掠夺后档位随库存变化，全服看到的档位一致。" },
    { name: 'tiles[].camp', type: 'object | null', desc: '黄巾营地 / 张角老巢（v29，AISLG-76）：地块上有进行中的营地时给出 { tier: small|medium|large|boss, label, level 守军强度对应的野地等级口径, garrisonTotal { min, max } 守军总兵力大概范围（当前存量 ±20%）, nextGrowAt 下次升档时刻（大营 / 老巢为 null）, boss? { stage: outer|keeper, recoversAt } }；其余为 null。营地格不显示野地原住守军，出征用 MARCH 掠夺任务（占领被拒）。详见 GET_YELLOW_TURBAN。' },
    { name: 'tiles[].famous', type: 'object | null', desc: '名城信息（v24 新增，AISLG-56）：{ name 名城名, stage 当前阶段（outer 外围阶段须先清外围 / keeper 外围已清、可攻城守并占领）, bonusPercent 占领后的独占加成（该城产量 +N%）, recoversAt 城守阶段外围恢复满编的时刻（超时无人攻下城守则恢复；外围阶段为 null） }；全图 8 座名城，对全服可见；非名城为 null。' },
  ],
  errors: [],
  examples: [
    {
      caption: '查询主城周边窗口',
      request: { op: Op.GET_WORLD_MAP, seq: 5 },
      responses: [
        {
          op: Op.GET_WORLD_MAP,
          seq: 5,
          ok: true,
          data: {
            size: WORLD_SIZE,
            x: 10,
            y: 14,
            w: DEFAULT_MAP_WINDOW,
            h: DEFAULT_MAP_WINDOW,
            tiles: [TILE_WILDERNESS, TILE_NPC_CITY],
          },
        },
      ],
    },
    {
      caption: 'w/h 非法（0 视为未提供、取缺省；起点越界按边界钳制——不返回错误，v17）',
      request: { op: Op.GET_WORLD_MAP, seq: 16, data: { x: 500, y: 500, w: 0 } },
      responses: [
        {
          op: Op.GET_WORLD_MAP,
          seq: 16,
          ok: true,
          data: {
            size: WORLD_SIZE,
            x: 0,
            y: 0,
            w: DEFAULT_MAP_WINDOW,
            h: DEFAULT_MAP_WINDOW,
            tiles: [],
          },
        },
      ],
    },
  ],
  agentNote: '探索与选目标的基础：先用它看周边野地等级与 NPC 城池位置，再 GET_TILE 看驻军与收益预览，最后 MARCH 出征。窗口参数非法时按缺省处理，不会报错。',
};

export const REQUEST_GET_TILE: RequestOpDoc = {
  kind: 'request',
  name: 'GET_TILE',
  title: '查询地块详情（v12 起；v13 起 NPC 城池详情需侦察）',
  preAuth: false,
  summary: `查询单个地块的作战与收益情报：野地收益预览（占领加成 + 驻军采集的小时速率）、未占领野地的原住守军参考战力（按等级推导的编成，见术语表「原住守军」）、驻军按兵种展开与掠夺冷却时间（v16 plunderedAt）。NPC 城池的驻防构成、可掠夺库存与驻军总数自 v13 起需要侦察：未对该地块发起过 SCOUT 时 tile.npc 为 null、garrison 为 0（v17 起，此前会返回真实总数）、garrisonDetail 全 0；已侦察返回**最近一次侦察的快照**（scoutedAt 为快照时间，不保证实时——重新侦察可刷新）。v23 起野地 / 玩家城池侦察过同样返回 scoutedAt（完整情报快照在 march_completed 事件的 detail.intel，AISLG-62）。`,
  requestFields: [
    { name: 'x', type: 'number', desc: `必填。地块 x，0..${WORLD_SIZE - 1}；越界或缺失返回 INVALID_PARAMS。` },
    { name: 'y', type: 'number', desc: `必填。地块 y，0..${WORLD_SIZE - 1}。` },
  ],
  dataFields: [
    { name: 'tile', type: 'object', desc: '地块详情；字段同 GET_WORLD_MAP 的 tiles[] ，另含以下字段。' },
    { name: 'tile.garrisonDetail', type: 'object', desc: '地块驻军按兵种展开：未占领野地返回**空对象 {}**（无驻军）；已占领野地按实际驻军展开（仅含有的兵种）；NPC 城池为侦察快照的驻防（未侦察为全 0）；玩家城池为空对象。' },
    { name: 'tile.nativePower', type: 'number', desc: '未占领野地的原住守军规模参考（v24：含该地块固定浮动与战后恢复进度的当前存量；v18 起定位为粗估，不构成胜负预测——它抹平了射程与速度克制；已占领野地、NPC 城池与玩家城池为 0）。' },
    { name: 'tile.wilderness', type: 'object | null', desc: '野地收益预览：{ resource 加成资源, bonusRate 占领加成/小时（= 基线 + 等级 × 每级增量，v21 加成保底：森林/草原/金矿 30+70×等级、平原/丘陵/荒漠 25+55×等级、沼泽 20+40×等级、湖泊 40+80×等级）, gatherRate 当前驻军采集/小时 }；非野地为 null。' },
    { name: 'tile.npc', type: 'object | null', desc: 'NPC 城池情报（v13 需侦察）：{ garrison 驻防按兵种（快照）, stock 可掠夺库存（快照）, scoutDetail / garrisonTotal（v27）}；未侦察或非 NPC 城为 null。**v27 起驻防精度随侦察科技**：scoutDetail=rough（侦察科技 Lv0–2）时 garrison 全 0，只有 garrisonTotal { min, max } 给总兵力约数（真实 ±20%）；kinds（Lv3–5）给兵种明细、各兵种数量为近似值（真实 ±20%，同一地块固定不变）；exact（Lv6+）精确。历史情报无 scoutDetail 字段，视为 exact。' },
    { name: 'tile.scoutedAt', type: 'string | null', desc: '最近一次侦察该地块的时间（ISO 8601，任意地块类型；v23 起非 NPC 城也返回）；从未侦察为 null。' },
    { name: 'tile.durability', type: 'number | null', desc: '他人分城的当前城防值（v40，AISLG-124）：0..100，按「免战截止前不回涨、之后每小时 +10」惰性结算展示；非 null 即可被 task=occupy 攻打的分城，归零一击换主。主城 / 野地 / NPC 城 / 自己的城为 null。' },
    { name: 'tile.protection', type: 'object | null', desc: '玩家城与他人占领野地的保护状态（v38 / v39）：{ newbieUntil 新手保护截止（含其野地）, truceUntil 被动免战截止（仅城池；野地恒 null——城级免战不保护野地）, shieldUntil 主动免战截止（含其野地）, ownerChangedUntil 换主保护截止（仅野地：刚被抢占后 1 小时基准随缩放，期间玩家与 NPC 都不能再抢） }，任一截止时刻未到即受保护（MARCH 被拒，错误码与时限见 MARCH）；非玩家目标、自己的地为 null。到期自动失效，无事件。' },
    { name: 'tile.plunderedAt', type: 'string | null', desc: `最近一次成功掠夺（攻方胜利）的时间（v16，ISO 8601）：距其 ${PLUNDER_COOLDOWN_HOURS} 小时内该地块处于掠夺冷却（基准值，实际受全局时间缩放等比缩短；MARCH task='plunder' 被拒，PLUNDER_COOLDOWN）；从未被掠为 null。` },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '查看一块 3 级森林野地（未占领）',
      request: { op: Op.GET_TILE, seq: 6, data: { x: 12, y: 17 } },
      responses: [
        {
          op: Op.GET_TILE,
          seq: 6,
          ok: true,
          data: {
            tile: {
              ...TILE_WILDERNESS,
              garrisonDetail: {},
              nativePower: armyPower(nativeGarrison(3)),
              wilderness: {
                resource: 'wood',
                bonusRate: wildernessBonusRate('forest', 3),
                gatherRate: 0,
              },
              npc: null,
              scoutedAt: null,
              plunderedAt: null,
            },
          },
        },
      ],
    },
    {
      caption: '坐标缺失（失败响应无 data）',
      request: { op: Op.GET_TILE, seq: 17, data: { x: 60 } },
      responses: [
        {
          op: Op.GET_TILE,
          seq: 17,
          ok: false,
          error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' },
        },
      ],
    },
  ],
  agentNote: `出征评估（v18 起改道）：参考战力只作规模粗估，不能用来预测胜负——它完全抹平了射程与速度克制（纯近战打守城远程可能全场 0 输出）。正确路径：① 对照「兵种与战斗属性」评估编队结构（前排承伤 + 远程输出 + 高速反远程，射程与速度见属性表）；② 野地守军编成按等级推导（见术语表「野地」），NPC 城池先 SCOUT 拿驻防快照（含 wallDefensePercent）；③ 战后用战报（GET_BATTLE_REPORTS）的逐回合统计复盘。参考战力数值：民夫 ${TROOP_POWER.porter} / 义兵·斥候 ${TROOP_POWER.militia} / 长枪兵 ${TROOP_POWER.pikeman} / 刀盾兵·弓箭兵 ${TROOP_POWER.swordsman} / 轻骑兵 ${TROOP_POWER.cavalry}。`,
};

export const REQUEST_MARCH: RequestOpDoc = {
  kind: 'request',
  name: 'MARCH',
  title: '出征 / 调兵 / 运输（从主城派兵，v12 起；v16 新增掠夺 / 占领任务；v26 新增运输任务）',
  preAuth: false,
  summary: `从账号主城派出部队前往目标地块，到达后由服务端自动结算。编队 troops 按兵种给出数量（至少一种 > 0），发起时立即从城内驻军扣减；行军时长 = Chebyshev 距离 × 每格秒数（基准 ${DEFAULT_MARCH_SECONDS_PER_TILE} 秒/格，占位）÷ **编队最慢兵种的行军速度系数**（斥候 ×2、轻骑兵 ×1.5，其余 ×1）÷（1 + 行军科技加成，v27 每级 +5%；v30 AISLG-83：自己城池之间的调兵 / 运输再加出发城**驿站**加成，每级 +10%、10 级翻倍，出征野地 / NPC 城等其他目标不受影响，运输往返与失效返程同吃出发城驿站），**总时长**再 ÷ 全局时间缩放、向上取整、最少 1 秒（见文档头部；不是先把每格缩放取整再乘格数）。以响应里的 arriveAt 为准。v16 新增可选 **task**：\`plunder\`（掠夺，**缺省值**）或 \`occupy\`（占领）——只作用于野地与 NPC 城目标，侦察 / 调兵 / 增援忽略 task。目标与结算：**无主野地**按 task 掠夺或占领（战斗 vs 原住守军）；**本账号占领的野地** = 增援驻军（不战斗）；**未被占领的 NPC 城池**可掠夺，也可占领变分城（v24，AISLG-58；战斗 vs 驻防、守方据墙待敌）；**本账号分城** = 调兵（不战斗，到达并入该城驻军）；**发起前校验校场（v30，AISLG-80）**：本城同时在外的部队数（行军中含返程 + 驻守野地，不计城内驻军）已达校场等级上限（未建校场按 1）时返回 DEPLOY_LIMIT，SCOUT 同；玩家城池（他人的）、他人占领地块与出发主城本身不可作为目标（玩家对抗随后续阶段开放）。**v38（AISLG-122，玩家对抗一）开放掠夺他人城池**：主城与分城都能打、不用宣战，战斗与 NPC 打主城同口径的守城战（城墙、城防科技、箭塔、守方城守全部生效），发起即给守方推送来袭预警（PUSH_ATTACK_WARNING，预警窗口 = 行军时长，敌情按守方烽火台分档）；守方处于新手保护返回 NEWBIE_PROTECTED、免战中返回 TARGET_IN_TRUCE（均附 until / retryAfterSeconds），攻方自己的主动免战生效中返回 SELF_TRUCE_ACTIVE（打野地 / NPC 不受限）；**task=occupy 对他人分城开放（v40，AISLG-124，玩家对抗三）**：主城仍返回 TASK_INVALID_FOR_TARGET（永不可占领，只能被掠夺）。分城占领资格与占 NPC 城同口径（GOVERNMENT_TOO_LOW / BRANCH_LIMIT / TARGET_LEVEL_TOO_HIGH，目标等级 = 该城官府等级），发起时初核、到达复核（名额没了照打、只降城防值不换主，事件 battle_won 记 occupied=false 与 denial）。守城战打赢一次（守军全灭）城防值 −35，攻方幸存冲车占比每 1% 再 +1.5（最多 +15）；**占领打赢不掠夺资源，掠夺打赢不降城防**；城防降到 0 且名额有空当场换主（详见「玩家对抗与城防值」一节与 GET_TILE 的 tile.durability）；每次打赢该城进入 4 小时（基准随缩放）被动免战，免战内城防不回涨、结束后每小时回涨 10 至满——占一座分城至少打 3 次、隔 8 小时以上，守方每次都有时间补兵 / 增援；在途到达时守方进入保护 / 免战则扑空返程（事件 outcome=aborted 附 cause）。**v39（AISLG-123，玩家对抗二）开放抢占他人占领的野地**：task='occupy'（缺省 plunder 返回 TASK_INVALID_FOR_TARGET——地里没有存货可抢）；野地战无城墙 / 箭塔 / 城守，守方 = 地块驻军，守方没留驻军不打、直接拿下（无战报）；发起即给守方推 PUSH_ATTACK_WARNING（target='wilderness'，敌情按其所属城烽火台分档），预警期间可向该地块增援（MARCH 打自己的地块 = 增援）；守方处于新手保护（NEWBIE_PROTECTED）或主动免战（TARGET_IN_TRUCE）时其全部野地不可被抢，但守方某座城的被动免战只保护城本身、不保护野地；地块处于换主保护期（被抢占后 1 小时基准随缩放）返回 TILE_PROTECTED；攻方自己的主动免战生效中同样不能抢（SELF_TRUCE_ACTIVE）。**抢占结算**：打赢且出发城占领名额（官府等级）有空 → 地块易主、幸存部队驻守并获得加成、地块进入换主保护（1 小时基准随缩放，玩家与 NPC 都不能再抢）；名额已满 → 守方照样失地（wilderness_lost cause=conquest）、地块变无主（不设保护）、攻方幸存返程（事件 battle_won 记 occupied=false / denial=TERRITORY_LIMIT）；打输 → 守方继续占领，攻方残部返程；战报 kind='pvp_wilderness' 攻守双方各一份。**到达复核口径（v39）**：到达时地块已无主（对方召回等）→ 扑空返程（aborted，cause=target_gone）；已易主第三人 → 扑空返程（aborted，cause=owner_changed）；已归本账号 → 转增援并入驻军。战斗为多回合推进结构（速度与射程影响接敌、城墙为守方提供受击减免；具体算法不对外公开，机制概览见术语表「战斗」、兵种数值见「兵种与战斗属性」）；攻方歼灭守方获胜、胜方幸存 ≥ 1，攻方战败（全灭或回合耗尽）时幸存部队撤回出发城。**掠夺结算（task=plunder）**：野地奖励池 = 地形对应资源 × ${PLUNDER_POOL_RESOURCE_PER_LEVEL} × 等级 + 金币 × ${PLUNDER_POOL_GOLD_PER_LEVEL} × 等级（v21 掠夺含金，AISLG-31；金矿 gold_mine 保持空池——金矿定位占领生息）；NPC 城 = 持久化库存（v21 起含金币；库存不再生、掠空后无收益）。实际带走量按**幸存部队负重**装填（Σ 数量 × 单兵 carry，v27 起再 × 负重科技加成（每级 +5%，向下取整）；运输任务的负重上限同口径：民夫 ${TROOP_CARRY.porter}、斥候/刀盾兵 ${TROOP_CARRY.scout}、轻骑兵 ${TROOP_CARRY.cavalry}，其余 ${TROOP_CARRY.militia}，占位），按**金→粮→木→石→铁**顺序装满即止，立即入账出发城（不钳储量上限）；不改归属、幸存部队返程；成功掠夺的地块进入 ${PLUNDER_COOLDOWN_HOURS} 小时冷却（基准，受全局时间缩放；发起时校验 PLUNDER_COOLDOWN——v22 起该失败附 retryAfterSeconds（冷却截止 − 当前时刻，等满后重发必然受理；在途到达仍战斗但资源为零）。**掠夺玩家城（v38，AISLG-122）**：可抢池 = 城内资源先扣仓库保护（粮/木/石/铁 各保护 1000×仓库等级，金币不受保护），再乘单次比例上限（四资源 45%、金币 15%，v42 AISLG-126 校准拍板）与等级差衰减（出发城官府比目标城官府高 5 级起每多 1 级收益 −15%、最低 25%——大号打小号不禁止但收益递减），最后仍按幸存部队负重装填；攻破（守军全灭）后该城进入 4 小时（基准，随缩放）被动免战，玩家与 NPC 都不能再打它（GET_TILE 的 tile.protection 可查）；战报 kind='pvp_raid'，攻守双方各得一份；玩家城不受地块掠夺冷却限制（免战即冷却）。**名城（v24，AISLG-56，GET_TILE / 地图的 famous 字段标识，全图 8 座）分两阶段**：外围阶段对其出征（掠夺 / 占领都一样）打的是外围驻军（野战无城墙），打赢 = 外围清空、名城进入城守阶段（事件 battle_won 含 stage='outer'、outerCleared=true、recoversAt），无战利品；城守阶段（限时，超时外围恢复满编）再出征攻城守——task=plunder 掠夺其库存，task=occupy 占领并变分城（以名城命名、产量 +20%，名城计入分城上限）；外围未清时对其 task=occupy 返回 OUTER_NOT_CLEARED。名城守军 = 同等级普通 NPC 城 × 3（外围与城守各一半）。**占领 NPC 城（task=occupy，v24）**：需同时满足——主城官府 ≥ 3 级（GOVERNMENT_TOO_LOW）；分城数 < 分城上限 = floor(主城官府等级 ÷ 3)（BRANCH_LIMIT，名城同样计入）；目标 NPC 城等级 ≤ 出发城的官府等级（TARGET_LEVEL_TOO_HIGH）。发起时初核，Worker 到达时复核（不满足则胜利后不建分城、幸存部队返程，事件 battle_won 记录 occupied=false 与 denial）。打赢后该城成为分城：接收 NPC 城的建筑与**剩余库存**，幸存部队进城驻守，分城可独立建造 / 征兵 / 出征（城池类协议带 cityId）；占领不受掠夺冷却限制，不另行掠夺（库存随城移交）。**占领野地结算（task=occupy 目标为野地）**：无一次性战利品；该城占领野地数低于官府等级（上限 = 官府等级，随官府升级提高）时改归属、幸存部队驻守并获得持续加成；发起时初核 TERRITORY_LIMIT，到达复核（超限则胜利后不改归属、幸存部队返程，事件记录 occupied=false / denial=TERRITORY_LIMIT）。每场战斗生成一份战报（GET_BATTLE_REPORTS 可查、PUSH_BATTLE_REPORT 推送）。`,
  requestFields: [
    { name: 'x', type: 'number', desc: `必填。目标地块 x，0..${WORLD_SIZE - 1}。` },
    { name: 'y', type: 'number', desc: `必填。目标地块 y，0..${WORLD_SIZE - 1}。` },
    { name: 'troops', type: 'object', desc: '必填。按兵种的派出数量（未知兵种、负数、非整数或全 0 返回 INVALID_PARAMS）；超过城内驻军返回 INSUFFICIENT_TROOPS。' },
    { name: 'task', type: "'plunder' | 'occupy' | 'transport'", desc: '可选（v16）。出征任务：plunder=掠夺（缺省）、occupy=占领（野地占领驻守；NPC 城占领变分城，v24）、transport=运输（v26，AISLG-79，目标只能是本账号的另一座城，须同时带 cargo）；plunder / occupy 仅野地与 NPC 城目标接受，非法值返回 INVALID_PARAMS。缺省 plunder 对 v15 及以前不带 task 的客户端是破坏性语义变更（旧式请求从「战斗并占领」变为「掠夺」）。' },
    { name: 'targetId', type: 'string', desc: '可选（v28，AISLG-78）。截击移动目标：目标 id（GET_MOVING_TARGETS）；此时 (x, y) 须是该目标路线上正在或将要经过的格（已过去的格 / 不在路线上返回 INVALID_PARAMS；目标不存在 / 已消失返回 MOVING_TARGET_GONE），task 被忽略、带 cargo 返回 INVALID_PARAMS。v35（AISLG-112）「到了先埋伏」：目标路线与时刻表固定，发起时即把 arriveAt 定为预计接战时刻 = max(部队到达时刻, 目标进入该格相邻范围（Chebyshev ≤ 1）的时刻)——提前到达的部队原地埋伏等目标经过，无需掐点；到达时目标已走出范围（太晚）仍按到达时刻结算、扑空返程。格式非 UUID 返回 INVALID_PARAMS。' },
    { name: 'heroId', type: 'string', desc: MARCH_HERO_FIELD_DESC },
    { name: 'cargo', type: 'object', desc: `task=transport 时必填（v26）：运送的资源 { gold, wood, food, stone, iron }，各项缺省 0、须为非负整数，总量 ≥ 1（缺失 / 全 0 / 未知键 / 非法值返回 INVALID_PARAMS）；其余任务带 cargo 同样返回 INVALID_PARAMS。总量不得超过所派编队的负重（Σ 数量 × 单兵 carry，民夫 ${TROOP_CARRY.porter}、斥候/刀盾兵 ${TROOP_CARRY.scout}、轻骑兵 ${TROOP_CARRY.cavalry}，其余 ${TROOP_CARRY.militia}，与掠夺共用同一张表），超出返回 CARGO_OVER_CAPACITY；出发城现有资源不够返回 INSUFFICIENT_RESOURCES。` },
  ],
  dataFields: [
    { name: 'march.id', type: 'string', desc: '行军 UUID。' },
    { name: 'march.fromCityId', type: 'string', desc: '出发城池（当前恒为主城）。' },
    { name: 'march.x / march.y', type: 'number', desc: '涉及地块坐标：plunder / occupy / scout / transfer / attack = 目标地块；return = 折返涉及的地块。' },
    { name: 'march.troops', type: 'object', desc: '编队（按兵种补全为完整计数）。' },
    { name: 'march.purpose', type: "'plunder' | 'occupy' | 'reinforce' | 'scout' | 'transfer' | 'transport' | 'intercept' | 'return' | 'attack'", desc: '掠夺出征 / 占领出征 / 增援自有野地 / 侦察 / 调兵 / 运输（v26）/ 截击移动目标（v28）/ 返程；attack 仅升级前已发出的在途行军（legacy 结算：金币战利品与 NPC 占领）。' },
    { name: 'march.status', type: "'marching' | 'arrived' | 'returned'", desc: 'marching=行军中；arrived=到达并结算；returned=返程回城。' },
    { name: 'march.initiator', type: "'player' | 'agent'", desc: '发起连接声明的登录类型。' },
    { name: 'march.startedAt / march.arriveAt', type: 'string', desc: '出发与预计到达 / 接战时间（ISO 8601）。截击埋伏中（march.ambushAt 非 null）的 arriveAt 为预计接战时刻。' },
    { name: 'march.ambushAt', type: 'string | null', desc: '截击埋伏开始时刻（v35，AISLG-112）：部队提前到达选定格、原地埋伏等目标经过的时刻；到达即接战 / 太晚扑空与其他行军为 null。' },
    { name: 'march.heroId', type: 'string | null', desc: '随队武将 id（v36，AISLG-114）：带 heroId 出征的行军及其返程行军有值（武将随残部回家），其余为 null。武将占用与状态见 GET_HEROES。' },
    { name: 'march.resolvedAt', type: 'string | null', desc: '实际结算时间；行军中为 null。' },
    { name: 'march.targetId', type: 'string | null', desc: '截击的移动目标 id（v28，AISLG-78）：purpose=intercept 及其撤回后的返程行军有值，其余为 null。' },
    { name: 'march.cargo', type: 'object | null', desc: '随行运送的资源（v26，Resources 形）：运输行军及其被撤回 / 目标失效后的返程行军携带，其余为 null。' },
  ],
  errors: ['INVALID_PARAMS', 'INSUFFICIENT_RESOURCES', 'CARGO_OVER_CAPACITY', 'DEPLOY_LIMIT', 'MOVING_TARGET_GONE', 'TARGET_NOT_ATTACKABLE', 'INSUFFICIENT_TROOPS', 'PLUNDER_COOLDOWN', 'TASK_INVALID_FOR_TARGET', 'TERRITORY_LIMIT', 'GOVERNMENT_TOO_LOW', 'BRANCH_LIMIT', 'TARGET_LEVEL_TOO_HIGH', 'OUTER_NOT_CLEARED', 'NEWBIE_PROTECTED', 'TARGET_IN_TRUCE', 'SELF_TRUCE_ACTIVE', 'TILE_PROTECTED'],
  examples: [
    {
      caption: `掠夺出征 3 级森林野地（20 义兵 + 4 弓箭兵，约 ${MARCH_TRAVEL_SECONDS}s 后到达）`,
      request: { op: Op.MARCH, seq: 7, data: { x: 12, y: 17, troops: { militia: 20, archer: 4 }, task: 'plunder' } },
      responses: [{ op: Op.MARCH, seq: 7, ok: true, data: { march: MARCH_VIEW } }],
    },
    {
      caption: '占领出征（缺省即掠夺；task=occupy 需显式携带）',
      request: { op: Op.MARCH, seq: 8, data: { x: 13, y: 18, troops: { militia: 20 }, task: 'occupy' } },
      responses: [{ op: Op.MARCH, seq: 8, ok: true, data: { march: { ...MARCH_VIEW, x: 13, y: 18, troops: { ...EMPTY_ARMY, militia: 20 }, purpose: 'occupy' } } }],
    },
    {
      caption: '截击运粮商队：目标 id 来自 GET_MOVING_TARGETS，(x, y) 取其路线上的某一格',
      request: { op: Op.MARCH, seq: 17, data: { x: 21, y: 32, troops: { militia: 30 }, targetId: '9b2f7a10-3c4d-4e5f-8a6b-7c8d9e0f1a2b' } },
      responses: [{ op: Op.MARCH, seq: 17, ok: true, data: { march: { ...MARCH_VIEW, x: 21, y: 32, troops: { ...EMPTY_ARMY, militia: 30 }, purpose: 'intercept', targetId: '9b2f7a10-3c4d-4e5f-8a6b-7c8d9e0f1a2b' } } }],
    },
    {
      caption: '运输：从主城向分城 (13,18) 运 800 粮 + 300 木（5 个民夫负重 2500）',
      request: { op: Op.MARCH, seq: 11, data: { x: 13, y: 18, troops: { porter: 5 }, task: 'transport', cargo: { food: 800, wood: 300 } } },
      responses: [{ op: Op.MARCH, seq: 11, ok: true, data: { march: { ...MARCH_VIEW, x: 13, y: 18, troops: { ...EMPTY_ARMY, porter: 5 }, purpose: 'transport', cargo: { gold: 0, wood: 300, food: 800, stone: 0, iron: 0 } } } }],
    },
    {
      caption: '他人占领的地块被拒（附当前城池状态）',
      request: { op: Op.MARCH, seq: 9, data: { x: 5, y: 5, troops: { militia: 10 } } },
      responses: [
        {
          op: Op.MARCH,
          seq: 9,
          ok: false,
          error: { code: 'TARGET_NOT_ATTACKABLE', message: '该目标当前不可出征（地图外、自己的出发城或他人占领的地块等）' },
          data: { city: { id: CITY_ID, army: EMPTY_ARMY, marches: [], territory: [] } },
        },
      ],
    },
    {
      caption: '掠夺冷却中的地块被拒（PLUNDER_COOLDOWN）',
      request: { op: Op.MARCH, seq: 10, data: { x: 12, y: 17, troops: { militia: 10 }, task: 'plunder' } },
      responses: [
        {
          op: Op.MARCH,
          seq: 10,
          ok: false,
          error: { code: 'PLUNDER_COOLDOWN', message: '该地块处于掠夺冷却中（已被成功掠夺，冷却未结束，无法再次发起掠夺）' },
        },
      ],
    },
  ],
  agentNote: `到达结算产生 march_completed 事件（purpose=plunder 时 outcome=plunder_won：含 loot 战利品、carry 负重、returning 返程行军 id；purpose=occupy 时 outcome=battle_won：含 occupied（false 时附 denial：野地为 TERRITORY_LIMIT，NPC 城为 GOVERNMENT_TOO_LOW / BRANCH_LIMIT / TARGET_LEVEL_TOO_HIGH；NPC 城占领成功另含 cityId）），战斗另生成战报。掠夺量由幸存部队的负重封顶——想多带资源就多派民夫（单兵 carry ${TROOP_CARRY.porter}，其余兵种 ${TROOP_CARRY.archer}–${TROOP_CARRY.cavalry}）；同一地块 ${PLUNDER_COOLDOWN_HOURS} 小时（基准）只能成功掠夺一次（GET_TILE 的 plunderedAt 可判冷却截止），占领不受冷却限制但受官府等级上限。**黄巾营地 / 老巢（v29，AISLG-76）**：目标格有进行中的营地（TileView.camp 非 null）时，MARCH 的掠夺任务即清剿营地——野战（无城墙）打营地当前守军（战后存量每小时恢复 25%），歼灭的黄巾单位数累计为贡献（输赢都算）；普通营地打赢消失并按幸存部队负重（含负重科技）装填掉落池（金 + 四资源）即时入账，清剿数 +1，达到 80% 出现老巢；老巢外围阶段打赢 = 外围清空（无战利品，限时内进入城守阶段），城守阶段打赢 = 老巢被击破（掉落 + 首杀播报 + 事件收场）；输方幸存部队撤回。task=occupy 返回 TASK_INVALID_FOR_TARGET，不受掠夺冷却限制。战报 kind='yellow_turban'，事件 march_completed 的 outcome=camp_won / camp_lost / boss_outer_cleared / boss_won（含 killed 歼敌数、campTier、stage）。**截击移动目标（带 targetId，v28，AISLG-78；v35 AISLG-112 改为「到了先埋伏」）**：目标路线与时刻表固定，发起时就把 arriveAt 定为预计接战时刻 = max(部队到达时刻, 目标进入选定格相邻范围（Chebyshev 距离 ≤ 1）的时刻)——部队提前到达则原地埋伏（MarchView.ambushAt 为埋伏开始时刻）等目标经过再开打，不必掐点；到达时目标已走出范围（太晚）→ 按到达时刻结算、「扑空」返程。接战为野战（无城墙，守军即目标守军，打赢目标消失，按幸存部队负重（含负重科技）装填其携带的资源即时入账，不钳储量上限；打输幸存部队撤回、目标原样留存）；目标已被他人击败或过时 → 「目标消失」，不接战、部队返程。埋伏期间部队照常占校场名额、按在外口径耗粮，可 RECALL_MARCH 撤回。三种结果都有战报（kind='intercept'，扑空 / 消失时 contact='missed' / 'gone'、endReason='no_contact'、rounds=0）与 march_completed 事件（outcome=intercepted / intercept_lost / intercept_missed / intercept_gone）。**运输（task=transport，v26，AISLG-79）**：目标必须是本账号的另一座城（出发城自身 / 野地 / NPC 城 / 他人城池返回 TASK_INVALID_FOR_TARGET）。发起即从出发城扣除 cargo 与派出部队；到达后货物**即时入账**目标城（与掠夺所得同规则：不钳储量上限），部队自动返程回出发城；运输队不会被 NPC 拦截（与「NPC 不攻击行军中的部队」同口径）；途中 RECALL_MARCH 撤回时货物随部队回到出发城，到达目标前目标城失效（如账号重置）同理带回。到达产生两条 march_completed 事件：出发城一条 outcome='transported'（含 cargo / cityId / cityName / returning），目标城一条 outcome='transport_received'（cityId 指向目标城，含 cargo / fromCityName）。同账号在线连接还会收到 PUSH_MARCH_STATE / PUSH_TILE_STATE / PUSH_BATTLE_REPORT。离线期间服务端照常结算，上线后用 GET_EVENTS（sinceId）补读。行军途中可 RECALL_MARCH 折返；城内驻军在 city.army，出征中的部队不在其中。`,
};

export const REQUEST_RECALL_GARRISON: RequestOpDoc = {
  kind: 'request',
  name: 'RECALL_GARRISON',
  title: '召回野地驻军（放弃占领，v12）',
  preAuth: false,
  summary: `撤回本账号占领野地上的**全部**驻军：召回发起即放弃占领（地块回到无主野地、原住守军重新满编），部队作为返程行军（purpose=return）回到占领它的城池，到达后才并入城内驻军。行军时长与出征同公式。野地占领以驻军存在为前提：驻军被 NPC 袭击全灭时占领同样失效（见 NPC 袭击说明）。`,
  requestFields: [
    { name: 'x', type: 'number', desc: '必填。地块 x（须为本账号占领的野地，见 GET_STATE 的 city.territory）。' },
    { name: 'y', type: 'number', desc: '必填。地块 y。' },
  ],
  dataFields: [
    { name: 'march', type: 'object | null', desc: '返程行军视图（结构与 MARCH 响应相同，purpose=return）；地块无驻军时为 null（占领同时清除）。' },
  ],
  errors: ['INVALID_PARAMS', 'TILE_NOT_OCCUPIED'],
  examples: [
    {
      caption: '召回 (12,17) 的驻军',
      request: { op: Op.RECALL_GARRISON, seq: 9, data: { x: 12, y: 17 } },
      responses: [
        {
          op: Op.RECALL_GARRISON,
          seq: 9,
          ok: true,
          data: {
            march: {
              ...MARCH_VIEW,
              purpose: 'return',
              troops: { ...EMPTY_ARMY, militia: 9 },
            },
          },
        },
      ],
    },
    {
      caption: '目标不是本账号占领的野地（失败响应无 data）',
      request: { op: Op.RECALL_GARRISON, seq: 18, data: { x: 60, y: 581 } },
      responses: [
        {
          op: Op.RECALL_GARRISON,
          seq: 18,
          ok: false,
          error: { code: 'TILE_NOT_OCCUPIED', message: '该地块未被本账号占领，无法召回驻军' },
        },
      ],
    },
  ],
  agentNote: '召回即弃地：占领加成与采集立即停止（产量在归属翻转前先结算到当前时刻），地块可被他人或 NPC 夺取。返程部队到达前不在城内驻军里，无法再次派出。',
};

export const PUSH_MARCH_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_MARCH_STATE',
  title: '推送：行军状态变化（v12）',
  summary: `行军状态变化时推送给该账号所有在线连接（发起连接除外）：march_started=出征或召回发起、march_arrived=出征到达并结算（战斗 / 掠夺 / 占领结果见 march_completed 事件）、march_returned=返程部队回城并入驻军。purpose 取值与 MARCH 响应相同（v16 新增 plunder / occupy / reinforce；attack 仅存量在途行军）。`,
  dataFields: [
    { name: 'reason', type: "'march_started' | 'march_arrived' | 'march_returned'", desc: '触发本次推送的状态变化。' },
    { name: 'march', type: 'object', desc: '行军视图，字段与 MARCH 响应相同；arrived/returned 时 resolvedAt 非空。' },
  ],
  examples: [
    { op: Op.PUSH_MARCH_STATE, push: true, data: { reason: 'march_started', march: MARCH_VIEW } },
    {
      op: Op.PUSH_MARCH_STATE,
      push: true, data: { reason: 'march_arrived', march: { ...MARCH_VIEW, status: 'arrived', resolvedAt: MARRIVE_AT } },
    },
  ],
  agentNote: '收到 march_arrived 后读 GET_EVENTS 的 march_completed 事件取胜负与战利品明细（v16：plunder_won 含 loot / carry / returning；battle_won 在占领被拒时含 occupied=false 与 denial）；march_returned 把 march.troops 并入本地 city.army。',
};

export const PUSH_NPC_ATTACK_WARNING: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_NPC_ATTACK_WARNING',
  title: '推送：NPC 袭击预警（v23，AISLG-57）',
  summary: `NPC 出兵后不再立刻结算：先给被袭击账号发预警（预警提前量 = 袭击基准间隔的 1/8，当前基准 120 分钟 → 15 分钟，随全局时间缩放），到达时刻才结算战斗。预警含目标位置、预计到达时刻与敌情（兵力范围恒有；烽火台 v31 起按等级附各兵种范围 / 精确编成，见 intel）；推给被袭击账号的全部在线连接（含 Agent 连接），同时落一条 npc_attack_warning 事件（断线可补拉）。预警期间可以增援（REINFORCE 目标的 MARCH）、撤回驻军（RECALL_GARRISON，弃守）或不管——到达时按**当时**的驻军结算，增援部队参与防守；目标已不再被占领则袭击作废（不战斗）。`,
  dataFields: [
    { name: 'attackId', type: 'string', desc: '本次袭击的 id（预警与结算一一对应；仅用于对账，无对应查询协议）。' },
    { name: 'x / y', type: 'number', desc: '被袭击地块坐标（主城袭击即主城坐标）。' },
    { name: 'target', type: "'wilderness' | 'city'", desc: 'wilderness = 袭击占领野地；city = 袭击主城（走守城战）。' },
    { name: 'terrain', type: 'string | null', desc: '目标地形（仅野地袭击有值；主城为 null）。' },
    { name: 'level', type: 'number', desc: '袭击强度等级（野地 = 地块等级；主城 = 按发起时守军战力推导的袭击等级）。' },
    { name: 'armyMin / armyMax', type: 'number', desc: '大致兵力范围（总单位数 ±20% 取整）；恒有。' },
    { name: 'intel', type: "'range' | 'kinds' | 'exact'", desc: '敌情详细度（v31，AISLG-81）：由**被袭击城**（占领野地算其所属城）的烽火台等级决定——0–2 级 range（只有总兵力范围，同过去）/ 3–5 级 kinds（另给 armyKinds 各兵种 ±20% 范围）/ 6 级起 exact（另给 army 精确兵种与数量）。同样适用于黄巾之乱大营发出的进攻。' },
    { name: 'beaconLevel', type: 'number', desc: '被袭击城的烽火台等级（v31；0 = 未建）。' },
    { name: 'armyKinds', type: 'object', desc: '仅 intel=kinds：各兵种大致数量范围 { 兵种: { min, max } }（±20% 取整）。' },
    { name: 'army', type: 'object', desc: '仅 intel=exact：精确编成 { 兵种: 数量 }。' },
    { name: 'arriveAt', type: 'string', desc: '预计到达时刻（ISO 8601；已按 timeScale 缩放，与实际结算时刻一致）。烽火台每级让预警提前量 +10%（10 级翻倍）：袭击从发起到到达的时长 = 基础提前量 ×（1 + 0.1 × 烽火台等级），预警在发起时即发出。' },
  ],
  examples: [
    { op: Op.PUSH_NPC_ATTACK_WARNING, push: true, data: { attackId: '3f1c2a4e-0000-4000-8000-000000000001', x: 128, y: 90, target: 'wilderness', terrain: 'forest', level: 2, armyMin: 17, armyMax: 27, arriveAt: '2026-10-01T08:15:00.000Z' } },
  ],
  agentNote: '收到预警即是行动信号：比较 arriveAt 与现在，决定增援（向 (x,y) 发 MARCH task=occupy? 不——增援自有野地直接 MARCH 即可，目标为本账号地块自动转为增援）、撤回驻军（RECALL_GARRISON 弃守保兵）或不管。到达结算仍会生成 npc_raid 事件与守方战报（PUSH_BATTLE_REPORT）。',
};

export const PUSH_TILE_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_TILE_STATE',
  title: '推送：地块归属 / 驻军变化（v12）',
  summary: `地块状态变化时推送给相关账号的在线连接：wilderness_occupied=野地被占领（含己方出征获胜）、wilderness_lost=占领失效（召回或 NPC 袭击失守）、npc_city_occupied=NPC 城池被占领为分城、npc_attack_repelled=NPC 袭击被击退（驻军折损）、garrison_reinforced=增援并入驻军。`,
  dataFields: [
    { name: 'reason', type: 'string', desc: '触发本次推送的变化类别（见 summary）。' },
    { name: 'tile', type: 'object', desc: '变化后的地块视图，字段与 GET_WORLD_MAP 的 tiles[] 相同。' },
  ],
  examples: [
    { op: Op.PUSH_TILE_STATE, push: true, data: { reason: 'wilderness_occupied', tile: TILE_OWNED } },
  ],
  agentNote: `NPC 会周期性袭击玩家占领的野地（袭击部队编成按野地等级推导，参考战力 = 等级 × ${armyPower(npcRaidArmy(1))}，定稿编成；基准每 30 分钟随机袭击一块已占领野地，v19 校准；实际 ÷ 全局时间缩放）：收到 wilderness_lost（cause=npc_attack）说明驻军全灭，用 GET_STATE 对齐领土与驻军；袭击结算同样生成守方视角战报。`,
};
