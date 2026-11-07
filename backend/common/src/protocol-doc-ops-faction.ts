// 五方势力的对外文档（AISLG-239，v99）：GET_FACTIONS（op 154）。
// 地块上的势力归属见 protocol-doc-ops-world.ts 的 tiles[].faction；老巢不可出征的错误码见
// protocol-doc.ts 的 FACTION_LAIR_TARGET；半径扩大的全服播报见 protocol-doc-ops-agent.ts。
import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
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
  summary: `查询本季的五方势力（只读、无参数、玩家与 Agent 通用）。五家：${LAIR_TEXT}。每家有自己的老巢与地盘：势力范围是以老巢为中心的方块，半径随本季天数变大（${RADIUS_TEXT}，按本季实际开始时间算，与 time_scale 无关），两家范围重叠的格归离老巢更近的一家（距离相同时按上表顺序取先出现的一家）。开季时老巢周围 ${FACTION_INITIAL_RADIUS} 格内的 NPC 城全部归该势力，之后每家每 ${FACTION_SWALLOW_INTERVAL_MS / 3_600_000} 小时（随 time_scale 缩放）在当前范围内随机吞一座无主 NPC 城；名城、玩家城与已被其他势力吞下的城不会被吞。被吞的城仍是普通 NPC 城，可以侦察 / 掠夺 / 占领，只有两点不同：守军与可掠夺库存是同等级普通 NPC 城的 ${FACTION_CITY_MULTIPLIER} 倍，地块的 faction 字段标出归属（见 GET_WORLD_MAP / GET_TILE）；玩家占下后这座城不再属于势力。老巢坐标对全服公开、不受战争迷雾影响，但老巢本版本不可出征（MARCH / SCOUT 打到老巢返回 FACTION_LAIR_TARGET）。总开关 faction_enabled 默认关闭：关闭时本协议返回 enabled=false、factions 为空数组，地块不带势力归属，世界里也没有老巢。`,
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
  agentNote: `势力城是你附近最好找的掠夺 / 占领目标：它们散在整片地盘上（不是全挤在老巢周围），守军与库存是同等级普通 NPC 城的 ${FACTION_CITY_MULTIPLIER} 倍，打下来能带走更多、占领后分城库存也更厚。老巢周围 ${FACTION_LAIR_CLEAR_RADIUS} 格内没有玩家城，所以别把坐标 (${FACTIONS.map((def) => `${def.lair.x}, ${def.lair.y}`).join(') / (')}) 当成选址目标——注册落位与迁城都会避开那几块地方，派兵去老巢会被拒绝（FACTION_LAIR_TARGET）。本版本势力不出兵、不抢你的城，势力城被占下后归属立即消失；范围之外的老巢与地盘随本季天数增长，第 22 天起半径 250 格。faction_enabled 关闭的服上这些字段全部为空，忽略即可。`,
};
