// 面向 Agent 的协议文档清单（数据面）：文档元信息、兼容策略、错误码说明、
// 连接规则、术语表与通用帧示例。与 protocol-doc-ops.ts（各协议字段与示例）、
// protocol-doc-walkthrough.ts（完整示例会话）共同构成 docs/agent-api.* 的唯一内容来源。
// 修改后运行 npm run gen:api-doc 重新生成产物；npm run check:api-doc 校验未漂移。

import type { ClientFrame, ErrorCode, PushFrame, ResponseFrame } from './protocol';
import { TROOP_KINDS, type TroopKind } from './protocol';
import { INITIAL_RESOURCES } from './rules';
import { TROOP_INFO } from './troops';
import { TROOP_STATS } from './battle-engine';
import { RAM_BREAK_MAX_PERCENT, RAM_BREAK_PER_PERCENT, troopCounterInfo } from './troop-counter';
import { NPC_CITY_COUNT, WORLD_SIZE } from './world';
import { EMPTY_ARMY } from './protocol-doc-army-consts';
import {
  INITIAL_BUILDINGS_VIEW,
  INITIAL_COSTS,
  INITIAL_LEVELS,
  INITIAL_POPULATION_VIEW,
  INITIAL_PRODUCTION,
  INITIAL_STORAGE,
  exampleCity,
} from './protocol-doc-shared';

/**
 * 兵种战斗属性表（v18 起公开）：数据直引战斗引擎的评审定稿常量（TROOP_STATS），
 * 生成器不手抄数值——引擎重跑校准后重新生成文档即自动同步。
 * 公开边界（AISLG-21 产品决策）：兵种属性与相对关系可见，伤害与判定的算法公式不可见。
 */
export interface TroopDocEntry {
  kind: TroopKind;
  /** 展示名 */
  label: string;
  /** 单兵生命 */
  hp: number;
  /** 单兵攻击 */
  atk: number;
  /** 单兵防御 */
  def: number;
  /** 战斗速度（决定行动先后与接敌快慢；相对值有意义） */
  speed: number;
  /** 攻击射程（射程外的目标打不到；近战与远程的核心差异） */
  range: number;
  /** 行军速度系数（1 = 基准；影响大地图行军时长） */
  marchSpeed: number;
  /** 解锁所需军营等级 / 单兵负重 / 单兵人口（v32 起随二期兵种公开） */
  barracksLevel: number;
  carry: number;
  population: number;
  /** 克制与抗性说明（v32，AISLG-87）：「克制：骑兵（轻骑兵 / 铁骑兵）+20%」「抗性：弓箭兵 / 床弩 −20%」；无为「—」 */
  counter: string;
}

function counterText(kind: TroopKind): string {
  const info = troopCounterInfo(kind);
  const names = (kinds: TroopKind[]): string => kinds.map((k) => TROOP_INFO[k].label).join(' / ');
  const parts = [
    ...info.counters.map((c) => `克制：${names(c.targets)} 伤害 +${c.percent}%`),
    ...info.resists.map((r) => `抗性：受${names(r.from)}攻击 ${r.percent}%`),
  ];
  if (kind === 'siege_ram') {
    parts.push(`破墙：攻城时每占攻方存活总兵数 1% 使守方城墙减伤相对降低 ${RAM_BREAK_PER_PERCENT}%（最多 ${RAM_BREAK_MAX_PERCENT}%）`);
  }
  return parts.length > 0 ? parts.join('；') : '—';
}

export const TROOPS_DOC: TroopDocEntry[] = TROOP_KINDS.map((kind) => ({
  kind,
  label: TROOP_INFO[kind].label,
  ...TROOP_STATS[kind],
  barracksLevel: TROOP_INFO[kind].barracksLevel,
  carry: TROOP_INFO[kind].carry,
  population: TROOP_INFO[kind].population,
  counter: counterText(kind),
}));

/** 协议兼容策略，写入文档「版本与兼容」一节 */
export const PROTOCOL_COMPAT_POLICY: string[] = [
  '只加不改：已发布的协议号、字段与错误码只新增、不删除、不改变类型与语义。',
  '新增字段不视为破坏兼容：消费方应容忍请求与响应中出现文档未列出的字段。',
  '必须破坏语义时启用新的协议号承载新行为，旧协议号保留原语义直至正式公告下线。',
];

/**
 * 全局时间缩放说明（v20，AISLG-38），写入文档概览。本文档中的时长与速率数值
 * 均为未加速基准（time_scale=1）；部署的实际值 = 耗时 ÷ scale（钳 1 秒下限）、
 * 速率 × scale，由运营方在 settings 表配置（默认 50，恢复节奏设 1），API 与
 * Worker 共享、切换无需重启，只作用于新发起的任务与下一次结算。
 */
export const TIME_SCALE_DOC: string =
  '当前部署开启了全局时间缩放（time_scale，settings 表运行时配置）：文档中的时长数值为未加速基准，实际耗时 = 基准 ÷ time_scale（**下限 1 秒作用于任务总时长**——征兵按「单兵基准 × 数量」、升级按「建造基准 × 等级」、行军按「距离 × 每格基准 ÷ 速度系数」合并成总时长后再缩放，v22 修复 AISLG-39 / AISLG-38；**取整到整秒：建造/升级、征兵、掠夺冷却、NPC 袭击间隔向下取整，行军向上取整**）——建造/升级、征兵、行军、掠夺冷却、NPC 袭击间隔同规则；实际速率 = 基准 × time_scale——资源产出、人口增长（growthPerHour）、军队耗粮（armyFoodUsePerHour）同幅放大，经济关系不变。只作用于新发起的任务与下一次结算（存量任务到期时间不变）。以响应内的 dueAt / production / growthPerHour 等实际下发值为准，不要按文档数值本地折算时长。';

/** 文档元信息。authTimeoutMsDefault / maxFrameBytes 镜像 api/src/index.ts 的默认值，调整时同步。 */
export const DOC_META = {
  title: 'SLG Agent API 参考',
  /** WebSocket 路径；线上主机地址以运营方公告为准 */
  wsPath: '/ws',
  healthPath: '/health',
  docMdPath: '/agent-api.md',
  docJsonPath: '/agent-api.json',
  /** 本地开发默认连接地址 */
  localDevWsUrl: 'ws://127.0.0.1:8080/ws',
  /** 连接建立后未完成登录的时限（毫秒），部署可用 AUTH_TIMEOUT_MS 调整 */
  authTimeoutMsDefault: 15000,
  /** 单帧大小上限（字节） */
  maxFrameBytes: 64 * 1024,
} as const;

/** 字段说明：嵌套字段用点号路径表示 */
export interface FieldDoc {
  name: string;
  /** 文档展示类型，如 string、number、boolean、'player' | 'agent' */
  type: string;
  desc: string;
}

/** 请求-响应型协议的一组完整示例：一个场景的请求与若干响应 */
export interface RequestOpExample {
  /** 场景说明（同一协议多种用法时区分，如「密码登录」「令牌登录」） */
  caption?: string;
  request: ClientFrame;
  responses: ResponseFrame[];
}

