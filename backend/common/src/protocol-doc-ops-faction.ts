// 五方势力的对外文档（AISLG-239，v99）：GET_FACTIONS（op 154）。
// 地块上的势力归属见 protocol-doc-ops-world.ts 的 tiles[].faction；老巢不可出征的错误码见
// protocol-doc.ts 的 FACTION_LAIR_TARGET；半径扩大的全服播报见 protocol-doc-ops-agent.ts。
import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { FACTIONS, FACTION_LAIR_CLEAR_RADIUS, FACTION_RADIUS_STEPS, FACTION_SWALLOW_INTERVAL_MS, FACTION_CITY_MULTIPLIER, FACTION_INITIAL_RADIUS } from './faction';

const LAIR_TEXT = FACTIONS.map((def) => `${def.name}（${def.nameEn}，首领${def.leader}）在 (${def.lair.x}, ${def.lair.y})`).join('；');
const RADIUS_TEXT = FACTION_RADIUS_STEPS.map((step, index) => {
  const next = FACTION_RADIUS_STEPS[index + 1];
  const range = next ? `第 ${step.fromDay}~${next.fromDay - 1} 天` : `第 ${step.fromDay} 天起`;
  return `${range} ${step.radius} 格`;
}).join('、');

export const REQUEST_GET_FACTIONS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_FACTIONS',
  title: '查询五方势力（v99，AISLG-239）',
  preAuth: false,
  summary: `查询本季的五方势力（只读、无参数、玩家与 Agent 通用）。五家：${LAIR_TEXT}。势力会出兵（v100，AISLG-240）：范围内的 NPC 袭击带势力旗号，本季满 7 天后每家还会围攻范围内玩家分城（规则见 PUSH_FACTION_SIEGE）。每家有自己的老巢与地盘：势力范围是以老巢为中心的方块，半径随本季天数变大（${RADIUS_TEXT}，按本季实际开始时间算，与 time_scale 无关），两家范围重叠的格归离老巢更近的一家（距离相同时按上表顺序取先出现的一家）。开季时老巢周围 ${FACTION_INITIAL_RADIUS} 格内的 NPC 城全部归该势力，之后每家每 ${FACTION_SWALLOW_INTERVAL_MS / 3_600_000} 小时（随 time_scale 缩放）在当前范围内随机吞一座无主 NPC 城；名城、玩家城与已被其他势力吞下的城不会被吞。被吞的城仍是普通 NPC 城，可以侦察 / 掠夺 / 占领，只有两点不同：守军与可掠夺库存是同等级普通 NPC 城的 ${FACTION_CITY_MULTIPLIER} 倍，地块的 faction 字段标出归属（见 GET_WORLD_MAP / GET_TILE）；玩家占下后这座城不再属于势力。老巢坐标对全服公开、不受战争迷雾影响；v101（AISLG-241）起老巢可以打：每家老巢分 20 营，每次进攻只打当前一营（守城战、城墙减伤 50%），当前营打掉多少算多少、打输也保留残血，营清空才进下一营、已打掉的营不会回来（连续 24 小时没人进攻恢复 1 营），每营战力 = 全服战力前 10 名合计 ÷ 15（每天刷新、只升不降、最低 10,000）；20 营全部清空这家本季灭亡（不再吞城 / 围攻、势力城变回普通 NPC 城、老巢变废墟，最后一击的玩家拿首领名将）。本季已灭亡（destroyed = true）的老巢不能再出征，MARCH / SCOUT 仍返回 FACTION_LAIR_TARGET。总开关 faction_enabled 默认关闭：关闭时本协议返回 enabled=false、factions 为空数组，地块不带势力归属，世界里也没有老巢。`,
  requestFields: [],
  dataFields: [
    { name: 'enabled', type: 'boolean', desc: '势力总开关（settings 的 faction_enabled，默认关闭）。false 时下面各字段为空值，世界里没有势力内容。' },
    { name: 'day', type: 'number', desc: '本季第几天（1 起算，按本季实际开始时间，不随 time_scale 变化）；enabled=false 时为 0。' },
    { name: 'radius', type: 'number', desc: `当前势力范围半径（格，切比雪夫距离，五家相同）：第 1~7 天 100、8~14 天 150、15~21 天 200、22 天起 250；enabled=false 时为 0。` },
    { name: 'serverTime', type: 'string', desc: '服务端时刻（ISO 8601）。' },
    { name: 'factions', type: 'array', desc: '五方势力；enabled=false 或本季还没有生成老巢时为空数组。' },
    { name: 'factions[].key', type: "'liangzhou' | 'wuhuan' | 'nanman' | 'shanyue' | 'heishan'", desc: '势力标识：凉州军 / 乌桓 / 南蛮 / 山越 / 黑山军。' },
    { name: 'factions[].name', type: 'string', desc: '中文名（如「凉州军」）。' },
    { name: 'factions[].nameEn', type: 'string', desc: '英文名（如 Liangzhou Rebels）。' },
    { name: 'factions[].leader', type: 'string', desc: '首领中文名（如「韩遂」）。' },
    { name: 'factions[].leaderEn', type: 'string', desc: '首领英文名（如 Han Sui）。' },
    { name: 'factions[].lair', type: 'object', desc: '老巢坐标 { x, y }，对全服公开（不受战争迷雾影响）。老巢周围 5 格内不会有玩家城。' },
    { name: 'factions[].radius', type: 'number', desc: '这家当前的势力范围半径（与本季半径相同，逐家给出便于客户端直接画范围）。' },
    { name: 'factions[].cityCount', type: 'number', desc: '这家当前持有的势力城数（被玩家占下的城立即不算）。' },
    { name: 'factions[].destroyed', type: 'boolean', desc: '（v101，AISLG-241）这家本季已被攻破（灭亡）：不再吞城 / 围攻、不再画范围、老巢是废墟，换季重生。' },
    { name: 'factions[].campsTotal', type: 'number', desc: '（v101）老巢的营数（共 20 营）。' },
    { name: 'factions[].campsRemaining', type: 'number', desc: '（v101）剩余营数（含当前营；0 = 已灭亡）。' },
    { name: 'factions[].campRemainingPercent', type: 'number', desc: '（v101）当前营剩余守军百分比 0~100（满营 100；每次打输保留残血，百分比随之下降）。' },
    { name: 'factions[].campPower', type: 'number', desc: '（v101）每营守军参考战力（全服战力前 10 名合计 ÷ 15，每天刷新、只升不降、最低 10,000）。' },
  ],
  errors: [],
  examples: [
    {
      caption: '开关打开（第 9 天，半径 150）',
      request: { op: Op.GET_FACTIONS, seq: 11, data: {} },
      responses: [
        {
          op: Op.GET_FACTIONS,
          seq: 11,
          ok: true,
          data: {
            enabled: true,
            day: 9,
            radius: 150,
            serverTime: '2026-11-10T04:00:00.000Z',
            factions: [
              {
                key: 'liangzhou',
                name: '凉州军',
                nameEn: 'Liangzhou Rebels',
                leader: '韩遂',
                leaderEn: 'Han Sui',
                lair: { x: 80, y: 80 },
                radius: 150,
                cityCount: 51,
                destroyed: false,
                campsTotal: 20,
                campsRemaining: 17,
                campRemainingPercent: 42,
                campPower: 256000,
              },
            ],
          },
        },
      ],
    },
    {
      caption: '开关关闭（默认）',
      request: { op: Op.GET_FACTIONS, seq: 12, data: {} },
      responses: [
        {
          op: Op.GET_FACTIONS,
          seq: 12,
          ok: true,
          data: { enabled: false, day: 0, radius: 0, serverTime: '2026-11-10T04:00:00.000Z', factions: [] },
        },
      ],
    },
  ],
  agentNote: `势力城是你附近最好找的掠夺 / 占领目标：它们散在整片地盘上（不是全挤在老巢周围），守军与库存是同等级普通 NPC 城的 ${FACTION_CITY_MULTIPLIER} 倍，打下来能带走更多、占领后分城库存也更厚。老巢周围 ${FACTION_LAIR_CLEAR_RADIUS} 格内没有玩家城，所以别把坐标 (${FACTIONS.map((def) => `${def.lair.x}, ${def.lair.y}`).join(') / (')}) 当成选址目标——注册落位与迁城都会避开那几块地方，派兵去老巢会被拒绝（FACTION_LAIR_TARGET）。势力确实会打人（v100，AISLG-240）：范围内的 NPC 袭击会带上势力旗号（PUSH_NPC_ATTACK_WARNING 的 faction / 事件 npc_attack_warning.detail.faction，如「南蛮来袭」），本季满 7 天后每家还会围攻范围内离老巢最近的玩家分城（见 PUSH_FACTION_SIEGE 与事件 faction_siege_warning / faction_siege / faction_city_lost）——主城与名城分城不会被围攻，城被吞后变成该势力的势力城，建筑与库存都在里面，任何玩家都能按占领 NPC 城的流程打回来。势力城被占下后归属立即消失；范围之外的老巢与地盘随本季天数增长，第 22 天起半径 250 格。v101（AISLG-241）起老巢可以打：MARCH（task=plunder）指向老巢坐标，一次只打当前一营（守城战、城墙减伤 50%），当前营守军打掉多少算多少、打输也保留残血，营清空才进下一营、已打掉的营不会回来（连续 24 小时没人进攻恢复 1 营）；每营战力 = 全服战力前 10 名合计 ÷ 15（每天刷新、只升不降、最低 10,000），编成按 义兵 100 : 刀盾 30 : 弓箭 40 : 轻骑 12 缩放。每场按歼灭的守军战力发金币 2 / 木粮石铁各 10（打输也发、不占负重），声望按歼灭战力的 1%；打掉最后一营的玩家拿该势力首领名将（韩遂 / 蹋顿 / 孟获 / 费栈 / 张燕，全服唯一），灭亡时按贡献（累计歼灭守军战力）名次再发一次（数额是黄巾之乱同名次的 3 倍）。任何玩家都能打，不要求入盟、不算攻击玩家、不破新手保护；打之前先 SCOUT 看当前营守军，SCOUT / GET_FACTIONS 都能看到剩余营数与当前营百分比。faction_enabled 关闭的服上这些字段全部为空、也没有旗号与围攻，忽略即可。`,
};

