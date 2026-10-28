// 城防器械协议的对外文档（CRAFT_DEFENSE / CANCEL_DEFENSE_CRAFT / PUSH_DEFENSE_STATE，v73，AISLG-193）。
// 数值引用 common/src/city-defense.ts 的真实常量，保证文档与服务端一致。

import { Op } from './protocol';
import {
  DEFENSE_INFO,
  DEFENSE_KINDS,
  DEFENSE_STOCK_PER_WALL_LEVEL,
  defenseBatchSeconds,
  defenseCost,
  type DefenseKind,
} from './city-defense';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { CITY_ID, STARTED_AT } from './protocol-doc-shared';
import { atBaseTimeScale } from './time-scale';

const CRAFT_ID = '3f7c9a1e-2d4b-4c6a-9e8f-1a2b3c4d5e6f';

const DEFENSE_TABLE = DEFENSE_KINDS.map((kind) => {
  const info = DEFENSE_INFO[kind];
  const cost = `${info.cost.gold}/${info.cost.wood}/${info.cost.food}/${info.cost.stone}/${info.cost.iron}`;
  return `${info.label}（${kind}）：${info.effect}；单件成本 金/木/粮/石/铁 = ${cost}，单件 ${info.seconds}s`;
}).join('；');

const FIRST_SECONDS = atBaseTimeScale(() => defenseBatchSeconds('trap', 10));

const CRAFT_VIEW = {
  id: CRAFT_ID,
  cityId: CITY_ID,
  kind: 'trap' as DefenseKind,
  count: 10,
  status: 'crafting' as const,
  initiator: 'player' as const,
  cost: defenseCost('trap', 10),
  unitSeconds: DEFENSE_INFO.trap.seconds,
  startedAt: STARTED_AT,
  dueAt: new Date(Date.parse(STARTED_AT) + FIRST_SECONDS * 1000).toISOString(),
  completedAt: null,
};

export const REQUEST_CRAFT_DEFENSE: RequestOpDoc = {
  kind: 'request',
  name: 'CRAFT_DEFENSE',
  title: '打造城防器械（v73，AISLG-193）',
  preAuth: false,
  summary: `在城墙里打造四种一次性守城器械（${DEFENSE_TABLE}）。发起时立即从该城扣资源，入库在打造完成时（Worker 结算）。库存上限 = 城墙等级 × ${DEFENSE_STOCK_PER_WALL_LEVEL}（四种器械共用；城墙 10 级 600、20 级 1200、名城 25 级 1500），校验把在造 + 排队的件数也算进去（超出返回 DEFENSE_STOCK_FULL，附 cap / stock / pending）。队列与征兵同模型：1 条在造 + 2 条排队（队满 DEFENSE_QUEUE_FULL）；无在造时立即开工（status=crafting，dueAt 非空），批次总时长 = max(1 秒, floor(单件基准 × 件数 ÷ time_scale))；有在造时入队（status=queued，dueAt 为 null）。校验顺序：城墙未建（WALL_NOT_BUILT）→ 库存上限 → 队列 → 资源。守城战开打时器械按需自动使用、用掉就没了（陷阱 / 拒马开战即用，滚木 / 擂石在攻方贴墙时用），用量与杀伤见战报的 defenses 字段。`,
  requestFields: [
    { name: 'kind', type: `'${DEFENSE_KINDS.join("' | '")}'`, desc: '必填。器械种类：trap 陷阱 / chevaux 拒马 / rolling_log 滚木 / boulder 擂石；缺失或未知返回 INVALID_PARAMS。' },
    { name: 'count', type: 'number', desc: `必填。件数（正整数，且与库存 + 在造 + 排队合计不超过城墙等级 × ${DEFENSE_STOCK_PER_WALL_LEVEL}）；成本 = 单件成本 × 件数。` },
    { name: 'cityId', type: 'string', desc: '可选。在哪座城打造（缺省主城）；城墙等级、库存与扣资源都按该城。' },
  ],
  dataFields: [
    { name: 'craft', type: 'object', desc: '新建的打造条目 { id, cityId, kind, count, status, initiator, cost 成本快照, unitSeconds 单件基准秒数, startedAt, dueAt（排队为 null）, completedAt }。' },
    { name: 'stock', type: 'object', desc: '发起后该城已入库的四种器械件数（不含在造 / 排队）。' },
    { name: 'cap', type: 'number', desc: '该城库存上限（城墙等级 × 60）。' },
  ],
  errors: ['INVALID_PARAMS', 'WALL_NOT_BUILT', 'DEFENSE_STOCK_FULL', 'DEFENSE_QUEUE_FULL', 'INSUFFICIENT_RESOURCES'],
  examples: [
    {
      caption: `打造 10 件陷阱（约 ${FIRST_SECONDS}s 后完成）`,
      request: { op: Op.CRAFT_DEFENSE, seq: 21, data: { kind: 'trap', count: 10 } },
      responses: [
        {
          op: Op.CRAFT_DEFENSE,
          seq: 21,
          ok: true,
          data: { craft: CRAFT_VIEW, stock: { trap: 0, chevaux: 0, rolling_log: 0, boulder: 0 }, cap: 600 },
        },
      ],
    },
    {
      caption: '超出库存上限（城墙 10 级、已入库 590、在造 20，再下 10 件）',
      request: { op: Op.CRAFT_DEFENSE, seq: 22, data: { kind: 'chevaux', count: 10 } },
      responses: [
        {
          op: Op.CRAFT_DEFENSE,
          seq: 22,
          ok: false,
          error: { code: 'DEFENSE_STOCK_FULL', message: '器械库存已达上限（城墙等级 × 60，四种器械共用），先把库存用在守城或升级城墙' },
          data: { cap: 600, stock: 590, pending: 20 },
        },
      ],
    },
  ],
  agentNote: '守城器械只在被攻打时自动消耗，不会被掠夺。被打前先补库存：城墙 10 级囤满 600 件约等于守军多两成战力。四种按威胁配比：对手步兵多造陷阱、骑兵多造拒马、带冲车必须备擂石、通用近战压力造滚木。队列满了（1 在造 + 2 排队）先等或取消。',
};