/** 请求-响应型协议的文档 */
export interface RequestOpDoc {
  kind: 'request';
  /** 协议名的可读写法（仅文档展示，线上以数字 op 为准） */
  name: string;
  /** 一句话中文标题 */
  title: string;
  /** 是否登录成功前即可发送（LOGIN 与微信扫码登录的 WX_* 为 true；WX_QR_CREATE 的 bind 用途仍须已登录） */
  preAuth: boolean;
  summary: string;
  requestFields: FieldDoc[];
  /** 响应 data 的字段说明 */
  dataFields: FieldDoc[];
  /** 该协议特有的错误码；INTERNAL 对所有请求都可能返回，不在此列出 */
  errors: ErrorCode[];
  /** 完整帧示例：按场景分组，每组一个请求 + 若干响应 */
  examples: RequestOpExample[];
  /** 给 Agent 的行为提示 */
  agentNote?: string;
}

/** 服务端推送型协议的文档 */
export interface PushOpDoc {
  kind: 'push';
  name: string;
  title: string;
  summary: string;
  dataFields: FieldDoc[];
  examples: PushFrame[];
  agentNote?: string;
}

export type OpDoc = RequestOpDoc | PushOpDoc;

export interface ErrorDoc {
  desc: string;
  /** Agent 收到该错误后的建议处置 */
  action: string;
}