export const PUSH_FACTION_LAIR: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_FACTION_LAIR',
  title: '推送：老巢战况（v101，AISLG-241）',
  summary: `老巢战况变化，全服在线连接都会收到（老巢是全服共同目标）：attacked = 有人打了老巢（守军残血或打掉一营，看 campsRemaining 判断是不是进了下一营）；recovered = 连续 24 小时没人进攻，恢复 1 营；destroyed = 最后一营被清空，这家本季灭亡。收到后重拉 GET_FACTIONS 对齐即可；灭亡另有全服播报 faction_lair_destroyed（带最后一击的玩家名）。`,
  dataFields: [
    { name: 'reason', type: "'attacked' | 'recovered' | 'destroyed'", desc: 'attacked 有人进攻（含打掉一营）；recovered 恢复 1 营；destroyed 本季灭亡。' },
    { name: 'faction', type: 'object', desc: '{ key, name, nameEn }：哪一家。' },
    { name: 'campsTotal', type: 'number', desc: '老巢的营数（共 20 营）。' },
    { name: 'campsRemaining', type: 'number', desc: '剩余营数（含当前营；destroyed 时为 0）。' },
    { name: 'campRemainingPercent', type: 'number', desc: '当前营剩余守军百分比 0~100。' },
    { name: 'destroyed', type: 'boolean', desc: '这家本季是否已灭亡。' },
  ],
  examples: [
    {
      op: Op.PUSH_FACTION_LAIR,
      push: true,
      data: {
        reason: 'attacked',
        faction: { key: 'nanman', name: '南蛮', nameEn: 'Nanman' },
        campsTotal: 20,
        campsRemaining: 17,
        campRemainingPercent: 42,
        destroyed: false,
      },
    },
    {
      op: Op.PUSH_FACTION_LAIR,
      push: true,
      data: {
        reason: 'destroyed',
        faction: { key: 'nanman', name: '南蛮', nameEn: 'Nanman' },
        campsTotal: 20,
        campsRemaining: 0,
        campRemainingPercent: 0,
        destroyed: true,
      },
    },
  ],
  agentNote: `这是全服广播，与你自己的账号无关；用来及时更新「还剩几营」。真要打之前请先 SCOUT 老巢坐标拿到当前营守军（剩余百分比只是粗略进度），再按自己的全部战力估一下这一营打不打得掉——打不完也保留残血、奖励照发，所以能打就打。灭亡（destroyed）后这家本季不能再打，等换季重生。`,
};

