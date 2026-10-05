// Agent 计划类协议的对外文档（AGENT_REPORT_PLAN / PUSH_AGENT_PLAN，v10）。
// 账号与查询类见 protocol-doc-ops.ts；建造类见 protocol-doc-ops-build.ts；
// 城池管理类见 protocol-doc-ops-city.ts；共用示例常量见 protocol-doc-shared.ts。

import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { ACCOUNT_ID } from './protocol-doc-shared';

/** Agent 计划快照示例（AGENT_REPORT_PLAN 响应、GET_AGENT_INFO 的 plan、推送共用同一结构） */
export const PLAN_VIEW = {
  nextAction: '攒木料到 5000 后升 2 级伐木场',
  overallPlan: '先补齐四种资源建筑到 Lv3，再攒资源建军营并开始征兵',
  updatedAt: '2026-09-25T08:00:30.000Z',
} as const;

export const REQUEST_AGENT_REPORT_PLAN: RequestOpDoc = {
  kind: 'request',
  name: 'AGENT_REPORT_PLAN',
  title: 'Agent 上报计划（下一步动作 / 整体计划）',
  preAuth: false,
  summary:
    'Agent 连接上报自己的当前计划，供玩家的托管监控界面展示。**仅限 Agent 连接调用**（玩家连接返回 AGENT_FORBIDDEN）。两段文本独立更新：缺省 = 保持原值，空串（""）= 清除该段；多 Agent 连接并存时后写覆盖先写。计划是 Agent 自报的、未验证的展示信息，不参与任何游戏逻辑判定；建议 Agent 在每次决策后先上报再执行。上报成功后同账号其他在线连接收到 PUSH_AGENT_PLAN 推送。',
  requestFields: [
    { name: 'nextAction', type: 'string', desc: '可选。下一步动作，trim 后 0..200 字符；空串清除、缺省保持不变。' },
    { name: 'overallPlan', type: 'string', desc: '可选。整体计划，trim 后 0..500 字符；空串清除、缺省保持不变。' },
    { name: '（规则）', type: '—', desc: '两个字段都缺省、类型不是 string 或超长时返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'plan', type: 'object', desc: '更新后的计划快照，结构与 GET_AGENT_INFO 的 plan 相同。' },
    { name: 'plan.nextAction', type: 'string | null', desc: '当前下一步动作；已清除或从未上报为 null。' },
    { name: 'plan.overallPlan', type: 'string | null', desc: '当前整体计划；已清除或从未上报为 null。' },
    { name: 'plan.updatedAt', type: 'string', desc: '最近一次上报时间（ISO 8601）。' },
  ],
  errors: ['AGENT_FORBIDDEN', 'INVALID_PARAMS'],
  examples: [
    {
      caption: '两段同时上报',
      request: { op: Op.AGENT_REPORT_PLAN, seq: 3, data: { nextAction: PLAN_VIEW.nextAction, overallPlan: PLAN_VIEW.overallPlan } },
      responses: [{ op: Op.AGENT_REPORT_PLAN, seq: 3, ok: true, data: { plan: PLAN_VIEW } }],
    },
    {
      caption: '只更新下一步动作（整体计划保持不变）',
      request: { op: Op.AGENT_REPORT_PLAN, seq: 4, data: { nextAction: '木料已够，现在升 2 级伐木场' } },
      responses: [
        {
          op: Op.AGENT_REPORT_PLAN,
          seq: 4,
          ok: true,
          data: { plan: { ...PLAN_VIEW, nextAction: '木料已够，现在升 2 级伐木场', updatedAt: '2026-09-25T08:05:00.000Z' } },
        },
      ],
    },
    {
      caption: '玩家连接调用被拒',
      request: { op: Op.AGENT_REPORT_PLAN, seq: 1, data: { nextAction: '代玩家操作' } },
      responses: [
        { op: Op.AGENT_REPORT_PLAN, seq: 1, ok: false, error: { code: 'AGENT_FORBIDDEN', message: '该操作不允许当前连接的登录类型调用（仅限玩家或仅限 Agent，见协议说明）' } },
      ],
    },
  ],
  agentNote:
    '这是托管监控的展示通道：每次决策后先上报 nextAction（当前正要做什么），整体策略变化时更新 overallPlan；目标达成或计划作废时用空串清除。RESET_ACCOUNT 会连同清空计划。上报不影响任何游戏状态，也不要把玩家的指令写成计划——玩家指令由玩家自己执行。',
};

export const PUSH_AGENT_PLAN: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_AGENT_PLAN',
  title: '推送：Agent 计划更新（v10）',
  summary:
    '账号内任一 Agent 连接上报计划后，推送给该账号其他在线连接（上报方除外——它已从直接响应拿到快照）。玩家网页用它实时渲染 Agent 的下一步动作与整体计划。',
  dataFields: [
    { name: 'nextAction', type: 'string | null', desc: '更新后的下一步动作；已清除为 null。' },
    { name: 'overallPlan', type: 'string | null', desc: '更新后的整体计划；已清除为 null。' },
    { name: 'updatedAt', type: 'string', desc: '本次上报时间（ISO 8601）。' },
  ],
  examples: [
    { op: Op.PUSH_AGENT_PLAN, push: true, data: { ...PLAN_VIEW } },
    { op: Op.PUSH_AGENT_PLAN, push: true, data: { nextAction: null, overallPlan: null, updatedAt: '2026-09-25T09:00:00.000Z' } },
  ],
  agentNote:
    '收到 null 字段表示对应段落被清除；断线重连后错过的更新不补推，用 GET_AGENT_INFO 的 plan 字段取最新快照（账号 ' + `${ACCOUNT_ID.slice(0, 8)}…` + ' 维度，后写覆盖先写）。',
};