export const ERROR_DOC: Record<ErrorCode, ErrorDoc> = {
  INVALID_MESSAGE: {
    desc: '消息不是合法的协议帧（非 JSON、非对象、缺 op 或 op 非整数；二进制帧同样触发）。响应帧恒为 op=0（原始 op 无法安全回显），帧内可解析出数字 seq 时原样回带，否则无 seq 字段（v17）。',
    action: '检查帧的 JSON 结构后重发；连续出现说明序列化代码有误。',
  },
  UNKNOWN_OP: {
    desc: '协议号不存在。',
    action: '可能是新版服务新增的协议，拉取 GET /agent-api.json 对比协议版本后改用文档内的协议号，不要原样重试。',
  },
  NOT_LOGGED_IN: {
    desc: '登录前只能发送登录协议。',
    action: '先完成 LOGIN（op 1）再重发原请求。',
  },
  ALREADY_LOGGED_IN: {
    desc: '连接已登录，不能重复登录。',
    action: '单条连接只登录一次；需要另一个登录类型时新建连接。',
  },
  INVALID_PARAMS: {
    desc: '请求参数缺失或格式不正确。',
    action: '对照文档字段表修正字段后重发。',
  },
  INVALID_CREDENTIALS: {
    desc: '用户名已存在且密码错误。',
    action: '停止重试，向用户核对凭证。',
  },
  SIGNUP_CLOSED: {
    desc: '密码登录的用户名不存在（v48 起密码通道关闭自动注册，不再自动建号）。',
    action: '新账号请玩家在网页上经 Google / GitHub / 微信扫码登录创建；已有账号核对用户名拼写后重试。',
  },
  SESSION_INVALID: {
    desc: '会话令牌无效或已过期（不存在、被 LOGOUT 吊销或超过有效期），或永久 Agent 令牌已被玩家重置。',
    action: '丢弃本地保存的令牌，在本站重新登录（Agent 请玩家重新发一次新提示词，不要用旧令牌重试；国际站没有密码登录，网页用 Google / GitHub）。',
  },
  INSUFFICIENT_RESOURCES: {
    desc: '资源不足以支付建造。',
    action: '失败响应附当前城池状态（data.city），等待资源积累或调整策略。',
  },
  BUILD_IN_PROGRESS: {
    desc: '已有在建建筑。v4 起 BUILD 改为排队制，本错误码不再由 BUILD 返回（保留定义以兼容旧客户端）。',
    action: '改用 GET_STATE 查看 city.queue 队列状态。',
  },
  QUEUE_FULL: {
    desc: '建造队列已满（1 条在建 + 排队上限，当前为 2 条排队）。',
    action: '失败响应附当前城池状态（data.city.queue 可见队首预计完成时间），等队首完成后重试。',
  },
  BUILDING_EXISTS: {
    desc: '该类型建筑已建成，或已在建造/升级队列中（v5：每种建筑同城唯一，不可重复建造）。',
    action: '已建成时改用 UPGRADE 升级；已在队列中时等该条完成后再操作。',
  },
  BUILDING_NOT_BUILT: {
    desc: '该类型尚未建造且不在建造/升级队列中，不能升级（UPGRADE 前置条件是已建成；在队冲突走 BUILDING_EXISTS）。',
    action: '先用 BUILD 建造该类型，完成后再升级。',
  },
  BUILDING_LEVEL_MAX: {
    desc: '建筑已达等级上限（当前为 20 级，v31 AISLG-85 由 10 级开放；占位数值）。UPGRADE 的 toLevel 超过上限同样返回本错误码。',
    action: '该类型已无法继续升级，转投其他建筑或系统。',
  },
  BUILD_NOT_CANCELLABLE: {
    desc: '目标建造不存在、不属于本账号或不在排队状态。进行中任务能否取消待设计，当前仅排队条目（status=queued）可取消（v7）。',
    action: '用 GET_STATE 查看 city.queue，只对 status=queued 的条目发起 CANCEL_BUILD。',
  },
  AGENT_FORBIDDEN: {
    desc: '该协议对连接声明的登录类型有限制：RESET_ACCOUNT 仅玩家连接可调用，AGENT_REPORT_PLAN 仅 Agent 连接可调用。注意：role 是连接自报的标记，本限制拦住诚实声明的对端，不是可独立验证的安全边界。',
    action: '换由对应登录类型的连接发起（RESET_ACCOUNT 找玩家连接，计划上报找 Agent 连接）；不要改用另一身份重连绕过。',
  },
  TROOP_NOT_AVAILABLE: {
    desc: '该兵种需要更高等级的军营才能征募（v11；未建军营同样返回）。兵种与门槛见 RECRUIT 的字段说明。',
    action: '用 GET_STATE 查看 levels.barracks，先升级军营或改征当前等级可用的兵种。',
  },
  INSUFFICIENT_POPULATION: {
    desc: '人口不足以征募该数量（v11：人口在征募发起时立即扣减，民房上限与增长决定可征数量）。',
    action: '等待人口增长（增速 = 10 × 民房等级 × (等级+1)/小时，无民房为 0）或建 / 升民房后重试；失败响应附当前城池状态。',
  },
  RECRUIT_QUEUE_FULL: {
    desc: '征兵队列已满（1 条征募中 + 排队上限，当前为 2 条，占位数值；v11）。征兵队列独立于建造队列。',
    action: '等队首完成后重试，或先取消排队条目腾出位置。',
  },
  RECRUIT_NOT_CANCELLABLE: {
    desc: '目标征兵不存在、不属于本账号或不在排队状态。征募中条目能否取消待设计，当前仅排队条目可取消（v11）。',
    action: '用 GET_STATE 查看 city.recruitQueue，只对 status=queued 的条目发起 CANCEL_RECRUIT。',
  },
  TARGET_NOT_ATTACKABLE: {
    desc: '出征目标当前不可攻击（v12）：坐标在世界外、玩家城池地块（含自己的城），或已被其他玩家占领的野地。玩家对抗（攻城与争夺野地）随后续阶段开放，当前只能出征无主 / 本账号占领的野地与 NPC 城池。',
    action: '用 GET_WORLD_MAP / GET_TILE 确认目标类别与归属；换一块无主野地或 NPC 城池，或先撤回对本账号地块的出征计划。',
  },
  INSUFFICIENT_TROOPS: {
    desc: '城内驻军不足以派出请求的编队（v12：出征在发起时立即扣减 city.army，行军中的部队不在城内）。',
    action: '失败响应附当前城池状态（data.city.army）；按城内驻军调整编队，或等待征兵完成 / 部队返程后再出征。',
  },
  TILE_NOT_OCCUPIED: {
    desc: '该地块未被本账号占领（无主、他人占领或不是野地），无法召回驻军（v12）。',
    action: '用 GET_STATE 的 city.territory 核对本账号占领的野地坐标，只对列表中的地块发起 RECALL_GARRISON。',
  },
  MARCH_NOT_RECALLABLE: {
    desc: '行军不存在、不属于本账号、不在行军途中或已是返程，无法撤回（v13）。',
    action: '用 GET_STATE 的 city.marches 核对行军 id 与状态，只对 status=marching 且 purpose 不是 return 的行军发起 RECALL_MARCH。',
  },
  PLUNDER_COOLDOWN: {
    desc: '目标地块处于掠夺冷却中（基准 24 小时，实际受全局时间缩放等比缩短；v16：该地块已被成功掠夺，冷却记录见 GET_TILE 的 tile.plunderedAt；冷却内发起掠夺被拒，在途到达仍战斗但资源为零）。',
    action: '读 tile.plunderedAt 判断冷却截止时间，到点后重试掠夺；或改用 task=occupy（占领不受冷却限制）。',
  },
  TASK_INVALID_FOR_TARGET: {
    desc: '该任务类型不适用于此目标（v16 起；v24 起 NPC 城池也可 task=occupy，本码当前不再由出征返回，保留兼容；玩家城池占领随玩家对抗阶段设计）。',
    action: '改用 task=plunder（或不带 task，缺省即掠夺）。',
  },
  TERRITORY_LIMIT: {
    desc: '该城占领的野地数已达官府等级上限（v16：上限 = 官府等级，MARCH task=occupy 发起时初核，Worker 到达时复核——胜利后超限不改归属、幸存部队返程）。',
    action: '升级官府提高上限、召回一块野地驻军，或改用 task=plunder（掠夺不受占领上限限制）。',
  },
  GOVERNMENT_TOO_LOW: {
    desc: '占领 NPC 城（MARCH task=occupy 目标为 NPC 城池）需要主城官府 ≥ 3 级（v24，AISLG-58）。',
    action: '先升级主城官府到 3 级；或对该 NPC 城改用 task=plunder 掠夺。',
  },
  BRANCH_LIMIT: {
    desc: '分城数已达上限（v24：上限 = floor(主城官府等级 ÷ 3)，名城同样计入；发起时初核，Worker 到达时复核——胜利后超限不建分城、幸存部队返程，事件记录 denial=BRANCH_LIMIT）。',
    action: '升级主城官府（3 / 6 / 9 级各多 1 个名额），或改用 task=plunder 掠夺。',
  },
  TARGET_LEVEL_TOO_HIGH: {
    desc: '目标 NPC 城等级高于出发城的官府等级（v24：只能占领不高于出发城官府等级的城）。',
    action: '升级出发城的官府，或从官府更高的城出征，或先掠夺不占领。',
  },
  OUTER_NOT_CLEARED: {
    desc: '名城外围驻军尚未清空时对其发起 task=occupy（v24，AISLG-56）：名城分两阶段攻打，先清外围、外围清空后才能攻城守并占领。',
    action: '先对该名城出征 task=plunder（或不带 task）清理外围；外围清空后须在限时内（GET_TILE 的 famous.recoversAt）出征 task=occupy 攻城守，超时外围恢复满编。',
  },
  CARGO_OVER_CAPACITY: {
    desc: '运输任务（MARCH task=transport，v26，AISLG-79）的货物总量超过所派编队的负重（Σ 数量 × 单兵 carry）。',
    action: '减少 cargo 数量，或多派部队（民夫单兵负重最高）；负重表见 MARCH 说明。',
  },
  TECH_LEVEL_MAX: {
    desc: '该科技已达等级上限（v27，AISLG-77：每项最高 10 级）。',
    action: '研究其他科技；满级科技不需要再研究。',
  },
  RESEARCH_IN_PROGRESS: {
    desc: '账号已有进行中的研究（v27，AISLG-77：同一时间只能研究一项，与发起城无关）。',
    action: '等待 PUSH_TECH_STATE（research_completed）后再发起，或用 CANCEL_RESEARCH 取消当前研究（全额返还）。',
  },
  ACADEMY_TOO_LOW: {
    desc: '发起研究的城书院等级低于目标等级（v27，AISLG-77：第 N 级科技要求书院 ≥ N 级，未建书院按 0 级）；失败 data 附 academyRequired（要求的书院等级）与 academyLevel（该城现有）。',
    action: '先在该城建造 / 升级书院（academy）到 academyRequired，或改用书院更高的分城发起（data.cityId）。',
  },
  RESEARCH_NOT_CANCELLABLE: {
    desc: '没有可取消的研究（v27，AISLG-77）：账号当前没有进行中的研究、指定的 researchId 不属于本账号 / 已结束，或研究已到期等待结算。',
    action: '先用 GET_TECHS 确认 research 字段；已完成的研究无法取消。',
  },
  DEPLOY_LIMIT: {
    desc: '本城同时在外的部队数已达校场等级上限（v30，AISLG-80）：MARCH / SCOUT 发起时校验，上限 = 校场等级（未建校场按 1），计入行军中、返程中、驻守野地的部队（每块占领野地算一支），不计城内驻军；上线前已在外的部队不受影响、不强制召回，只拦新的出征，直到在外数量降到上限以下。失败 data 附 city（city.deploy = { count, limit }）。分城各算各的。',
    action: '等在外部队回城 / 用 RECALL_GARRISON 召回驻军降到上限以下再出征，或升级本城校场（parade_ground）；GET_STATE 的 city.deploy 可提前判断。',
  },
  MOVING_TARGET_GONE: {
    desc: '截击（MARCH 带 targetId，v28，AISLG-78）发起时目标不存在、已被击败或已过时消失。注意：发起后到达时目标才消失不报错，而是记「目标消失」战报、部队返程。',
    action: '用 GET_MOVING_TARGETS 重新取目标列表，挑还存在的目标再发起。',
  },
  TAVERN_NOT_BUILT: {
    desc: '（v36，AISLG-114）该城未建酒馆，无候选可招。',
    action: '先建酒馆（BUILD kind=tavern），或到已建酒馆的城招募。',
  },
  HERO_CANDIDATE_GONE: {
    desc: '（v36，AISLG-114）候选武将不存在、已被招募或已随批次刷新失效。',
    action: '重拉 GET_HEROES 取当前候选再招募。',
  },
  HERO_CAP_REACHED: {
    desc: '（v36，AISLG-114）普通将数量已达上限 = ⌈酒馆最高等级 ÷ 2⌉ + 1（附 normalCap）。',
    action: '升级酒馆提高上限，或先 DISMISS_HERO 腾名额。',
  },
  HERO_NOT_FOUND: {
    desc: '（v36，AISLG-114）武将不存在或不属于本账号（出征配将 / 解雇 / 城守共用）。',
    action: '用 GET_HEROES 重拉账号武将列表。',
  },
  HERO_BUSY: {
    desc: '（v36，AISLG-114）武将正在随队出征（含返程），不能出征 / 解雇 / 任命城守。',
    action: '等部队回城（marchingMarchId 变回 null）后再操作。',
  },
  HERO_WOUNDED: {
    desc: '（v36，AISLG-114）武将重伤未愈（带队战败后 2 小时基准，随时间缩放），不能出征。',
    action: '等 woundedUntil 过去，或换其他武将。',
  },
  HERO_ARREARS: {
    desc: '（v36，AISLG-114）武将欠饷中（主城金币不足以支付俸禄），不能出征。',
    action: '给主城补足金币，俸禄结算成功后自动恢复（收到 reason=salary_paid 推送）。',
  },
  GUARD_ASSIGN_DENIED: {
    desc: '（v36，AISLG-115）城守不能同时出征；城守只能任命未随行出征的本账号武将。',
    action: '先撤任（ASSIGN_HERO heroId=null）再出征，或换其他武将带队。',
  },
  NEWBIE_PROTECTED: {
    desc: '（v38，AISLG-122；门槛 v42 校准为 8 级）目标玩家处于新手保护期（注册后 3 天或任一城官府升到 8 级，先到为准），不能被侦察 / 攻击（SCOUT 与 MARCH 均返回本码）。data.until / data.retryAfterSeconds 为截止时刻与剩余秒数。',
    action: '等保护期结束后再打（按 retryAfterSeconds 睡满后重发），或换目标。新手玩家主动侦察 / 攻击其他玩家会立即失去保护。',
  },
  TARGET_IN_TRUCE: {
    desc: '（v38，AISLG-122）目标处于免战期：城被攻破 / 被抢后的被动免战（4 小时基准）或目标自己开启的主动免战（12 小时基准），玩家与 NPC 都不能再攻击。data.until / data.retryAfterSeconds 为截止时刻与剩余秒数。',
    action: '按 retryAfterSeconds 睡满后重发，或换目标；在途部队到达时若目标进入免战会扑空返程（事件 outcome=aborted 并附 cause）。',
  },
  SELF_TRUCE_ACTIVE: {
    desc: '（v38，AISLG-122）自己的主动免战生效中（TRUCE 开启后 12 小时基准），不能出兵攻打玩家；打野地 / NPC 城不受影响。data.until / data.retryAfterSeconds 为截止时刻与剩余秒数。',
    action: '等免战结束（city.shieldUntil）再出兵打玩家，期间可正常打野地 / NPC / 运输 / 调兵。',
  },
  TRUCE_ALREADY_ACTIVE: {
    desc: '（v38，AISLG-122）主动免战已在生效中，重复开启 TRUCE 被拒。data.until 为截止时刻。',
    action: '无需处理；city.shieldUntil 可查当前免战截止。',
  },
  TRUCE_WEEKLY_USED: {
    desc: '（v38，AISLG-122）本周的主动免战已用过（每周一次免费，7 天基准随缩放）。data.nextAvailableAt / retryAfterSeconds 为下次可开启时刻与剩余秒数。',
    action: '按 retryAfterSeconds 睡满后重发 TRUCE；city.shieldNextAt 可查下次可开时刻。',
  },
  TILE_PROTECTED: {
    desc: '（v39，AISLG-123）该野地刚换主人（被玩家抢占），处于保护期（1 小时基准随缩放）：期间玩家与 NPC 都不能再抢。data.until / data.retryAfterSeconds 为截止时刻与剩余秒数。',
    action: '按 retryAfterSeconds 睡满后重发，或换目标；GET_TILE 的 tile.protection.ownerChangedUntil 可查保护截止。',
  },
  WX_TICKET_INVALID: {
    desc: '（v43）微信扫码的 ticket 不存在、已过期、已被扫 / 已用过，或确认方不是扫码的那条连接。',
    action: '网页端：重新 WX_QR_CREATE 生成新码；小游戏端：提示玩家回网页刷新二维码后重扫。Agent 不涉及。',
  },
  WX_CODE_INVALID: {
    desc: '（v43）微信 jscode2session 换 openid 失败：wx.login 的 code 已过期或已被使用。',
    action: '小游戏端重新调 wx.login 拿新 code 再 WX_SCAN；code 不可复用。Agent 不涉及。',
  },
  WX_ALREADY_BOUND: {
    desc: '（v43）绑定微信时，这个微信已绑了别的账号，或当前账号已绑了别的微信。',
    action: '换一个微信，或用该微信直接扫码登录它已绑定的账号；暂不支持解绑。Agent 不涉及。',
  },
  WX_UNAVAILABLE: {
    desc: '（v43）微信接口调用失败，或服务端没配置微信小游戏 AppID / AppSecret（扫码登录整体关闭）。',
    action: '稍后重试，或改用本站其他登录方式（国内站有账号密码，国际站有 Google / GitHub）；持续出现向运营方反馈。Agent 不涉及。',
  },
  GOOGLE_UNAVAILABLE: {
    desc: '（v44）Google 登录暂不可用：服务端没配置 GOOGLE_CLIENT_ID（功能整体关闭），或连不上 Google 公钥服务。',
    action: '改用本站其他登录方式（国际站有 GitHub，国内站有账号密码）；持续出现向运营方反馈（服务器访问 Google 可能需要配代理）。Agent 不涉及。',
  },
  GOOGLE_CREDENTIAL_INVALID: {
    desc: '（v44）Google 登录凭证（ID Token）无效：伪造、签名不对、已过期、不是发给本应用的，或格式不是合法 JWT。',
    action: '网页端重新走一遍 Google 登录拿新凭证；凭证是一次性的，不要重放旧值。Agent 不涉及。',
  },
  GOOGLE_ALREADY_BOUND: {
    desc: '（v44）绑定 Google 时，该 Google 账号已绑了别的号，或当前账号已绑了别的 Google 账号。',
    action: '用该 Google 账号直接登录它已绑定的号，或换一个 Google 账号绑定；暂不支持解绑。Agent 不涉及。',
  },
  GITHUB_UNAVAILABLE: {
    desc: '（v45）GitHub 登录暂不可用：服务端没配 GitHub OAuth App 凭证（GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GITHUB_REDIRECT_URI / FRONTEND_URL 缺一即关闭），或调 GitHub 接口失败。',
    action: '稍后重试或改用其他登录方式；持续出现向运营方反馈（服务器访问 GitHub 可能需要配代理）。Agent 不涉及。',
  },
  OAUTH_CODE_INVALID: {
    desc: '（v45）一次性登录码无效、已过期（60 秒有效）或已被使用（只能用一次）。',
    action: '回登录页重新点一次 GitHub 登录拿新码；不要重放旧码（刷新页面不会重复报错，码已从地址栏抹掉）。Agent 不涉及。',
  },
  GITHUB_ALREADY_BOUND: {
    desc: '（v45）绑定 GitHub 时，该 GitHub 账号已绑了别的号，或当前账号已绑了别的 GitHub 账号。',
    action: '用该 GitHub 账号直接登录它已绑定的号，或换一个 GitHub 账号绑定；暂不支持解绑。Agent 不涉及。',
  },
  RATE_LIMITED: {
    desc: '（v43）请求过于频繁：同一 IP 每分钟最多生成 20 张微信二维码（v44 起 Google 登录尝试、v45 起 GitHub 授权发起同样限频，各 20 次/分钟）。',
    action: '等待一分钟后再试；不要连续重试。',
  },
  CHAT_GOVERNMENT_TOO_LOW: {
    desc: '（v51）聊天：主城官府未达到 3 级，不能在世界频道发言（私聊不受此限）。仅玩家连接可用。',
    action: '玩家先把主城官府升到 3 级，或改用私聊。Agent 不涉及聊天。',
  },
  CHAT_MUTED: {
    desc: '（v51）聊天：账号被运营禁言，响应附 until（解禁时刻）。仅玩家连接可用。',
    action: '等到 until 之后再发言；不要重试。Agent 不涉及聊天。',
  },
  CHAT_BLOCKED: {
    desc: '（v51）聊天：对方屏蔽了当前玩家，私聊发送失败。仅玩家连接可用。',
    action: '不要重试；告诉玩家对方已屏蔽。Agent 不涉及聊天。',
  },
  CHAT_RATE_LIMITED: {
    desc: '（v51）聊天：同一频道两次发言间隔不足 10 秒，响应附 retryAfterSeconds。仅玩家连接可用。',
    action: '等待 retryAfterSeconds 秒后再发；不要连续重试。Agent 不涉及聊天。',
  },
  AGENT_PASSWORD_FORBIDDEN: {
    desc: '（v47）Agent 用账号密码登录被拒：密码登录只属于玩家本人，Agent 一律用账号的永久 Agent 令牌登录（哪个站都一样）。',
    action: '改用 LOGIN {token, asAgent: true}（token 为玩家提示词里的 sk_ 令牌）；令牌失效（SESSION_INVALID / close code 4003）时请玩家重新发一次新提示词。',
  },
  PASSWORD_LOGIN_CLOSED: {
    desc: '（v47）该站点不开放账号密码登录：游戏有两个站（同一套服务与数据库、账号通用），国际站 slg.yuntianyou.cc 只有 Google / GitHub 登录，国内站才有账号密码。',
    action: '网页端改用 Google / GitHub 登录；老密码账号先在国内站登录并绑定 Google / GitHub，再来本站用绑定方式登录进同一个号。Agent 不涉及（Agent 只用令牌）。',
  },
  INTERNAL: {
    desc: '服务端内部错误。',
    action: '可稍后重试同一请求；持续出现时向运营方反馈。INTERNAL 可能出现在任何请求的响应中。',
  },
};