export const REQUEST_CANCEL_DEFENSE_CRAFT: RequestOpDoc = {
  kind: 'request',
  name: 'CANCEL_DEFENSE_CRAFT',
  title: '取消打造（v73，AISLG-193）',
  preAuth: false,
  summary: '取消排队中（queued）或打造中（crafting）的器械条目：按发起时的成本快照全额返还到该城，库存不变；该城排队的下一条立即开工（同事务激活，推送 craft_started）。与 Worker 到点完成按条件守卫并发，先翻转状态者生效。',
  requestFields: [
    { name: 'craftId', type: 'string', desc: '必填。要取消的打造条目 id（GET_STATE 的 city.defenses.queue 中条目的 id）；缺失或格式非法返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'craft', type: 'object', desc: '被取消的打造条目（status=cancelled，completedAt 为 null）。' },
  ],
  errors: ['INVALID_PARAMS', 'DEFENSE_NOT_CANCELLABLE'],
  examples: [
    {
      caption: '取消进行中的打造',
      request: { op: Op.CANCEL_DEFENSE_CRAFT, seq: 23, data: { craftId: CRAFT_ID } },
      responses: [{ op: Op.CANCEL_DEFENSE_CRAFT, seq: 23, ok: true, data: { craft: { ...CRAFT_VIEW, status: 'cancelled', dueAt: null } } }],
    },
  ],
  agentNote: '取消全额返还，但会丢掉这段时间的进度；只是缺资源的话优先等完成，别反复取消重下。',
};

export const PUSH_DEFENSE_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_DEFENSE_STATE',
  title: '推送：打造状态变化（v73，AISLG-193）',
  summary: '打造开始 / 入队 / 完成入库 / 取消时推给同账号全部在线连接（发起连接已拿到响应，不回推）。收到后建议 GET_STATE 重新对齐 city.defenses。',
  dataFields: [
    { name: 'reason', type: "'craft_started' | 'craft_queued' | 'craft_completed' | 'craft_cancelled'", desc: '开工（含排队条目被激活）/ 入队 / 完成入库 / 取消返还。' },
    { name: 'craft', type: 'object', desc: '打造条目视图（结构同 CRAFT_DEFENSE 的 craft）。' },
    { name: 'stock', type: 'object', desc: '该城当前四种器械的已入库件数。' },
    { name: 'cap', type: 'number', desc: '该城库存上限（城墙等级 × 60）。' },
  ],
  examples: [
    {
      op: Op.PUSH_DEFENSE_STATE,
      push: true,
      data: { reason: 'craft_completed', craft: { ...CRAFT_VIEW, status: 'completed', completedAt: CRAFT_VIEW.dueAt }, stock: { trap: 10, chevaux: 0, rolling_log: 0, boulder: 0 }, cap: 600 },
    },
  ],
};