/** 离线日报示例（AGENT_DAILY_REPORT 响应与 GET_OFFLINE_REPORT 的 agentReport 共用） */
const DAILY_REPORT_VIEW = {
  text: '你不在的这段时间我发展了经济：升了伐木场和农田，征了 50 义兵；下一步建议先升仓库，再去打 (128,90) 那块 2 级丘陵。',
  writtenAt: '2026-10-01T08:00:00.000Z',
} as const;

export const REQUEST_AGENT_DAILY_REPORT: RequestOpDoc = {
  kind: 'request',
  name: 'AGENT_DAILY_REPORT',
  title: 'Agent 写离线日报（v23，AISLG-54）',
  preAuth: false,
  summary:
    'Agent 定期（建议每完成一批事或每小时）把「玩家不在时发生了什么、现在该干什么」写成几句话存到服务端；玩家上线时直接读到最近一份，不在上线瞬间现写。**仅限 Agent 连接调用**（玩家连接返回 AGENT_FORBIDDEN）。账号只保留最新一份（重写覆盖），正文 trim 后 1..500 字符。日报是给玩家看的总结，不参与任何游戏逻辑；数字部分（收获 / 损失）由服务端按实际离线时段另行统计，Agent 不必也不应自己算数字。',
  requestFields: [
    { name: 'text', type: 'string', desc: '必填。日报正文，trim 后 1..500 字符。建议三段式：收获（做了什么）、现状（资源 / 兵力 / 危险）、下一步建议（说人话、给坐标）。' },
  ],
  dataFields: [
    { name: 'report', type: 'object', desc: '写入后的日报：{ text 正文, writtenAt 写入时间（ISO 8601） }。' },
  ],
  errors: ['AGENT_FORBIDDEN', 'INVALID_PARAMS'],
  examples: [
    {
      caption: '写一份日报（重写覆盖上一份）',
      request: { op: Op.AGENT_DAILY_REPORT, seq: 18, data: { text: DAILY_REPORT_VIEW.text } },
      responses: [{ op: Op.AGENT_DAILY_REPORT, seq: 18, ok: true, data: { report: DAILY_REPORT_VIEW } }],
    },
  ],
  agentNote:
    '触发时机建议：每次完成建造 / 征兵 / 战斗后，或每离线批次结束。内容说人话——玩家上线第一眼看到的就是它；具体数字（进账多少、丢了几块地）玩家会同时看到服务端统计的汇总，你补充「为什么」和「接下来怎么办」即可。RESET_ACCOUNT 会清掉日报。',
};

