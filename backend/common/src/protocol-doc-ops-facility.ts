// 野地设施（望楼）的对外文档（AISLG-232，v97）：FACILITY_BUILD。
// 数值直引 common/src/facility.ts，文档示例按未加速基准（atBaseTimeScale）渲染，与文档头部「全局时间缩放」一致。
// 视野规则见战争迷雾一节（GET_WORLD_MAP / PUSH_TILE_STATE 的说明）。
import { Op } from './protocol';
import {
  FACILITY_MAX_LEVEL,
  FACILITY_PER_CITY_LIMIT,
  facilityTotalCost,
  facilityUpgradeCost,
  facilityUpgradeSeconds,
  watchtowerVisionRadius,
} from './facility';
import type { RequestOpDoc } from './protocol-doc';
import { atBaseTimeScale } from './time-scale';
import { CITY_ID } from './protocol-doc-shared';

/** 各级数值一览（摘要引用，保持与 facility.ts 同步） */
const LEVEL_SUMMARY = [1, 2, 3]
  .map((level) => {
    const cost = facilityUpgradeCost('watchtower', level - 1);
    const seconds = atBaseTimeScale(() => facilityUpgradeSeconds('watchtower', level - 1) ?? 0);
    return `${level} 级：视野 ${watchtowerVisionRadius(level)} 格，金 ${cost?.gold} / 木 ${cost?.wood} / 石 ${cost?.stone}，基准 ${seconds} 秒`;
  })
  .join('；');
const TOTAL = facilityTotalCost('watchtower');

export const REQUEST_FACILITY_BUILD: RequestOpDoc = {
  kind: 'request',
  name: 'FACILITY_BUILD',
  title: '在野地上建望楼 / 升级望楼（v97，AISLG-232）',
  preAuth: false,
  summary: `在自己**已占领的野地**上建望楼：没盖过就新建 1 级，盖过就升一级（最高 ${FACILITY_MAX_LEVEL} 级）。望楼是野地上的了望塔，建好后这块地周围的视野扩大到对应半径——别人也看得到你的望楼（想断你的眼睛就得把这块地抢走）。规则：只能盖在 kind = 'wilderness' 且归你城池的格上（城池 / NPC 城 / 无主地 / 别人的野地返回 FACILITY_TILE_INVALID）；每块地最多一座，每座城名下的野地最多 ${FACILITY_PER_CITY_LIMIT} 座（主城 ${FACILITY_PER_CITY_LIMIT} 座、每座分城各 ${FACILITY_PER_CITY_LIMIT} 座，新建时计名额，升级已有望楼不受影响）；同一块地同一时间只能有一个进行中的建造 / 升级（FACILITY_BUILDING）。数值（占位，按需求一字不改）：${LEVEL_SUMMARY}；满级累计金 ${TOTAL.gold} / 木 ${TOTAL.wood} / 石 ${TOTAL.stone}。**资源从占着这块地的那座城扣**；耗时为基准 ÷ 全局时间缩放、不低于 1 秒，但**不吃**「建筑」科技折扣。望楼**不占城池建造队列**，用自己的计时（响应里的 facility.building.finishAt），由后台 Worker 到期完成。视野半径是切比雪夫距离，**取代**野地原来的 ${3} 格、不叠加；丘陵上的野地在此基础上 +2（AISLG-233：视野 8 / 10 / 12，上限 12），下发的 visionRadius 已是加成后的有效值；视野照常记入已探索；迷雾开关 fog_enabled 关闭时望楼仍可建，但不产生视野效果。失去野地（被抢、所属城易主 / 被放弃、召回驻军放弃占领、账号长期未上线被收回，v98 AISLG-238）望楼一并毁掉，不转给新主人、不退资源，原主人收到事件 facility_lost；储量采空不影响望楼。玩家与 Agent 走同一个接口。`,
  requestFields: [
    { name: 'x', type: 'number', desc: '必填。目标地块 x（须为本账号城池占领的野地，见 GET_STATE 的 city.territory）。' },
    { name: 'y', type: 'number', desc: '必填。目标地块 y。' },
  ],
  dataFields: [
    {
      name: 'facility',
      type: 'object',
      desc: `该地块的设施（与 GET_STATE 的 city.territory[].facility 同结构）：{ kind: 'watchtower', level 已建成等级（正在新建第一级时为 0）, visionRadius 已建成等级的视野半径（格；level 为 0 时 0；丘陵上的野地是加成后的有效半径 8 / 10 / 12，AISLG-233）, building: { toLevel 进行中的目标等级, finishAt 完成时刻 ISO 8601 } | null }。`,
    },
    {
      name: 'city',
      type: 'object',
      desc: '扣费后的城池状态（结构同 GET_STATE 的 city；资源从占着这块地的那座城扣）。失败时只附 city 与缺口字段。',
    },
  ],
  errors: ['INVALID_PARAMS', 'FACILITY_TILE_INVALID', 'FACILITY_BUILDING', 'FACILITY_MAX_LEVEL', 'FACILITY_LIMIT', 'INSUFFICIENT_RESOURCES'],
  examples: [
    {
      caption: '在自己的野地上新建 1 级望楼（扣 金 300 / 木 200 / 石 100，基准 120 秒后完成）',
      request: { op: Op.FACILITY_BUILD, seq: 41, data: { x: 512, y: 340 } },
      responses: [
        {
          op: Op.FACILITY_BUILD,
          seq: 41,
          ok: true,
          data: {
            facility: { kind: 'watchtower', level: 0, visionRadius: 0, building: { toLevel: 1, finishAt: '2026-09-25T08:02:00.000Z' } },
            city: { id: CITY_ID, resources: { gold: 4700, wood: 4800, food: 5000, stone: 2900, iron: 3000 }, territory: [] },
          },
        },
      ],
    },
    {
      caption: '这座城名下的望楼已满 2 座',
      request: { op: Op.FACILITY_BUILD, seq: 42, data: { x: 513, y: 340 } },
      responses: [
        {
          op: Op.FACILITY_BUILD,
          seq: 42,
          ok: false,
          error: { code: 'FACILITY_LIMIT', message: '这座城名下的望楼已达上限（每座城最多 2 座）' },
          data: { limit: FACILITY_PER_CITY_LIMIT, count: FACILITY_PER_CITY_LIMIT },
        },
      ],
    },
  ],
  agentNote:
    '望楼能扩大视野（1 级 6 格 / 2 级 8 格 / 3 级 10 格，取代野地原来的 3 格），是「提前看到别人部队」的手段；失去这块野地就失去望楼（不退款），抢别人的野地就能拆掉他的眼睛。先 GET_STATE 看 city.territory[].facility（null = 没盖）挑一块战略位置上的野地，再看这座城的资源够不够：不够会返回 INSUFFICIENT_RESOURCES（附缺口 shortfall 与 retryAfterSeconds），等够再发。建造中用 city.territory[].facility.building 的 finishAt 估算进度，到点后服务端完成（事件 facility_completed），期间再发同一块地会返回 FACILITY_BUILDING。',
};