/** 连接与会话生命周期规则，写入文档第 1 节 */
export const CONNECTION_RULES: string[] = [
  `连接地址由运营方提供，WebSocket 路径固定为 /ws（本地开发为 ws://127.0.0.1:8080/ws）；HTTP 健康检查 GET /health。`,
  '连接建立后必须在时限内完成一次成功的 LOGIN（默认 15 秒，部署可调），否则服务端以 close code 4001 主动断开。',
  '登录成功前只允许发送 LOGIN（op 1）、微信扫码登录的协议（WX_QR_CREATE / WX_SCAN / WX_CONFIRM / WX_CANCEL，op 54–57，仅供网页与微信小游戏）、GOOGLE_LOGIN（op 60，仅供网页）与 GITHUB_AUTH_START / OAUTH_REDEEM（op 62 / 63，仅供网页），其他协议号一律返回 NOT_LOGGED_IN；登录后重复发送 LOGIN 返回 ALREADY_LOGGED_IN。等人扫码的连接，登录时限会延长到二维码过期之后。',
  'Google 一键登录（v44）与 Agent 无关：网页用 Google Identity Services 拿到 ID Token 后经 GOOGLE_LOGIN 换会话令牌再 LOGIN；没绑定过的 Google 账号自动建号（无密码），这类账号的 Agent 接入同样走「Agent 令牌」。',
  'GitHub 一键登录（v45）与 Agent 无关：网页经 GITHUB_AUTH_START 拿到 GitHub 授权地址后整页跳转，授权结果由 HTTP 回调（GET /auth/github/callback）302 带回前端，网页用 OAUTH_REDEEM 把 60 秒一次性登录码换成会话令牌再 LOGIN；没绑定过的 GitHub 账号自动建号（无密码），这类账号的 Agent 接入同样走「Agent 令牌」。',
  '每条请求帧可携带 seq（正整数，由客户端自增分配）；响应帧原样带回该值用于关联请求，推送帧没有 seq。',
  '同一账号允许多条连接同时在线（典型：玩家网页 + 若干 Agent）。指令的直接结果只回发起连接；账号的状态变化推送给该账号所有在线连接。',
  '个别协议对连接声明的登录类型有限制：RESET_ACCOUNT 仅限玩家连接，AGENT_REPORT_PLAN 仅限 Agent 连接（越权返回 AGENT_FORBIDDEN）。该限制基于自报 role，不是可独立验证的安全边界。聊天仅限玩家本人（Agent 连接不可用，本文档不收录聊天接口）。',
  'GET_AGENT_TOKEN / RESET_AGENT_TOKEN 仅限玩家连接（op 64 / 65，v46）。每个账号有一个永久 Agent 令牌（sk_ 前缀，建号自动生成、永不过期），玩家「复制给 AI」的提示词里自带令牌；你用 LOGIN {token, asAgent: true} 登录即可，玩家不必交出账号密码。令牌失效（玩家重置，SESSION_INVALID / close code 4003）时不要重试，请玩家重新发一次新提示词。',
  'LOGIN 支持密码与令牌（token）两种方式：密码登录成功签发会话令牌、令牌登录免密并滑动续期（有效期 30 天，部署配置可调）。令牌可持久保存（如浏览器 localStorage）实现自动登录；收到 SESSION_INVALID 时丢弃令牌并在该站重新登录。**双站点（v47，AISLG-130）**：游戏两个站（国内站 / 国际站 slg.yuntianyou.cc）共用同一套服务与数据库、账号通用；**国际站不开放账号密码登录**（LOGIN 密码登录返回 PASSWORD_LOGIN_CLOSED），只有 Google / GitHub 登录；老密码账号先在国内站登录并绑定 Google / GitHub，再去国际站用绑定方式登录进同一个号（绑定后密码在国内站照样可用）。',
  'Agent 一律不能用账号密码登录（任何站都一样，LOGIN 密码登录返回 AGENT_PASSWORD_FORBIDDEN）：**只用玩家的永久 Agent 令牌** LOGIN {token, asAgent: true}——令牌来自玩家在本站网页「复制给 AI」的提示词（v46，sk_ 前缀、永不过期）。账号也无法自行创建（v48 起密码登录不存在的用户名返回 SIGNUP_CLOSED，不再自动注册；新账号只能由玩家经 Google / GitHub / 微信扫码登录创建）。',
  'LOGOUT 吊销本连接登录所用的令牌并关闭连接（close code 1000）；使用同一令牌的其他连接在下次登录时会收到 SESSION_INVALID。',
  '服务端不补发断线期间错过的推送。重连后重新 LOGIN，再用 GET_STATE / GET_EVENTS / GET_AGENT_INFO 按需查询现状与历史。',
  '服务端主动断开的情形：登录超时（close code 4001）、服务端关闭（1001）、单帧超过 64KB（1009）。',
  '第一期没有心跳（Ping/Pong）机制，Agent 需自行检测连接静默并断线重连（重连后重新登录）。',
  '生产环境使用 wss://（TLS）连接；ws:// 仅限本地开发。',
];