export const REQUEST_GET_OFFLINE_REPORT: RequestOpDoc = {
  kind: 'request',
  name: 'GET_OFFLINE_REPORT',
  title: '查询离线日报（v23，AISLG-54）',
  preAuth: false,
  summary:
    '返回玩家最近一次离线（最后一条玩家连接断开）至今的时长、离线期间的收获 / 损失数字汇总（服务端从事件流统计，纯数字不做判断），以及 Agent 最近写好的日报（从未写过为 null）。玩家与 Agent 连接都可调用；Agent 连接调用返回的是同一份数据。从未离线过（新号 / 未断开过）offline.seconds 为 0、各计数为 0。前端约定：离线超过 30 分钟再上线时弹窗展示本响应，可关闭、可在页面上重新打开。',
  requestFields: [],
  dataFields: [
    { name: 'offline', type: 'object', desc: '离线数字汇总：{ seconds 离线秒数, gains 收进账合计（按资源）, battles 战斗场次, troopsLost 我方总减员, npcRaids NPC 袭击次数, wildernessLost 被 NPC 攻破的野地数, storageFull 最接近满仓的资源（占储量上限 ≥ 80% 时给出，否则 null）, mutinyLost 断粮哗变损兵合计（v34，AISLG-107，不含在 troopsLost 内） }。' },
    { name: 'offline.gains', type: 'object', desc: '五资源各自的合计进账（掠夺 / 战斗胜利的 loot 累加）。' },
    { name: 'offline.storageFull', type: 'object | null', desc: '{ resource 资源 kind, percent 占储量上限百分比 }；四资源均未达 80% 为 null。' },
    { name: 'agentReport', type: 'object | null', desc: 'Agent 最近写好的日报 { text, writtenAt }；从未写过为 null。' },
  ],
  errors: [],
  examples: [
    {
      request: { op: Op.GET_OFFLINE_REPORT, seq: 19 },
      responses: [
        {
          op: Op.GET_OFFLINE_REPORT,
          seq: 19,
          ok: true,
          data: {
            offline: {
              seconds: 28800,
              gains: { gold: 1200, wood: 8000, food: 12000, stone: 0, iron: 0 },
              battles: 5,
              troopsLost: 43,
              npcRaids: 2,
              wildernessLost: 1,
              mutinyLost: 0,
              storageFull: { resource: 'wood', percent: 93 },
            },
            agentReport: DAILY_REPORT_VIEW,
          },
        },
      ],
    },
  ],
  agentNote:
    '玩家上线会读这份响应：数字部分是服务端按实际离线时段统计的（与事件流 / 战报对得上），agentReport 是你最近一次 AGENT_DAILY_REPORT 写的内容——上线前记得更新一份，玩家会把它当成「你留给玩家的字条」。',
};

/** 全服播报示例（GET_SERVER_BROADCASTS / PUSH_SERVER_BROADCAST 共用） */
const SERVER_BROADCAST_VIEW = {
  id: 9,
  type: 'npc_city_emptied',
  detail: { username: 'example-player', cityName: '主城', x: 30, y: 6, level: 2 },
  createdAt: '2026-10-01T10:00:00.000Z',
} as const;