export const PUSH_FACTION_SIEGE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_FACTION_SIEGE',
  title: '推送：势力围攻分城（v100，AISLG-240）',
  summary: `五方势力出兵打玩家分城：本季满 7 天后，每家势力在自己范围内选**离老巢最近的玩家分城**围攻（同一时间最多围 1 座，同一座城 6 小时最多打一次）。每次围攻提前 60 分钟预警（吃烽火台加成，敌情详细度也按烽火台等级分档，与 NPC 袭击预警同一套），预警时给出**当前城防值**。围城军战力 = 该分城官府等级 × 倍率（第 8~14 天 100、15~21 天 150、22 天起 200，随 time_scale 无关），编成按 3 级 NPC 城守军的比例（义兵 100 : 刀盾 30 : 弓箭 40 : 轻骑 12）缩放，不带冲车；战斗走守城战，城墙 / 箭塔 / 城防器械 / 城守 / 协防全部生效。势力打赢（全灭守军）扣 35 城防、城进入 4 小时被动免战、不掠夺资源；城防归零时城被吞，变成该势力的 NPC 城。被围城的主人与驻扎在该城的协防方都会收到本推送（reason 相同、内容相同）。等价事件：faction_siege_warning（预警）/ faction_siege（结算）/ faction_city_lost（失城）。`,
  dataFields: [
    { name: 'reason', type: "'warning' | 'repelled' | 'hit' | 'swallowed'", desc: 'warning 预警（提前 60 分钟 × 烽火台加成）；repelled 这家势力打输了（守住了，该势力 24 小时内不再打这座城）；hit 这家势力打赢一次、城防被扣、城进入 4 小时被动免战；swallowed 城防归零、城被吞（原主人腾出分城名额）。' },
    { name: 'siegeId', type: 'string', desc: '围攻编号（同一次围攻的预警与结算用同一个 id，可用于去重）。' },
    { name: 'faction', type: 'object', desc: '{ key, name, nameEn }：是哪一家（如 { key: "nanman", name: "南蛮", nameEn: "Nanman" }）。' },
    { name: 'cityId', type: 'string', desc: '被围攻的城 id（城被吞后该城已不存在，仍给出原 id）。' },
    { name: 'cityName', type: 'string | null', desc: '城池名（查不到时为 null）。' },
    { name: 'x', type: 'number', desc: '城池坐标 x。' },
    { name: 'y', type: 'number', desc: '城池坐标 y。' },
    { name: 'power', type: 'number', desc: '围城军参考战力（= 官府等级 × 倍率）。' },
    { name: 'arriveAt', type: 'string', desc: 'warning：预计到达（结算）时刻（ISO 8601，已按 time_scale 缩放）。' },
    { name: 'armyMin', type: 'number', desc: 'warning：围城军兵力范围下限（编成总单位数 −20% 取整）。' },
    { name: 'armyMax', type: 'number', desc: 'warning：围城军兵力范围上限（+20%）。' },
    { name: 'intel', type: "'range' | 'kinds' | 'exact'", desc: 'warning：敌情详细度（烽火台 3 级起给各兵种范围、6 级起给精确编成，与来袭预警同口径）。' },
    { name: 'beaconLevel', type: 'number', desc: 'warning：被围城的烽火台等级（0 = 未建）。' },
    { name: 'armyKinds', type: 'object', desc: 'warning（intel=kinds）：{ 兵种: { min, max } }。' },
    { name: 'army', type: 'object', desc: 'warning（intel=exact）：精确编成 { 兵种: 数量 }。' },
    { name: 'durability', type: 'number', desc: '被围城当前城防值（warning 与 hit / swallowed 都给；hit / swallowed 时为本次结算前的值）。' },
    { name: 'damage', type: 'number', desc: 'hit / swallowed：本次扣除的城防值（围城军不带冲车，恒为 35）。' },
    { name: 'durabilityAfter', type: 'number', desc: 'hit / swallowed：结算后的城防值（swallowed 恒为 0）。' },
    { name: 'protectedUntil', type: 'string', desc: 'hit：城进入 4 小时被动免战的截止时刻（ISO 8601，免战期内城防不回涨）。' },
  ],
  examples: [
    {
      op: Op.PUSH_FACTION_SIEGE,
      push: true,
      data: {
        reason: 'warning',
        siegeId: '7c9c2a10-0000-4000-8000-000000000010',
        faction: { key: 'nanman', name: '南蛮', nameEn: 'Nanman' },
        cityId: '3f0b1e2a-0000-4000-8000-000000000002',
        cityName: '分城(180,930)',
        x: 180,
        y: 930,
        power: 500,
        durability: 65,
        arriveAt: '2026-11-14T12:00:00.000Z',
        armyMin: 210,
        armyMax: 320,
        intel: 'range',
        beaconLevel: 0,
      },
    },
    {
      op: Op.PUSH_FACTION_SIEGE,
      push: true,
      data: {
        reason: 'hit',
        siegeId: '7c9c2a10-0000-4000-8000-000000000010',
        faction: { key: 'nanman', name: '南蛮', nameEn: 'Nanman' },
        cityId: '3f0b1e2a-0000-4000-8000-000000000002',
        cityName: '分城(180,930)',
        x: 180,
        y: 930,
        power: 500,
        durability: 65,
        damage: 35,
        durabilityAfter: 30,
        protectedUntil: '2026-11-14T16:00:00.000Z',
      },
    },
  ],
  agentNote: `收到 warning 时先看 durability：城防 100 起，每次被围城军打赢扣 35（两次之间只回涨一点点），所以城防 ≤ 35 的城下一轮就会丢。增援要在 arriveAt 之前进城门（MARCH task=reinforce / 协防 MARCH task=assist 都可，守城战里协防部队与城主驻军合并成守方）；把驻军塞满通常就能守住——常规驻军（义兵 30 × 官府等级 + 弓箭 8 × 官府等级）对上 1.0 倍围城军时全灭概率很低，而驻军只剩一半时大概率失守。守住的城该势力 24 小时内不会再来。城被吞（swallowed）后：建筑与等级留在城里、剩余资源变成这座势力城的可掠夺库存，任何玩家都能按占领 NPC 城的流程打下它并接收建筑与库存；原主人腾出分城名额，且打回来不受放弃分城冷却限制。每家势力每周最多吞 2 座城（一周按本季第 8、15、22 天起算），主城与名城分城永远不会被围攻。`,
};
