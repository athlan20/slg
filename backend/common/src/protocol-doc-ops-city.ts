// 城池管理类协议的对外文档（CANCEL_BUILD / RENAME_CITY / PUSH_CITY_STATE）。
// 建造与推送类见 protocol-doc-ops-build.ts；账号与查询类及 OP_DOC 汇总见 protocol-doc-ops.ts；
// 共用示例常量见 protocol-doc-shared.ts。

import { Op } from './protocol';
import { INITIAL_RESOURCES } from './rules';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { EMPTY_ARMY } from './protocol-doc-army-consts';
import {
  CANCELLED_BUILD_VIEW,
  CITY_ID,
  INITIAL_BUILDINGS_VIEW,
  INITIAL_LEVELS,
  INITIAL_COSTS,
  INITIAL_POPULATION_VIEW,
  INITIAL_STORAGE,
  QUEUED_BUILD_VIEW,
  INITIAL_PRODUCTION,
  exampleCity,
} from './protocol-doc-shared';

export const REQUEST_CANCEL_BUILD: RequestOpDoc = {
  kind: 'request',
  name: 'CANCEL_BUILD',
  title: '取消建造条目（排队中 / 建造中）',
  preAuth: false,
  summary:
    '取消建造队列中 status=queued（排队中）或 status=building（建造中）的条目：该条目退出队列（status 变为 cancelled，保留为历史，不再出现在 city.queue），发起时扣减的成本按条目上的成本快照全额返还（2026-09-27 确认规则，全额返还）。建造中取消时建筑等级不变（升级中取消则保持当前等级），该城排队的下一条立即开工（同一事务激活，推送 build_started）。连续升级（toLevel）进行中取消：已完成的级保留等级、不退，只返还未完成级的成本。已完成 / 已取消的条目返回 BUILD_NOT_CANCELLABLE。',
  requestFields: [
    { name: 'buildId', type: 'string', desc: '必填。要取消的建造条目 UUID（GET_STATE 的 city.queue 中 queued / building 条目的 id）；缺失返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'build', type: 'object', desc: '建造视图，结构与 BUILD 响应相同；status 为 cancelled。' },
  ],
  errors: ['INVALID_PARAMS', 'BUILD_NOT_CANCELLABLE'],
  examples: [
    {
      caption: '取消排队中的伐木场（成本返还）',
      request: { op: Op.CANCEL_BUILD, seq: 1, data: { buildId: QUEUED_BUILD_VIEW.id } },
      responses: [{ op: Op.CANCEL_BUILD, seq: 1, ok: true, data: { build: CANCELLED_BUILD_VIEW } }],
    },
    {
      caption: '取消已完成的条目被拒（附当前城池状态）',
      request: { op: Op.CANCEL_BUILD, seq: 2, data: { buildId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' } },
      responses: [
        {
          op: Op.CANCEL_BUILD,
          seq: 2,
          ok: false,
          error: { code: 'BUILD_NOT_CANCELLABLE', message: '建造任务不存在、不属于本账号或已完成 / 已取消，无法取消' },
        },
      ],
    },
  ],
  agentNote:
    '先 GET_STATE 拿 city.queue 中条目的 id 再取消（排队中与建造中都可取消）。取消后该类型可以立即重新发起 BUILD；建造中取消的成本全额回来，别忘了它排队的下一条已自动开工。同账号其他在线连接会收到 PUSH_BUILD_STATE（build_cancelled，以及下一条的 build_started）推送。',
};

export const REQUEST_RENAME_CITY: RequestOpDoc = {
  kind: 'request',
  name: 'RENAME_CITY',
  title: '城池改名',
  preAuth: false,
  summary: '为一座城池改名（v7；缺省主城，v24 起可传 cityId 给分城改名）。名称去掉首尾空白后须为 1..24 字符，允许中英文与数字。',
  requestFields: [
    { name: 'name', type: 'string', desc: '必填。新城池名（trim 后 1..24 字符）；缺失、为空或超长返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'cityId', type: 'string', desc: '改名的城池 UUID。' },
    { name: 'name', type: 'string', desc: '新城池名（等于请求的 name 去首尾空白）。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '改名成功',
      request: { op: Op.RENAME_CITY, seq: 1, data: { name: '临江城' } },
      responses: [{ op: Op.RENAME_CITY, seq: 1, ok: true, data: { cityId: CITY_ID, name: '临江城' } }],
    },
    {
      caption: '名称为空被拒',
      request: { op: Op.RENAME_CITY, seq: 2, data: { name: '   ' } },
      responses: [
        { op: Op.RENAME_CITY, seq: 2, ok: false, error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' } },
      ],
    },
  ],
  agentNote:
    '改名写入事件流（city_renamed），同账号其他在线连接收到 PUSH_CITY_STATE（city_renamed）推送。改名是覆盖式操作，不保留历史名称。',
};

export const REQUEST_DISCARD_CITY: RequestOpDoc = {
  kind: 'request',
  name: 'DISCARD_CITY',
  title: '放弃分城',
  preAuth: false,
  summary:
    '主动放弃一座分城（v57，AISLG-153）：分城转回 NPC 城池，腾出分城名额；主城不可放弃。城内资源、驻军、建筑与建造 / 征兵 / 研究队列作废（不返还），城守武将解除任命、武将本身保留；名下野地转为无主；地块回到同级 NPC 城池（名城恢复为未攻破的名城）。放弃后本账号冷却 = 放弃时的官府等级 天（按时间缩放，占位），冷却内不能再占回该城（占领时返回 DISCARD_COOLDOWN）。发起前须满足：该城没有部队在外（行军 / 返程 / 运输 / 侦察）、该城与其名下野地没有正在途中的行军、没有未结的 NPC 来袭、名下野地无驻军（先用 RECALL_MARCH 召回）。放弃不可撤销，必须显式携带 confirm=true 防误触。',
  requestFields: [
    { name: 'cityId', type: 'string', desc: '必填。要放弃的分城 UUID（GET_STATE 的 cities[].id，且 isMain 为 false）。缺失返回 INVALID_PARAMS；主城返回 DISCARD_MAIN_CITY。' },
    { name: 'confirm', type: 'boolean', desc: '必填，必须为 true；缺失或不为 true 返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'cityId', type: 'string', desc: '被放弃的分城 UUID（该城已从账号名下移除）。' },
    { name: 'x / y', type: 'number', desc: '原分城地块坐标（已转回 NPC 城池）。' },
    { name: 'cooldownUntil', type: 'string', desc: 'ISO 8601：冷却截止时刻；之前本账号再占领该 NPC 城返回 DISCARD_COOLDOWN。' },
  ],
  errors: ['INVALID_PARAMS', 'DISCARD_MAIN_CITY', 'CITY_IN_BATTLE', 'ARMY_OUTSIDE', 'WILDERNESS_GARRISONED'],
  examples: [
    {
      caption: '放弃分城成功（冷却 3 天：该分城放弃时官府 3 级）',
      request: { op: Op.DISCARD_CITY, seq: 1, data: { cityId: '0b7e5c1a-3d2f-4e8a-9c61-2f4a8d9e1b07', confirm: true } },
      responses: [
        {
          op: Op.DISCARD_CITY,
          seq: 1,
          ok: true,
          data: { cityId: '0b7e5c1a-3d2f-4e8a-9c61-2f4a8d9e1b07', x: 13, y: 18, cooldownUntil: '2026-10-16T08:00:00.000Z' },
        },
      ],
    },
    {
      caption: '主城不能放弃',
      request: { op: Op.DISCARD_CITY, seq: 2, data: { cityId: CITY_ID, confirm: true } },
      responses: [
        { op: Op.DISCARD_CITY, seq: 2, ok: false, error: { code: 'DISCARD_MAIN_CITY', message: '主城不能放弃，只能放弃分城' } },
      ],
    },
  ],
  agentNote:
    '放弃前先 GET_STATE：确认目标 cities[] 中 isMain 为 false，并确认没有在途行军。放弃成功后 GET_STATE 的 cities / branch（count 减一）即时反映；同账号其他在线连接收到 PUSH_CITY_STATE（reason=city_discarded）推送，事件流新增 city_discarded。腾出的名额可以去占其他 NPC 城（但不能占回刚放弃的这一座，直到冷却结束）。',
};

export const REQUEST_SET_CAPITAL: RequestOpDoc = {
  kind: 'request',
  name: 'SET_CAPITAL',
  title: '设为主城',
  preAuth: false,
  summary:
    '把一座分城与当前主城对调身份（v82，AISLG-205）：被选中的分城成为主城，原主城变为分城。两座城的建筑、资源、驻军、武将、队列、坐标与名字原样保留，只换身份。主城的全部特殊待遇（永不被占领、官府等级决定分城上限、竞技场 / 将星塔金币、任务、剧本战场报名、酒馆候选、联盟与排行榜显示的主城）随身份走。换完后原主城立刻变为可被占领的分城（城防值从 100 满值开始计，没有额外免战），新主城没有城防值（永不被占领，仍可被掠夺）。发起前须满足：目标是本账号的普通分城（非名城）、不是当前主城；本账号距上次设为主城已满 24 小时（冷却按全局时间缩放换算，新号第一次不受限制）；本账号任一城或任一块野地没有他人玩家的出征正奔向（掠夺 / 占领）；目标城城防值已满 100；换完后分城数不超过新主城的分城上限 = floor(新主城官府等级 ÷ 2)。没有资源消耗。必须显式携带 confirm=true 防误触。',
  requestFields: [
    { name: 'cityId', type: 'string', desc: '必填。要设为主城的分城 UUID（GET_STATE 的 cities[].id，且 isMain 为 false）。缺失或不属于本账号返回 INVALID_PARAMS；指向当前主城也返回 INVALID_PARAMS（已是主城）。' },
    { name: 'confirm', type: 'boolean', desc: '必填，必须为 true；缺失或不为 true 返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'capitalId', type: 'string', desc: '新主城（即请求的 cityId）。' },
    { name: 'formerCapitalId', type: 'string', desc: '原主城（已变为分城）。' },
    { name: 'cooldownUntil', type: 'string', desc: 'ISO 8601：下次可再次设为主城的时刻；之前返回 CAPITAL_SWAP_COOLDOWN。' },
    { name: 'branchLimit', type: 'number', desc: '换完后的分城上限 = floor(新主城官府等级 ÷ 2)；换完后分城数（总城数 − 1，不变）不超过它。' },
  ],
  errors: [
    'INVALID_PARAMS',
    'FAMOUS_CITY_NOT_CAPITAL',
    'CAPITAL_SWAP_COOLDOWN',
    'CAPITAL_SWAP_UNDER_ATTACK',
    'CAPITAL_SWAP_DURABILITY_LOW',
    'BRANCH_LIMIT_EXCEEDED',
  ],
  examples: [
    {
      caption: '设为主城成功（原主城 CITY_ID 变为分城，新主城 0b7e5c1a-… 官府 6 级，分城上限 3）',
      request: { op: Op.SET_CAPITAL, seq: 1, data: { cityId: '0b7e5c1a-3d2f-4e8a-9c61-2f4a8d9e1b07', confirm: true } },
      responses: [
        {
          op: Op.SET_CAPITAL,
          seq: 1,
          ok: true,
          data: {
            capitalId: '0b7e5c1a-3d2f-4e8a-9c61-2f4a8d9e1b07',
            formerCapitalId: CITY_ID,
            cooldownUntil: '2026-10-29T08:00:00.000Z',
            branchLimit: 3,
          },
        },
      ],
    },
    {
      caption: '冷却未结束（距上次设为主城不满 24 小时，retryAfterSeconds 为剩余秒数）',
      request: { op: Op.SET_CAPITAL, seq: 2, data: { cityId: '0b7e5c1a-3d2f-4e8a-9c61-2f4a8d9e1b07', confirm: true } },
      responses: [
        {
          op: Op.SET_CAPITAL,
          seq: 2,
          ok: false,
          error: { code: 'CAPITAL_SWAP_COOLDOWN', message: '设为主城后 24 小时内不能再次更换（冷却未结束，见 retryAfterSeconds）' },
          data: { retryAfterSeconds: 36000 },
        },
      ],
    },
  ],
  agentNote:
    '发起前先 GET_STATE：读 capitalSwap（cooldownUntil 未空表示冷却中；underAttack 为真表示正在被来袭；blocked[cityId] 给出该分城不可设的原因：FAMOUS_CITY_NOT_CAPITAL / CAPITAL_SWAP_DURABILITY_LOW / BRANCH_LIMIT_EXCEEDED），再对照 branch 与目标城的 level（新上限 = level ÷ 2）。成功后 GET_STATE 的 cities[] 中 isMain 对调、主城排第一。同账号其他在线连接收到 PUSH_CITY_STATE（reason=capital_changed，cityId 为新主城，formerCapitalId 为原主城）推送，事件流新增 capital_changed。设为主城是对调而非拆分，不占也不退任何资源；但它会改变「主城」相关的一切判定，向玩家说明时要讲清原主城从此可以被占领。',
};

/** 重置完成后的城池视图示例（即开号初始状态；数值引用 rules.ts / shared 常量） */
const RESET_CITY = exampleCity();

export const REQUEST_RESET_ACCOUNT: RequestOpDoc = {
  kind: 'request',
  name: 'RESET_ACCOUNT',
  title: '一键重置账号数据',
  preAuth: false,
  summary:
    '把账号的全部游戏数据重置为开号初始状态：城池名称（回默认「主城」）与数字等级、五种资源、全部建筑与等级、建造队列与历史、人口、事件流全部清空复原，随后写入一条 account_reset 审计事件。v12 起一并清理世界数据：进行中行军清空、占领的野地回到无主、分城删除且其地块转回无主野地（NPC 城池有限存量，不因重置复活）；主城与主城地块保留。会话凭证保留——发起方与其他在线连接不会掉线。重置不可逆且立即生效，请求必须显式携带 confirm=true 防误触。**仅限玩家连接调用**：声明为 Agent 的连接（LOGIN 时 asAgent=true）返回 AGENT_FORBIDDEN——该限制基于自报 role，拦住诚实声明的 Agent，不是可独立验证的安全边界。',
  requestFields: [
    { name: 'confirm', type: 'boolean', desc: '必填且必须为 true；缺失或为 false 返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'city', type: 'object', desc: '重置完成后的城池现状（结构同 GET_STATE 的 city，即开号初始状态）。' },
  ],
  errors: ['AGENT_FORBIDDEN', 'INVALID_PARAMS'],
  examples: [
    {
      caption: 'Agent 连接调用被拒',
      request: { op: Op.RESET_ACCOUNT, seq: 1, data: { confirm: true } },
      responses: [
        { op: Op.RESET_ACCOUNT, seq: 1, ok: false, error: { code: 'AGENT_FORBIDDEN', message: '该操作不允许当前连接的登录类型调用（仅限玩家或仅限 Agent，见协议说明）' } },
      ],
    },
    {
      caption: '玩家缺少 confirm 被拒',
      request: { op: Op.RESET_ACCOUNT, seq: 1 },
      responses: [
        { op: Op.RESET_ACCOUNT, seq: 1, ok: false, error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' } },
      ],
    },
    {
      caption: '确认重置（回到开号初始状态）',
      request: { op: Op.RESET_ACCOUNT, seq: 2, data: { confirm: true } },
      responses: [{ op: Op.RESET_ACCOUNT, seq: 2, ok: true, data: { city: RESET_CITY } }],
    },
  ],
  agentNote:
    'Agent 连接无权调用（AGENT_FORBIDDEN）：需要重置时向用户说明，由玩家的 player 连接发起；不要改用 player 身份重连绕过。重置后 GET_EVENTS 只剩一条 account_reset 事件（历史已清空）；同账号其他在线连接会收到 PUSH_CITY_STATE（account_reset）推送，收到后本地缓存全部失效。',
};

export const PUSH_CITY_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_CITY_STATE',
  title: '推送：城池级状态变化',
  summary:
    '城池级状态变化时推送给该账号所有在线连接（发起连接除外）：city_renamed=城池改名（RENAME_CITY）、account_reset=账号数据被 RESET_ACCOUNT 重置（v9，重置后全部游戏数据回到开号初始状态）、city_discarded=分城被放弃（DISCARD_CITY，v57；推送只带 cityId，收到后用 GET_STATE 刷新城池列表）、capital_changed=设为主城（SET_CAPITAL，v82，AISLG-205；cityId 为新主城，formerCapitalId 为原主城，收到后用 GET_STATE 刷新）。建造队列相关变化走 PUSH_BUILD_STATE。推送只携带变化摘要，完整现状用 GET_STATE 查询。',
  dataFields: [
    { name: 'reason', type: "'city_renamed' | 'account_reset' | 'city_discarded' | 'capital_changed'", desc: '触发本次推送的状态变化。' },
    { name: 'cityId', type: 'string', desc: '城池 UUID（reason=capital_changed 时为新主城）。' },
    { name: 'name', type: 'string', desc: 'reason=city_renamed 时的新城池名。' },
    { name: 'formerCapitalId', type: 'string', desc: 'v82：reason=capital_changed 时的原主城 UUID（已变为分城）。' },
  ],
  examples: [
    {
      op: Op.PUSH_CITY_STATE,
      push: true,
      data: { reason: 'city_renamed', cityId: CITY_ID, name: '临江城' },
    },
    {
      op: Op.PUSH_CITY_STATE,
      push: true,
      data: { reason: 'account_reset', cityId: CITY_ID },
    },
  ],
  agentNote: '收到 account_reset 后本地缓存全部失效，立即用 GET_STATE 重新对齐（历史事件也已清空）。',
};