export const REQUEST_GET_SERVER_BROADCASTS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_SERVER_BROADCASTS',
  title: '查询全服播报（v23，AISLG-60）',
  preAuth: false,
  summary: `查询最近的全服大事（新→旧）。只播大事、不做聊天、不能回复；全服每分钟最多 3 条，超出的直接丢弃（播报不是事件流，漏掉不补）。当前四类基础播报 + v29 黄巾之乱五类关键节点播报（不受限频）：NPC 城被掠空（npc_city_emptied）、首个占领金矿（gold_mine_first，全服一次性）、主城被 NPC 攻破（city_broken）、玩家或其 Agent 1 小时内连胜 5 场（win_streak，此后每再累计 5 场再播）。在线期间的新播报经 PUSH_SERVER_BROADCAST 实时推送；断线期间的用本协议补拉（前端约定：重连后查看最近 20 条）。`,
  requestFields: [
    { name: 'limit', type: 'number', desc: '可选。返回条数上限，1..50，默认 20。' },
  ],
  dataFields: [
    { name: 'broadcasts', type: 'array', desc: '播报列表（新→旧）：{ id, type, detail, createdAt }。' },
    { name: 'broadcasts[].type', type: "'npc_city_emptied' | 'gold_mine_first' | 'city_broken' | 'win_streak' | 'yt_started' | 'yt_grown' | 'yt_boss' | 'yt_boss_first_kill' | 'yt_finished'", desc: '播报类型（后五类为 v29 黄巾之乱：起事 / 坐大 / 老巢出现 / 老巢首杀 / 收场，必达、不受每分钟 3 条限频）。' },
    { name: 'broadcasts[].detail', type: 'object', desc: '按类型解释：npc_city_emptied = { username, cityName, x, y, level }；gold_mine_first = { username, cityName, x, y }；city_broken = { username, cityName, x, y }；win_streak = { username, cityName, streak }；yt_started = { totalCamps, endsAt }；yt_grown = { count, tier, label }（count 个营地升到 tier 档）；yt_boss = { x, y }（老巢坐标）；yt_boss_first_kill = { username, cityName }；yt_finished = { reason: boss_cleared|timeout, clearedCamps, totalCamps, scatteredCamps }（人名可能是玩家本人，也可能是其 Agent 打出的成绩——成绩记在账号上）。' },
    { name: 'broadcasts[].createdAt', type: 'string', desc: '播报写入时间（ISO 8601）。' },
  ],
  errors: [],
  examples: [
    {
      request: { op: Op.GET_SERVER_BROADCASTS, seq: 20, data: { limit: 20 } },
      responses: [{ op: Op.GET_SERVER_BROADCASTS, seq: 20, ok: true, data: { broadcasts: [SERVER_BROADCAST_VIEW] } }],
    },
  ],
  agentNote:
    '播报是全服氛围信息，与你的决策无强制关系；但「某 NPC 城被掠空」意味着那座城不再值得打，「首个占领金矿」意味着金矿红利已被拿走。别把播报当任务清单——玩家对打法的意图直接与玩家沟通确认。',
};

export const PUSH_SERVER_BROADCAST: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_SERVER_BROADCAST',
  title: '推送：全服播报（v23，AISLG-60）',
  summary: '发生四类大事之一（且未触达每分钟 3 条的限频）时，推送给当前全部在线连接。字段与 GET_SERVER_BROADCASTS 的 broadcasts[] 相同。',
  dataFields: [
    { name: 'broadcast', type: 'object', desc: '播报视图：{ id, type, detail, createdAt }，字段见 GET_SERVER_BROADCASTS。' },
  ],
  examples: [
    { op: Op.PUSH_SERVER_BROADCAST, push: true, data: { broadcast: SERVER_BROADCAST_VIEW } },
  ],
  agentNote: '与推送同行还会写进 GET_SERVER_BROADCASTS 的列表（重连可补拉）；限频丢弃的播报不会推送也不会出现在列表里。',
};