export const GLOSSARY: Array<{ term: string; desc: string }> = [
  { term: '协议号（op）', desc: '消息类型的整数标识。请求与响应用同一值，推送帧以 op 区分推送类型。' },
  { term: 'seq', desc: '客户端为每条请求分配的自增整数，响应原样带回，用于把响应与请求配对；推送无 seq。' },
  { term: '推送（push）', desc: '服务端主动发给已登录连接的帧（push: true），不属于任何请求的响应。' },
  {
    term: 'role（登录类型）',
    desc: 'LOGIN 时由 asAgent 声明并绑定到连接的来源标记（player / agent）。它是登录方自行声明的，不是可独立验证的身份，服务端原则上不据此做差异化访问控制（例外：RESET_ACCOUNT 仅玩家、AGENT_REPORT_PLAN 仅 Agent——基于自报 role 的协议级限制，不是可验证的安全边界）。',
  },
  {
    term: '兵种（troop）',
    desc: '一期七种：porter 民夫、militia 义兵、scout 斥候、pikeman 长枪兵、swordsman 刀盾兵、archer 弓箭兵、cavalry 轻骑兵；二期（v33，AISLG-86~90）再加铁骑兵 iron_cavalry（军营 11 级后期重装主力）、辎重车 supply_wagon（军营 3 级，负重 5000 的纯后勤）、床弩 ballista（军营 7 级，射程 95）、冲车 siege_ram（军营 8 级，攻城时削弱城墙减伤）。各有军营等级门槛、单兵成本、时长与小时耗粮（占位数值，见 RECRUIT）；军队耗粮已接入（v14，见 GET_STATE 的 armyFoodUsePerHour）。city.army 按兵种统计城内驻军，征兵完成时累加。',
  },
  {
    term: '征兵队列（recruitQueue）',
    desc: '军营处理征兵：RECRUIT 无征募中时立即开始（status=recruiting，时长 = 单兵时长 × 数量），有征募中且未满时入队（status=queued）；队列 = 1 征募中 + 最多 2 排队（占位）。资源与人口在发起时扣减，取消排队条目全额返还；征募中能否取消待定。队列独立于建造队列。',
  },
  {
    term: '守城加成（defenseBonus）',
    desc: '城墙为守城提供的防御加成（占位：前 10 级每级 +5、11~20 级每级 +2——20 级 70，v31 AISLG-85；百分数数值；v27 起另加城防科技每级 +1 个百分点），随 GET_STATE 下发；消费方是守城战斗结算。v30（AISLG-82）起另有**箭塔**：守城战里城墙位上不会被消灭的远程单位，每回合开始对射程内最近的敌方兵堆造成固定伤害（150 × 等级，不走判定链、不吃防御与城墙减伤；射程 45 + 5 × 等级，攻方距城墙位 ≤ 射程才被射），仅守城战（NPC 袭击主城）生效，守军全灭仍判守城失败；战报单独列出箭塔伤害（towerDamage / roundLog[].towerDamage）。数值校准见 docs/battle-calibration.md「箭塔」。',
  },
  {
    term: '计划（plan）',
    desc: 'Agent 经 AGENT_REPORT_PLAN 上报的两段自报文本：nextAction（下一步动作）与 overallPlan（整体计划）。账号只保留最新快照（后写覆盖，RESET_ACCOUNT 清空），经 GET_AGENT_INFO 的 plan 字段查询、PUSH_AGENT_PLAN 推送。它是托管监控的展示信息，未经验证、不参与游戏逻辑。',
  },
  { term: 'initiator（发起者）', desc: '记录在建造与事件里的 role，取自发起原始指令的连接，不是执行到期结算的 Worker。' },
  { term: 'accountId', desc: '账号的唯一标识（UUID）。玩家与其 Agent 共用同一账号：玩家用密码或第三方登录，Agent 只能用玩家的永久 Agent 令牌（v47 起 Agent 不能用账号密码）。' },
  {
    term: 'sessionToken（会话令牌）',
    desc: '登录成功后签发的会话凭证（当前为 43 字符随机串），服务端只存其哈希。有效期 30 天、每次令牌登录滑动续期；LOGOUT 可吊销。与 Agent 的永久令牌（v46，sk_ 前缀、不过期）分属两套：浏览器会话与 Agent 令牌互不顶替。',
  },
  {
    term: '城池（city）',
    desc: '玩家当前的城池，容纳资源、人口与建筑；玩家可为它改名（RENAME_CITY），城池带等级（level，v24 起 = 该城官府等级，官府升级城池等级跟着升）。允许多座城池：注册创建主城；占领 NPC 城池后该地块成为分城（GET_STATE 的 cities 列出全部城池，v12）。v24（AISLG-58）起分城可独立建造、征兵、出征：城池类协议（GET_STATE / BUILD / UPGRADE / RENAME_CITY / RECRUIT / EXCHANGE / MARCH / SCOUT）带可选 cityId 指定操作哪座城，缺省 = 主城；各城的资源、人口、仓储、建造与征兵队列、驻军与产耗粮单独结算、互不串账。分城名额 = floor(主城官府等级 ÷ 3)，占领 NPC 城需主城官府 ≥ 3（见 MARCH）。',
  },
  {
    term: '世界地图（world）',
    desc: `服务端启动时一次性生成的 ${WORLD_SIZE}×${WORLD_SIZE} 方格世界（规模为占位决策）：每格有地形（平原 / 草原 / 森林 / 丘陵 / 荒漠 / 沼泽 / 湖泊 / 金矿）与类别（野地 / NPC 城池 / 玩家城池）。主城在注册时分散落位：分配到与既有城池距离最远的空闲地块（首座在地图中心附近，城市随注册数摊开全图）；玩家用地块坐标交互（GET_WORLD_MAP / GET_TILE）。服务端检测到世界规模调整时会重建地图并重排城池（行军与领地作废，部队回城）。`,
  },
  {
    term: '野地（wilderness）',
    desc: `可掠夺、可占领的地块，带 1..10 级等级与地形。未占领时有原住守军（v24，AISLG-48 新曲线：Lv1–2 纯义兵 8×等级；Lv3 起义兵 6×等级 + 弓箭兵 (等级−2)；每块野地在基准上按坐标固定 ±20% 浮动，侦察可见具体数量；被打残后不会立刻回满，每小时恢复基准编成的 25%，随全局时间缩放）。打 Lv N 野地的推荐兵力 / 胜率 / 期望净收益见「兵种与战斗属性」一章的「野地进攻口径」。v16 起出征带任务：task=plunder 掠夺——胜利从奖励池装填：地形资源 750×等级 + 金币 250×等级（v21 掠夺含金，AISLG-31；金矿 gold_mine 保持空池——金矿定位占领生息），按幸存部队负重（金→粮→木→石→铁顺序）装满即止、立即入账，不改归属、幸存部队返程，地块进入 24 小时掠夺冷却（基准，受全局时间缩放）；task=occupy 占领——无一次性战利品，该城占领野地数低于官府等级（上限）时改归属、幸存部队驻守。占领加成 = 固定基线 + 等级 × 地形每级增量（v21 加成保底，AISLG-28：森林 / 草原 / 金矿 30+70×等级、平原 / 丘陵 / 荒漠 25+55×等级、沼泽 20+40×等级、湖泊 40+80×等级，Lv1 合计与 v19 同值），按地形作用到对应资源，计入城池产量；驻军另按 等级 × 兵力 × 1/小时 采集同一资源（金矿采金，不落背包物品）。占领以驻军存在为前提：召回驻军即放弃占领，驻军被 NPC 袭击全灭时占领失效。`,
  },
  {
    term: '战斗（battle）',
    desc: `多回合推进结构（v13 落地）：双方兵堆按兵种在一维战场迎面推进，战斗速度决定行动先后，射程决定能否攻击到目标——射程差是核心克制关系（纯近战冲不进守方远程射程时可能全场打不到，对照「兵种与战斗属性」的 speed / range 与「编队指南」）。野地遭遇战双方迎面推进；攻城战（NPC 城池 / NPC 袭击主城）守方据墙而守：位于城墙位的守方受击有减免（减免值即情报的 wallDefensePercent / 城池的 defenseBonus），出城接敌即失去减免。攻方歼灭守方获胜（胜方必有幸存，满足占领语义）；攻方全灭或回合耗尽未突破判攻方战败，幸存部队撤回出发城。伤害与判定的具体算法不对外公开；「伤害 → 减员」的定性口径：伤害按目标兵堆摊到单位，累计伤害 ÷ 单兵生命向下取整即减员数——经验参考量级（Lv1 编成对轰）约 450~470 点伤害换 1 名减员，随兵种生命与判定浮动；战报双方汇总（units / totalHp / damage）与逐回合统计可复盘。武将、科技、装备、攻城器械、城防设施不参与结算。`,
  },
  {
    term: '侦察（scout）',
    desc: `SCOUT 派斥候（×2 行军速度）前往目标地块：到达不战斗，产出情报快照（守军按兵种、城墙减伤、NPC 城池库存、占领者）记为 march_completed 事件（outcome=scouted）并自动返程。快照同时存为账号对该地块的最近情报——GET_TILE 对 NPC 城池的驻防 / 库存详情只对侦察过的地块开放（返回快照，不保证实时）；野地与玩家城池的驻军构成暂保持实时可见（玩家对抗阶段的情报规则另行设计）。当前侦察无对抗判定（不会被拦截，占位）。`,
  },
  {
    term: '调兵（transfer）',
    desc: `MARCH 的目标为本账号分城时即调兵：不战斗，编队行军到达后并入该分城的城内驻军（city.army，v24 起与该城征兵产出同位，可立即用于该城的出征），行军速度按编队最慢兵种折算。v24 起任意自有城之间都可调兵（出发城用 cityId 指定，缺省主城）。`,
  },
  {
    term: '行军（march）',
    desc: `MARCH 从主城派出部队（发起时立即扣减城内驻军），时长 = Chebyshev 距离 × 每格秒数（默认 15 秒，占位）÷ 编队最慢兵种的行军速度系数（斥候 ×2、轻骑兵 ×1.5，占位），总时长再 ÷ 全局时间缩放（钳 1 秒）；到达由服务端自动结算（战斗 / 增援 / 调兵 / 侦察）。RECALL_GARRISON 撤回占领野地的全部驻军（即放弃占领）；RECALL_MARCH 把行军途中（status=marching 且非返程）的部队原地折返（同速回程）。`,
  },
  {
    term: '战报（battle report）',
    desc: `每场战斗（出征野地 / 攻 NPC 城池 / NPC 袭击驻军 / NPC 袭击主城，v21 新增 city_raid 类别）生成一份战报，账号以攻方或守方身份持有、可查询（GET_BATTLE_REPORTS）并实时推送（PUSH_BATTLE_REPORT）：含双方编成与损失、汇总口径（v21：units 总单位数、totalHp 总血量、avgRange 平均射程；v23：maxRange 单兵射程最大值、rangedUnits 远程单位数——avgRange 是数量加权平均、会被大量近战稀释，判断远程威胁用 maxRange + rangedUnits，AISLG-49；读取时按编成汇总，历史战报同样下发）、总输出 damage、逐回合伤害与损失统计、终局原因与城墙减伤。战损不进入伤兵治疗、俘虏招降或逃兵召回系统（一期确认）——损失即最终减员。`,
  },
  {
    term: '掠夺（plunder）',
    desc: `MARCH task='plunder'（缺省）的出征任务（v16）。胜利后从目标奖励池按幸存部队负重（Σ 数量 × 单兵 carry，民夫 500 / 斥候·刀盾兵 80 / 轻骑兵 100 / 其余 50–60，占位）装填战利品，金→粮→木→石→铁顺序装满即止（v21 含金，AISLG-31），立即入账出发城（不钳储量上限），幸存部队返程、不改归属。野地奖励池 = 地形资源 750×等级 + 金币 250×等级（v21；金矿为空池——金矿定位占领生息）；NPC 城 = 持久化库存（v21 起含金币；库存不再生、掠空后无收益）。同一目标地块成功掠夺后进入 24 小时冷却（基准，受全局时间缩放；plundered_at；冷却内发起被拒 PLUNDER_COOLDOWN，在途到达仍战斗但资源为零）。玩家主城被 NPC 袭击攻破时按同口径结算（仓库保护 4000×等级、四资源固定均分各 1000×等级，金币不受仓库保护但单次最多抢走存量的 5%（v41，AISLG-125；v38 起玩家互掠为存量的 10%，见 MARCH 玩家对抗段）。`,
  },
  {
    term: 'NPC 城池（npc_city）',
    desc: `地图上可掠夺的普通 NPC 城（初始约 ${NPC_CITY_COUNT} 座，等级 1..3，占位）。可掠夺或占领（v24，AISLG-58）：task=plunder 掠夺——战斗 vs 其驻防（守方据墙待敌），胜利按幸存部队负重从持久化库存扣减（v21 起含金币，AISLG-31；库存不再生）；task=occupy 占领变分城——需主城官府 ≥ 3、分城数 < floor(主城官府 ÷ 3)、目标等级 ≤ 出发城官府等级，打赢后接收其建筑与剩余库存、幸存部队进城驻守。NPC 城池是有限存量（一期不做自动补充）；玩家城的占领设计随玩家对抗阶段另行接入。`,
  },
  {
    term: '名城（famous city）',
    desc: '全图 8 座高亮的 NPC 名城（v24，AISLG-56；官渡 / 许昌 / 洛阳 / 长安 / 成都 / 建业 / 襄阳 / 邺城，从 Lv3 NPC 城原地升格，分散在地图各区域；地块 famous 字段标识名称、阶段与独占加成）。分两阶段攻打：先清外围驻军（外围阶段，对其出征打外围），外围清空后进入城守阶段，限时内（famous.recoversAt，约 6 小时 ÷ 时间缩放）出征攻城守——占领后成为分城（名称为名城名）并带独占加成：该城产量 +20%（只对占领者生效，已计入 city.production）；超时无人攻下城守则外围恢复满编。守军 = 同等级普通 NPC 城 × 3（外围与城守各一半）。名城计入分城上限。',
  },
  {
    term: 'NPC 袭击（npc raid）',
    desc: `NPC 会周期性主动攻击玩家的目标（基准每 120 分钟一次，v21 AISLG-28 调参；v19 曾为 30 分钟；实际 ÷ 全局时间缩放）。目标池（v21，AISLG-32 方案 A）：80% 随机挑一块已占领野地，20% 随机挑一座官府 ≥ 2 的玩家主城（官府 Lv1 的新号不在池内，构成开号缓冲）；不攻击分城或行军途中的部队。**袭击编成公式（v21 公开，AISLG-29）**：义兵 10×等级 + 弓箭兵 1×等级，参考战力 25×等级（v21 调参；v19 曾为 义兵 15×等级 + 弓箭兵 2×等级、40×等级）——野地袭击按地块等级推导；主城袭击按**守军战力**推导（v22 AISLG-40 方案 B）：level = clamp(ceil(守军参考战力 ÷ 25), max(1, floor(官府等级 ÷ 2)), 官府等级)——守军归零时袭击降到官府一半强度（不再零守军挨满编），官府升级（经济行为）不再自动放大挨打规模；下限防「清空守军骗低强度」。袭击走多回合战斗结算并生成守方视角战报（野地为 kind='npc_raid'、主城为 kind='city_raid'，主城为守城战：城墙 defenseBonus 减免生效）。野地袭击：驻军全灭则占领失效（wilderness_lost），守住则驻军按战斗折损。主城袭击：守方驻军全灭则 NPC 按被掠城仓库保护掠夺资源（可掠量 = max(0, 存量 − 1000×仓库等级/资源；金币不受仓库保护但单次最多抢走存量的 5%，v41 AISLG-125），按 NPC 幸存部队负重装填（金→粮→木→石→铁），城池归属不变；守住则仅按战斗折损。事件按 npc_raid 记录（target='wilderness' / 'city'，outcome=repelled / garrison_lost，主城被掠含 loot；主城袭击的 level 即上述推导结果）。**主城免战期（v22 AISLG-40 方案 A）**：主城被攻破后 2 × 袭击基准间隔内（随 timeScale 缩放）不再进入袭击目标池，让守城方至少完成一轮重建；每次被攻破重置计时。免战截止随 GET_STATE 的 city.truceUntil 下发，到期自动回池、无事件通知。**防御口径（按 v21 参数批量模拟校准）**：击退 Lv N 袭击并保持净收益为正，建议驻军战力 ≥ 4 × 25 × N（= 100×N），并混编约 1/5 弓箭兵对抗来袭远程——如 Lv1 袭击（25 战力）建议驻军 80 义兵 + 5 弓箭兵（模拟：守住率 100%、场均折损约 3 人，2 小时占领 + 采集收入净 +135 金/轮）；经验值非保证，重防御与高等级地块收益更好。`,
  },
  {
    term: '建筑类型（kind）',
    desc: '一期九种建筑，每种同城限一座（重复建造返回 BUILDING_EXISTS，成长走 UPGRADE）：farm 农田（产粮）、lumber_mill 伐木场（产木）、quarry 采石场（产石）、iron_mine 铁矿（产铁）、house 民房（人口上限）、government 官府（自动产金，100×等级/小时，v19；v16 起兼野地占领上限）、barracks 军营（征兵）、warehouse 仓库（防掠夺保护，v16 规则落地：4000×等级、四资源固定均分）、wall 城墙（守城加成）；v27 起第十种 academy 书院（科技研究所需，第 N 级科技要求书院 ≥ N 级）。生产建筑持续产出：产量 = 等级 × 每级速率，另受野地加成与农耕科技（v27，四资源每级 +5%）加成，不占用人口。',
  },
  {
    term: 'production（产量）',
    desc: '城池当前每小时产量，按资源归集（金/粮/木/石/铁）。四种生产资源各有 100/小时的基础产量（无对应建筑也产出）；金币由官府（100×等级/小时，v19）与占领金矿生产（无基础产量）。产量随建筑建成即时生效；资源按流逝时间累积，读取城池（GET_STATE）或扣减资源时会先结算到当前时刻，离线期间照常累积。',
  },
  {
    term: '人口（population）',
    desc: '城池人口 = { current 当前值, cap 上限, growthPerHour 每小时增长 }。上限 = 50 + 100 × 民房等级 × (民房等级 + 1)（v19：无民房即基线 50）；增速 = 10 × 民房等级 × (等级 + 1)/小时（v19：无民房为 0），增长到上限为止（与资源同样懒结算，离线照常）。征兵将消耗人口；一期无拆除，民房等级只增不减。',
  },
  {
    term: '仓储上限（storage）',
    desc: '储量上限（v8 确认规则；v22 AISLG-41 随全局缩放）：粮/木/石/铁各自 = （10000 + 对应资源**建筑产量**（各生产建筑等级 × 每级速率之和，**不含**无建筑的 100/h 基础产量，**不含**野地占领加成）× 100）× timeScale，金币 = 100 万 × timeScale——产出与上限同幅缩放，填满时长不受缩放影响：四资源恒为基准 100 小时；金币随官府等级与金矿占领加成变化（仅有官府产金时 = 10000 ÷ 官府等级 小时，官府 Lv4 时才是 2500 小时）：storage[k] ÷ production[k] 即为缓冲时长。过满资源可经集市（EXCHANGE）换成金币。达到上限后停止对应生产（余数冻结，消耗降到上限以下后恢复增长）；已有超限存量不直接扣减。仓库不改变储量上限：v21 起防掠夺保护消费方已接入（NPC 袭击主城攻破后，可掠量 = max(0, 存量 − 保护额)，保护总量 4000×等级、粮/木/石/铁固定均分各 1000×等级；金币不受仓库保护，但 NPC 单次最多抢走存量的 5%（v41 AISLG-125）、玩家互掠为存量的 10%）。',
  },
  {
    term: '集市（exchange）',
    desc: `EXCHANGE 协议（v22 新增，AISLG-42）：把四种基础资源（粮/木/石/铁）之一按固定汇率换成金币——汇率 4 单位资源 → 1 金（占位决策，金币不可逆向兑换）。即时入账、不钳储量上限、无冷却可反复用；产出 resource_exchanged 事件。**满级之后做什么（v22 口径）**：建筑 10 级、人口与储量到顶后，持续可做的事 = ① 征募与维持军队（吃金与人口）、② 出征掠夺 / 占领野地（军事收入）、③ 把过满的四资源经集市换成金币继续投入军事——城池等级（city.level）的提升体系仍待设计。`,
  },
  {
    term: '建造队列（queue）',
    desc: 'BUILD / UPGRADE 采用排队制：无在建时立即开工（status=building，dueAt 为预计完成时间）；有在建时进入排队（status=queued，dueAt 为 null），队首完成后由后台自动激活为 building。队列 = 1 条在建 + 最多 2 条排队（占位数值），再发起返回 QUEUE_FULL。排队条目可随时 CANCEL_BUILD 取消并全额返还成本（确认规则）；进行中任务能否取消待定。原游戏的元宝加速第一期未实现。',
  },
  { term: 'building / queued / completed / cancelled', desc: '建筑条目状态：在建 / 排队 / 已完成 / 已取消（取消仅限排队条目，条目保留为历史，不再出现在 queue 里）。' },
];

/** 通用帧示例（文档第 2 节「消息帧格式」） */
export const FRAME_EXAMPLES: {
  request: ClientFrame;
  responseOk: ResponseFrame;
  responseError: ResponseFrame;
  push: PushFrame;
} = {
  request: { op: 10, seq: 1 },
  responseOk: {
    op: 10,
    seq: 1,
    ok: true,
    data: {
      city: exampleCity(),
    },
  },
  responseError: {
    op: 21,
    seq: 2,
    ok: false,
    error: { code: 'BUILD_IN_PROGRESS', message: '已有在建建筑' },
  },
  push: {
    op: 2001,
    push: true,
    data: { online: true, at: '2026-09-25T08:00:10.123Z' },
  },
};