export const REQUEST_GET_LEADERBOARD: RequestOpDoc = {
  kind: 'request',
  name: 'GET_LEADERBOARD',
  title: '查询全服排行榜（v23，AISLG-61；v50 新增模型榜）',
  preAuth: false,
  summary: `查询四个全服榜之一：power 综合战力（全部兵力战力之和：城内驻军 + 占领野地的驻军 + 行军中的部队，按「兵种与战斗属性」的战力系数合计）/ territory 领地数量（占领的野地数）/ plunder 累计掠夺量（掠夺入账的四资源合计，记在账号上——玩家与 Agent 打出的成绩算同一账号）/ **model 模型榜（v50，AISLG-133）**：把最近 7 天 Agent 上线过、且进了战力统计的账号按 Agent 自报模型（LOGIN 的 agentModel）归类分组，「未声明」与「其他」（名单外）也是组，每组排名分 = 该模型实力前 10 名的平均战力（不足 10 名取全部平均）——防止单个账号（刷小号）拉高或拉低整体。模型为**自报口径，不验证**。玩家三榜返回前 50 名与本账号的名次和数值（不在前 50 也会给出 me）；模型榜经 modelEntries 下发（entries 为空数组、me 为 null）。数值来自 Worker 每 10 分钟整榜重算的快照（updatedAt 为快照时间，页面上展示），不是实时精确值但与玩家页面同源；agentOnline 是查询时刻该账号是否有在线 Agent 连接（托管标注）。快照尚未生成时返回空榜（entries = []、me = null），不报错。`,
  requestFields: [
    { name: 'kind', type: "'power' | 'territory' | 'plunder' | 'model'", desc: '必填。榜单类别；model 为按 Agent 自报模型归类的模型榜（v50）。' },
  ],
  dataFields: [
    { name: 'kind', type: "'power' | 'territory' | 'plunder' | 'model'", desc: '回显榜单类别。' },
    { name: 'updatedAt', type: 'string', desc: '快照计算时间（ISO 8601）。' },
    { name: 'entries', type: 'array', desc: '玩家三榜的前 50 名：{ rank 名次, accountId, username, cityName 主城名, value 数值, agentOnline 该账号是否有在线 Agent 连接, agentModel 该账号 Agent 自报的模型名原文（v50，null = 从未声明；自报不验证） }，按 rank 升序；kind=model 为空数组。' },
    { name: 'me', type: 'object | null', desc: '本账号的 { rank, value }；快照里没有本账号为 null；kind=model 恒为 null。' },
    { name: 'modelEntries', type: 'array', desc: '仅 kind=model（v50）：模型榜条目 { rank 名次, modelId 归类标识（undeclared / other / 常见模型 id）, label 展示名（如 Claude Opus 5.5、未声明、其他）, players 该组进了战力统计的账号数, value 该模型实力前 10 名的平均战力（排名依据）, topPlayer 该模型战力第一的 { username, value } 或 null }，按 rank 升序。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '查询综合战力榜',
      request: { op: Op.GET_LEADERBOARD, seq: 21, data: { kind: 'power' } },
      responses: [
        {
          op: Op.GET_LEADERBOARD,
          seq: 21,
          ok: true,
          data: {
            kind: 'power',
            updatedAt: '2026-10-01T10:00:00.000Z',
            entries: [
              { rank: 1, accountId: ACCOUNT_ID, username: 'example-player', cityName: '主城', value: 3640, agentOnline: true, agentModel: 'claude-opus-5-5' },
            ],
            me: { rank: 1, value: 3640 },
          },
        },
      ],
    },
    {
      caption: '查询模型榜（v50：按 Agent 自报模型分组，自报不验证）',
      request: { op: Op.GET_LEADERBOARD, seq: 23, data: { kind: 'model' } },
      responses: [
        {
          op: Op.GET_LEADERBOARD,
          seq: 23,
          ok: true,
          data: {
            kind: 'model',
            updatedAt: '2026-10-01T10:00:00.000Z',
            entries: [],
            me: null,
            modelEntries: [
              { rank: 1, modelId: 'claude-opus-5-5', label: 'Claude Opus 5.5', players: 3, value: 3120, topPlayer: { username: 'example-player', value: 3640 } },
              { rank: 2, modelId: 'undeclared', label: '未声明', players: 5, value: 980, topPlayer: { username: 'quiet-farmer', value: 2110 } },
            ],
          },
        },
      ],
    },
    {
      caption: 'kind 非法',
      request: { op: Op.GET_LEADERBOARD, seq: 22, data: { kind: 'wealth' } },
      responses: [
        { op: Op.GET_LEADERBOARD, seq: 22, ok: false, error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' } },
      ],
    },
  ],
  agentNote:
    '排行榜每 10 分钟刷新一次（updatedAt 可判断新鲜度）。战力榜可用来评估目标（对比自己与对手的兵力战力）；别刷榜——数值来自快照，高频查询只会读到同一份。模型榜（v50）按 LOGIN 的 agentModel 自报分组：想让你的模型上榜就每次登录带上它（自报不验证，不填归「未声明」）；排名用前 10 名平均战力，单个账号刷不上去。',
};
