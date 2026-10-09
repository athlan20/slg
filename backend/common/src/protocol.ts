// 协议号、消息帧与错误码的唯一出处（API、Worker 与前端共用）。
// 协议的对外文档由 protocol-doc*.ts 清单生成（npm run gen:api-doc → docs/agent-api.*，
// 漂移检查 npm run check:api-doc）；调整协议时必须同步更新清单并重新生成。
// backend/README.md 的协议表已由生成文档取代；scripts/smoke.ts 按生成文档编写。
// 协议版本与变更历史（v2..v16）见 protocol-version.ts。
export { PROTOCOL_VERSION } from './protocol-version';
// 类型只 import（运行时擦除）：本文件的同名类型定义拆在 protocol-agent.ts，
// 经下方 export type 再导出供外部使用，本文件内部引用也需要这个名字
import type { EventView } from './protocol-city';

/** 客户端请求与服务端推送的协议号 */
export const Op = {
  /** C→S 登录（未登录连接仅允许此协议；支持密码与会话令牌两种方式） */
  LOGIN: 1,
  /** C→S 登出：吊销本连接登录所用的会话令牌，服务端随后关闭连接 */
  LOGOUT: 2,
  /** C→S 查询当前城池状态 */
  GET_STATE: 10,
  /** C→S 查询历史事件 */
  GET_EVENTS: 11,
  /** C→S 查询 Agent 连接与操作信息 */
  GET_AGENT_INFO: 12,
  /** C→S 发起建筑建造（data.kind 指定建筑类型）；v3 起为四种资源建筑的统一入口 */
  BUILD: 21,
  /** C→S 发起建筑升级（data.kind 指定建筑类型，升到下一等级；v5，与建造共用队列） */
  UPGRADE: 22,
  /** C→S 取消建造队列中的排队条目（data.buildId；v7，全额返还已扣成本；在建可否取消待定） */
  CANCEL_BUILD: 24,
  /** C→S 城池改名（data.name；v7） */
  RENAME_CITY: 25,
  /** C→S 一键重置账号数据（data.confirm=true；v9，全部游戏数据回到开号初始状态） */
  RESET_ACCOUNT: 26,
  /** C→S Agent 上报计划（data.nextAction / data.overallPlan；v10，仅 Agent 连接） */
  AGENT_REPORT_PLAN: 27,
  /** C→S 发起征兵（data.troop 兵种 + data.count 数量；v11，军营等级解锁兵种） */
  RECRUIT: 28,
  /** C→S 取消征兵队列中的排队条目（data.recruitId；v11，全额返还资源与人口） */
  CANCEL_RECRUIT: 29,
  /** C→S 查询世界地图窗口（data.x/y/w/h 可选；v12，缺省以主城为中心 10×10） */
  GET_WORLD_MAP: 30,
  /** C→S 查询地块详情（data.x + data.y；v12，野地 / NPC 城池 / 城池） */
  GET_TILE: 31,
  /** C→S 从主城出征（data.x/y 目标 + data.troops 按兵种数量；v16 新增可选 data.task plunder/occupy，缺省 plunder；目标为本账号分城时为调兵） */
  MARCH: 32,
  /** C→S 撤回占领野地的驻军（data.x + data.y；v12，撤回即放弃占领） */
  RECALL_GARRISON: 33,
  /** C→S 斥候侦察目标地块（data.x/y + data.count；v13，到达产出情报快照并返程） */
  SCOUT: 34,
  /** C→S 撤回行军途中的部队（data.marchId；v13，原地折返、按已走时长返程） */
  RECALL_MARCH: 35,
  /** C→S 查询战斗战报（data.limit / beforeId；v13） */
  GET_BATTLE_REPORTS: 36,
  /** C→S 集市兑换（data.resource 四选一 + data.amount；v22，AISLG-42：按固定汇率把资源换成金币） */
  EXCHANGE: 37,
  // SET_AGENT_DIRECTIVE（op 38，作战方针）已随 v49 移除：玩家改与自己的 Agent 直接讨论，
  // 不再经游戏设置方针。老客户端发该号会收到 UNKNOWN_OP。
  /** C→S Agent 写回战报点评（data.reportId + data.text；v23，AISLG-53，仅 Agent 连接） */
  AGENT_COMMENT_REPORT: 39,
  /** C→S Agent 写离线日报（data.text；v23，AISLG-54，仅 Agent 连接） */
  AGENT_DAILY_REPORT: 40,
  /** C→S 查询离线日报（v23，AISLG-54：离线时长、离线期间收获/损失汇总与 Agent 最近日报） */
  GET_OFFLINE_REPORT: 41,
  /** C→S 查询全服播报（v23，AISLG-60：最近的大事列表，新→旧） */
  GET_SERVER_BROADCASTS: 42,
  /** C→S 查询全服排行榜（v23，AISLG-61：三榜快照，前 50 名 + 我的名次） */
  GET_LEADERBOARD: 43,
  /** C→S 查询科技状态（v27，AISLG-77：6 项科技等级 / 下一级成本与耗时 / 进行中的研究） */
  GET_TECHS: 44,
  /** C→S 发起科技研究（v27，AISLG-77：data.tech；账号同一时间只研究一项，需书院） */
  RESEARCH_TECH: 45,
  /** C→S 取消进行中的研究（v27，AISLG-77：全额返还） */
  CANCEL_RESEARCH: 46,
  /** C→S 查询移动目标（v28，AISLG-78：流寇与运粮商队的当前位置、公开路线与时刻表） */
  GET_MOVING_TARGETS: 47,
  /** C→S 查询黄巾之乱（v29，AISLG-76：事件进度 / 营地与老巢 / 我的贡献与名次 / 贡献榜） */
  GET_YELLOW_TURBAN: 48,
  /** C→S 查询武将（v36，AISLG-114/115/116：账号武将 / 酒馆候选 / 上限 / 名将归属） */
  GET_HEROES: 49,
  /** C→S 酒馆招募武将（v36，AISLG-114：data.candidateId，金币从酒馆所在城扣除） */
  RECRUIT_HERO: 50,
  /** C→S 解雇武将（v36，AISLG-114：data.heroId；名将解雇后回到全服可获得状态） */
  DISMISS_HERO: 51,
  /** C→S 任命 / 撤换城守（v36，AISLG-115：data.heroId，null 撤任；守城加成 + 产量加成） */
  ASSIGN_HERO: 52,
  /** C→S 开启主动免战（v38，AISLG-122：无参数；每周一次免费、12 小时，期内别人打不了他、他也不能出兵打玩家） */
  TRUCE: 53,
  /** C→S 生成微信扫码二维码（v43：data.purpose = login | bind；login 登录前即可发，bind 需玩家登录；仅供网页） */
  WX_QR_CREATE: 54,
  /** C→S 微信小游戏扫码上报（v43：data.ticket + data.code；登录前即可发，仅供微信小游戏） */
  WX_SCAN: 55,
  /** C→S 微信小游戏确认登录 / 绑定（v43：data.ticket；只接受扫码的那条连接，仅供微信小游戏） */
  WX_CONFIRM: 56,
  /** C→S 微信小游戏取消登录 / 绑定（v43：data.ticket；只接受扫码的那条连接，仅供微信小游戏） */
  WX_CANCEL: 57,
  // 58 / 59（v43 的 ISSUE_AGENT_TOKEN / REVOKE_AGENT_TOKEN）已随 v46 移除：Agent 接入改为
  // 每账号一个永久令牌（GET_AGENT_TOKEN / RESET_AGENT_TOKEN，op 64 / 65）。
  /** C→S 用 Google ID Token 换会话令牌（v44：data.credential；登录前可发，仅供网页；第一次自动建号） */
  GOOGLE_LOGIN: 60,
  /** C→S 给当前账号绑定 Google（v44：data.credential；仅玩家连接，仅供网页） */
  GOOGLE_BIND: 61,
  /** C→S 发起 GitHub 授权（v45：data.purpose = login | bind；login 登录前可发，返回 GitHub 授权地址由网页整页跳转） */
  GITHUB_AUTH_START: 62,
  /** C→S 用一次性登录码换会话令牌（v45：data.code；登录前可发，OAuth 回跳进页面时使用） */
  OAUTH_REDEEM: 63,
  /** C→S 查看本账号的永久 Agent 令牌（v46：无参数；仅玩家连接，没有时自动补生成，响应带令牌原文） */
  GET_AGENT_TOKEN: 64,
  /** C→S 重置永久 Agent 令牌（v46：无参数；仅玩家连接，旧令牌立即失效、用它在线的连接被断开） */
  RESET_AGENT_TOKEN: 65,
  /** C→S 聊天：查询世界频道或与某玩家的私聊消息（v51，仅玩家连接） */
  CHAT_HISTORY: 66,
  /** C→S 聊天：发送文字（表情写在文字里）/ 卡片（v51，仅玩家连接；世界频道需主城官府 ≥ 3 级） */
  CHAT_SEND: 67,
  /** C→S 聊天：私聊会话列表、未读数与屏蔽名单（v51，仅玩家连接） */
  CHAT_CONVERSATIONS: 68,
  /** C→S 聊天：把与某玩家的私聊标记为已读（v51，仅玩家连接） */
  CHAT_READ: 69,
  /** C→S 聊天：屏蔽 / 取消屏蔽某个玩家（v51，仅玩家连接） */
  CHAT_BLOCK: 70,
  /** C→S 聊天：打开一条战报卡片的详情（v51，仅玩家连接） */
  CHAT_REPORT_DETAIL: 71,
  /** C→S 发起农场建造（兼容入口：等价于 BUILD 且 kind='farm'） */
  BUILD_FARM: 20,
  /** S→C 推送：农场建造状态变化（进入建造 / 完成） */
  PUSH_BUILD_STATE: 2000,
  /** S→C 推送：Agent 连接上线 / 离线 */
  PUSH_AGENT_STATUS: 2001,
  /** S→C 推送：城池级状态变化（改名；v7） */
  PUSH_CITY_STATE: 2002,
  /** S→C 推送：Agent 计划更新（v10） */
  PUSH_AGENT_PLAN: 2003,
  /** S→C 推送：征兵状态变化（开始/排队/完成/取消；v11） */
  PUSH_RECRUIT_STATE: 2004,
  /** S→C 推送：行军状态变化（出征/到达结算/返程回城；v12） */
  PUSH_MARCH_STATE: 2005,
  /** S→C 推送：地块归属 / 驻军变化（占领、失守、NPC 城易主等；v12） */
  PUSH_TILE_STATE: 2006,
  /** S→C 推送：战斗战报生成（v13；攻方或守方账号收到） */
  PUSH_BATTLE_REPORT: 2007,
  // PUSH_AGENT_DIRECTIVE（op 2008，作战方针变更推送）已随 v49 移除（与 SET_AGENT_DIRECTIVE 同期下线）。
  /** S→C 推送：战报点评写入（v23，AISLG-53；账号全部在线连接收到） */
  PUSH_BATTLE_REPORT_COMMENT: 2009,
  /** S→C 推送：NPC 袭击预警（v23，AISLG-57；被袭击账号全部在线连接收到，含 Agent） */
  PUSH_NPC_ATTACK_WARNING: 2010,
  /** S→C 推送：全服播报（v23，AISLG-60；全部在线连接收到） */
  PUSH_SERVER_BROADCAST: 2011,
  /** S→C 推送：科技研究状态变化（v27，AISLG-77；发起 / 完成 / 取消，账号全部在线连接收到） */
  PUSH_TECH_STATE: 2012,
  /** S→C 推送：移动目标刷出 / 被截获 / 过时消失（v28，AISLG-78；全部在线连接收到） */
  PUSH_MOVING_TARGET_STATE: 2013,
  /** S→C 推送：黄巾之乱起事 / 进度变化 / 老巢出现 / 收场（v29，AISLG-76；全部在线连接收到） */
  PUSH_YELLOW_TURBAN_STATE: 2014,
  /** S→C 推送：断粮预警 / 断粮哗变（v34，AISLG-107；被影响账号的全部在线连接收到，含 Agent） */
  PUSH_STARVATION_STATE: 2015,
  /** S→C 推送：武将状态变化（v36，AISLG-114/115/116：招募 / 解雇 / 城守 / 欠饷 / 重伤 / 经验 / 名将） */
  PUSH_HERO_STATE: 2016,
  /** S→C 推送：玩家部队来袭预警（v38，AISLG-122；被袭击账号全部在线连接收到，含 Agent） */
  PUSH_ATTACK_WARNING: 2017,
  /** S→C 推送：微信扫码登录 / 绑定的状态变化（v43：scanned / confirmed / canceled / expired；只推给生成二维码的网页连接） */
  PUSH_WX_QR_STATUS: 2018,
  /** S→C 推送：聊天新消息（v51；世界频道按屏蔽关系过滤，私聊推给双方的玩家连接；Agent 连接不收） */
  PUSH_CHAT_MESSAGE: 2019,
} as const;

export type Op = (typeof Op)[keyof typeof Op];

/** PUSH_NPC_ATTACK_WARNING（op 2010）推送载荷（v23，AISLG-57）：预警提前量 = NPC
 *  袭击基准间隔的 1/8（随 timeScale 缩放）；armyMin/armyMax 为大致兵力范围（编成
 *  总单位数 ±20% 取整），不给精确编成 */
/** 错误码。补充新错误码时同步 backend/README.md。 */
export const ErrorCode = {
  /** 消息不是合法的协议帧（非 JSON / 缺少 op 等） */
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  /** 协议号不存在 */
  UNKNOWN_OP: 'UNKNOWN_OP',
  /** 登录前只允许发送 LOGIN */
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  /** 已登录连接重复发送 LOGIN */
  ALREADY_LOGGED_IN: 'ALREADY_LOGGED_IN',
  /** 请求参数缺失或格式不对 */
  INVALID_PARAMS: 'INVALID_PARAMS',
  /** 用户名已存在且密码不正确 */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  /** 密码登录的用户名不存在：密码通道已关闭自动注册（v48），新账号只能经第三方登录（Google / GitHub / 微信扫码）创建 */
  SIGNUP_CLOSED: 'SIGNUP_CLOSED',
  // USERNAME_TAKEN（并发同名注册时后提交方的错误码）已随 v48 密码首登注册的关闭移除：
  // 注册不再走密码通道，该错误码不会再出现。
  // AGENT_ACCOUNT_NOT_FOUND（v43 账号不存在时拒 Agent 登录）已随 v47 移除：
  // Agent 一律禁用账号密码登录（AGENT_PASSWORD_FORBIDDEN），不再走到「查账号」那一步。
  /** Agent 不允许用账号密码登录（v47，AISLG-130）：只能用永久令牌（玩家「复制给 AI」的提示词里带） */
  AGENT_PASSWORD_FORBIDDEN: 'AGENT_PASSWORD_FORBIDDEN',
  /** 该站点关闭了账号密码登录（v47，AISLG-130：国际站只有 Google / GitHub；按连接的 Host 判定） */
  PASSWORD_LOGIN_CLOSED: 'PASSWORD_LOGIN_CLOSED',
  /** 会话令牌登录时令牌无效或已过期（不存在、被吊销或超期） */
  SESSION_INVALID: 'SESSION_INVALID',
  /** 资源不足以支付建造 */
  INSUFFICIENT_RESOURCES: 'INSUFFICIENT_RESOURCES',
  /** 已有在建建筑（v4 起建造改为排队制，该错误码保留但不再由 BUILD 返回） */
  BUILD_IN_PROGRESS: 'BUILD_IN_PROGRESS',
  /** 建造队列已满（1 在建 + 排队上限），等队首完成后重试 */
  QUEUE_FULL: 'QUEUE_FULL',
  /** 该类型建筑已建成，或已在建造/升级队列中（v5：每种建筑同城唯一） */
  BUILDING_EXISTS: 'BUILDING_EXISTS',
  /** 该类型尚未建造，不能升级（v5） */
  BUILDING_NOT_BUILT: 'BUILDING_NOT_BUILT',
  /** 建筑已达等级上限（v5） */
  BUILDING_LEVEL_MAX: 'BUILDING_LEVEL_MAX',
  /** 目标建造不存在、不属于本账号或不在排队状态（v7：仅排队条目可取消，在建可否取消待定） */
  BUILD_NOT_CANCELLABLE: 'BUILD_NOT_CANCELLABLE',
  /** 协议对连接声明的登录类型有限制（基于自报 role，非安全边界）：RESET_ACCOUNT 仅玩家、AGENT_REPORT_PLAN 仅 Agent（v9/v10） */
  AGENT_FORBIDDEN: 'AGENT_FORBIDDEN',
  /** 该兵种需要更高等级的军营（v11；未建军营同样返回） */
  TROOP_NOT_AVAILABLE: 'TROOP_NOT_AVAILABLE',
  /** 人口不足以征募该数量（v11） */
  INSUFFICIENT_POPULATION: 'INSUFFICIENT_POPULATION',
  /** 征兵队列已满（1 征募中 + 排队上限，占位数值；v11） */
  RECRUIT_QUEUE_FULL: 'RECRUIT_QUEUE_FULL',
  /** 目标征兵不存在、不属于本账号或不在排队状态（v11：仅排队条目可取消，征募中能否取消待定） */
  RECRUIT_NOT_CANCELLABLE: 'RECRUIT_NOT_CANCELLABLE',
  /** 出征目标不可攻击（v12：地图外 / 玩家城池 / 他人占领的地块——玩家对抗随后续阶段开放） */
  TARGET_NOT_ATTACKABLE: 'TARGET_NOT_ATTACKABLE',
  /** 城内兵力不足以派出该编队（v12） */
  INSUFFICIENT_TROOPS: 'INSUFFICIENT_TROOPS',
  /** 该地块未被本账号占领，无法召回驻军（v12） */
  TILE_NOT_OCCUPIED: 'TILE_NOT_OCCUPIED',
  /** 行军不存在、不属于本账号、不在行军中或已是返程，无法撤回（v13） */
  MARCH_NOT_RECALLABLE: 'MARCH_NOT_RECALLABLE',
  /** 目标地块处于 24 小时掠夺冷却中（v16：成功掠夺过，在途到达仍战斗但资源为零） */
  PLUNDER_COOLDOWN: 'PLUNDER_COOLDOWN',
  /** 该任务类型不适用于此目标（v16：NPC 城池仅支持掠夺 task='plunder'） */
  TASK_INVALID_FOR_TARGET: 'TASK_INVALID_FOR_TARGET',
  /** 占领野地数已达官府等级上限（v16：上限 = 官府等级；到达结算同样复核） */
  TERRITORY_LIMIT: 'TERRITORY_LIMIT',
  /** 占领 NPC 城需要主城官府 ≥ 3 级（v24，AISLG-58） */
  GOVERNMENT_TOO_LOW: 'GOVERNMENT_TOO_LOW',
  /** 分城数已达上限 = floor(主城官府等级 ÷ 3)（v24，AISLG-58；到达结算同样复核） */
  BRANCH_LIMIT: 'BRANCH_LIMIT',
  /** 目标 NPC 城等级高于出发城的官府等级（v24，AISLG-58） */
  TARGET_LEVEL_TOO_HIGH: 'TARGET_LEVEL_TOO_HIGH',
  /** 名城外围未清空，不能攻城守 / 占领（v24，AISLG-56）：先出征清理外围 */
  OUTER_NOT_CLEARED: 'OUTER_NOT_CLEARED',
  /** 运输货物总量超过所派编队的负重（v26，AISLG-79） */
  CARGO_OVER_CAPACITY: 'CARGO_OVER_CAPACITY',
  /** 该科技已满级（v27，AISLG-77） */
  TECH_LEVEL_MAX: 'TECH_LEVEL_MAX',
  /** 账号已有进行中的研究，同一时间只能研究一项（v27，AISLG-77） */
  RESEARCH_IN_PROGRESS: 'RESEARCH_IN_PROGRESS',
  /** 发起研究的城书院等级低于目标等级（v27，AISLG-77：第 N 级要求书院 ≥ N 级，未建书院按 0） */
  ACADEMY_TOO_LOW: 'ACADEMY_TOO_LOW',
  /** 没有可取消的研究，或研究不属于本账号 / 已结束（v27，AISLG-77） */
  RESEARCH_NOT_CANCELLABLE: 'RESEARCH_NOT_CANCELLABLE',
  /** 本城同时在外的部队数已达校场等级上限（v30，AISLG-80；未建校场按 1，计入行军 / 返程 / 驻守野地，不计城内驻军） */
  DEPLOY_LIMIT: 'DEPLOY_LIMIT',
  /** 截击的移动目标不存在 / 已被击败 / 已过时消失（v28，AISLG-78；到达时目标已消失按「目标消失」战报处理，不报错） */
  MOVING_TARGET_GONE: 'MOVING_TARGET_GONE',
  /** 该城未建酒馆（v36，AISLG-114；招募与候选刷新都要求酒馆） */
  TAVERN_NOT_BUILT: 'TAVERN_NOT_BUILT',
  /** 招募候选不存在 / 已被刷新掉 / 不属于本账号的城（v36，AISLG-114） */
  HERO_CANDIDATE_GONE: 'HERO_CANDIDATE_GONE',
  /** 普通将数量已达上限 = ⌈酒馆最高等级 ÷ 2⌉ + 1（v36，AISLG-114） */
  HERO_CAP_REACHED: 'HERO_CAP_REACHED',
  /** 武将不存在 / 不属于本账号（v36，AISLG-114） */
  HERO_NOT_FOUND: 'HERO_NOT_FOUND',
  /** 武将正在行军中（随队未归），不能出征 / 解雇 / 任城守（v36，AISLG-114） */
  HERO_BUSY: 'HERO_BUSY',
  /** 武将重伤中，不能出征（v36，AISLG-114；带队战败重伤 2 小时基准） */
  HERO_WOUNDED: 'HERO_WOUNDED',
  /** 武将欠饷中，不能出征（v36，AISLG-114；俸禄扣款成功后自动恢复） */
  HERO_ARREARS: 'HERO_ARREARS',
  /** 城守只能任命本账号、未随行出征的武将（v36，AISLG-115） */
  GUARD_ASSIGN_DENIED: 'GUARD_ASSIGN_DENIED',
  /** 目标玩家处于新手保护期（v38，AISLG-122：注册后 3 天或官府 5 级先到为准；不能被侦察 / 攻击），
   *  响应附 until 与 retryAfterSeconds */
  NEWBIE_PROTECTED: 'NEWBIE_PROTECTED',
  /** 目标处于免战期（v38，AISLG-122：被打后免战或主动免战；玩家与 NPC 都不能再打），响应附 until 与 retryAfterSeconds */
  TARGET_IN_TRUCE: 'TARGET_IN_TRUCE',
  /** 自己的主动免战生效中，不能出兵攻打玩家（v38，AISLG-122；打野地 / NPC 不受影响），响应附 until */
  SELF_TRUCE_ACTIVE: 'SELF_TRUCE_ACTIVE',
  /** 主动免战已在生效中（v38，AISLG-122；TRUCE 重复开启），响应附 until */
  TRUCE_ALREADY_ACTIVE: 'TRUCE_ALREADY_ACTIVE',
  /** 本周主动免战已用过（v38，AISLG-122；每周一次），响应附 nextAvailableAt 与 retryAfterSeconds */
  TRUCE_WEEKLY_USED: 'TRUCE_WEEKLY_USED',
  /** 该野地刚换主人，处于保护期（v39，AISLG-123：被抢占后 1 小时基准随缩放，期间玩家与 NPC 都不能再抢），
   *  响应附 until 与 retryAfterSeconds */
  TILE_PROTECTED: 'TILE_PROTECTED',
  /** 微信 ticket 不存在、已过期、已被扫 / 已用过，或确认方不是扫码的那条连接（v43） */
  WX_TICKET_INVALID: 'WX_TICKET_INVALID',
  /** 微信 jscode2session 换 openid 失败：code 过期或已被使用（v43） */
  WX_CODE_INVALID: 'WX_CODE_INVALID',
  /** 绑定微信时，该微信已绑了别的账号，或当前账号已绑了别的微信（v43） */
  WX_ALREADY_BOUND: 'WX_ALREADY_BOUND',
  /** 微信接口调用失败，或服务端没配置微信小游戏 AppID / AppSecret（v43） */
  WX_UNAVAILABLE: 'WX_UNAVAILABLE',
  /** Google 登录暂不可用：服务端没配置 Client ID，或连不上 Google 公钥服务（v44） */
  GOOGLE_UNAVAILABLE: 'GOOGLE_UNAVAILABLE',
  /** Google 登录凭证（ID Token）无效：伪造、过期、签名不对或不是发给本应用的（v44） */
  GOOGLE_CREDENTIAL_INVALID: 'GOOGLE_CREDENTIAL_INVALID',
  /** 绑定 Google 时，该 Google 账号已绑了别的号，或当前账号已绑了别的 Google 账号（v44） */
  GOOGLE_ALREADY_BOUND: 'GOOGLE_ALREADY_BOUND',
  /** GitHub 登录暂不可用：服务端没配置 GitHub OAuth App 凭证，或调 GitHub 接口失败（v45） */
  GITHUB_UNAVAILABLE: 'GITHUB_UNAVAILABLE',
  /** 一次性登录码无效 / 已过期 / 已被使用（v45：OAUTH_REDEEM 的 code 只能用一次，60 秒有效） */
  OAUTH_CODE_INVALID: 'OAUTH_CODE_INVALID',
  /** 绑定 GitHub 时，该 GitHub 账号已绑了别的号，或当前账号已绑了别的 GitHub 账号（v45） */
  GITHUB_ALREADY_BOUND: 'GITHUB_ALREADY_BOUND',
  /** 请求过于频繁（v43：二维码生成 / Google 登录尝试 / GitHub 授权发起均按 IP 限频，20 次/分钟） */
  RATE_LIMITED: 'RATE_LIMITED',
  // AGENT_TOKEN_LIMIT（v43，多令牌上限）已随 v46 移除：每账号一个永久令牌，无上限概念。
  /** 聊天：主城官府未达世界频道发言门槛（v51，官府 ≥ 3 级） */
  CHAT_GOVERNMENT_TOO_LOW: 'CHAT_GOVERNMENT_TOO_LOW',
  /** 聊天：账号被运营禁言（v51），响应附 until */
  CHAT_MUTED: 'CHAT_MUTED',
  /** 聊天：对方已屏蔽你，不能发私聊（v51） */
  CHAT_BLOCKED: 'CHAT_BLOCKED',
  /** 聊天：同一频道发言过快（v51，每 10 秒一条），响应附 retryAfterSeconds */
  CHAT_RATE_LIMITED: 'CHAT_RATE_LIMITED',
  /** 服务端内部错误 */
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * 声明式登录类型：由连接在登录时自行声明并绑定到连接，
 * 不是可独立验证的两个身份（见 docs/phase-1-mvp.md「身份边界」）。
 */
export type InitiatorRole = 'player' | 'agent';

export function isInitiatorRole(value: unknown): value is InitiatorRole {
  return value === 'player' || value === 'agent';
}

export interface Resources {
  gold: number;
  wood: number;
  food: number;
  stone: number;
  iron: number;
}

/** Resources 的全部字段（遍历成本 / 校验时使用，勿用 Object.keys 于具体对象） */
export const RESOURCE_KEYS = ['gold', 'wood', 'food', 'stone', 'iron'] as const;

/**
 * 第一期可建造的建筑类型（docs/phase-1-launch-scope.md「城池、建筑与经济」，每种同城限一座）：
 * 四种资源生产建筑 + 民房 / 官府 / 军营 / 仓库 / 城墙；v27（AISLG-77）起加书院（科技研究）；v30（AISLG-80~83）起加校场 / 烽火台 / 驿站 / 箭塔。数值与成本见 common/src/rules.ts 的 BUILDING_INFO。
 */
export const BUILDING_KINDS = [
  'farm',
  'lumber_mill',
  'quarry',
  'iron_mine',
  'house',
  'government',
  'barracks',
  'warehouse',
  'wall',
  'academy',
  'parade_ground',
  'beacon',
  'post_station',
  'arrow_tower',
  'tavern',
] as const;

export type BuildingKind = (typeof BUILDING_KINDS)[number];

export function isBuildingKind(value: unknown): value is BuildingKind {
  return typeof value === 'string' && (BUILDING_KINDS as readonly string[]).includes(value);
}

/** 按建筑类型统计的当前状态（数量或等级）：单实例规则下数量为 0/1，等级 0 = 未建造 */
export type BuildingCounts = Record<BuildingKind, number>;



// ---- 消息帧 ----

/** 客户端请求帧：op + 可选 seq（服务端原样带回用于关联）+ 可选 data */
export interface ClientFrame {
  op: number;
  seq?: number;
  data?: Record<string, unknown>;
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
}

/** 服务端响应帧：op 与请求一致 */
export interface ResponseFrame {
  op: number;
  seq?: number;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: ErrorBody;
}

/** 服务端推送帧：无 seq，data 按协议号解释。
 *  eventId（v21，AISLG-37）：推送去重键，账号维度单调递增——同一次业务事件
 *  扇出到该账号多连接时各连接收到相同 eventId；客户端记住已见最大 eventId
 *  做幂等去重，跳号提示漏推（转 GET_EVENTS 补拉）。eventId 不等于事件表的
 *  事件 id，两者不可互换使用。 */
export interface PushFrame {
  op: number;
  push: true;
  /** 推送去重键（v21，由服务端在扇出时注入，客户端不必校验存在性——旧推送无此字段） */
  eventId?: number;
  data: Record<string, unknown>;
}

// ---- 各协议的载荷结构 ----

export interface LoginRequestData {
  username: string;
  password: string;
  /** 本次是否以 Agent 身份登录 */
  asAgent: boolean;
  /**
   * 会话令牌登录方式（与 password 互斥）：提供 token 时不校验用户名密码，
   * 账号由服务端从会话解析。用于持久保存令牌后的免密自动登录。
   */
  token?: string;
  /** 可选（v32）：调用方手上 agent-api.md 的协议版本；低于当前版本时 Agent 连接的响应附 docNotice */
  docVersion?: number;
  /**
   * 可选（v50，AISLG-133）：Agent 自报的驱动模型名（如 claude-opus-5-5、gpt-5、自己写的
   * 脚本名），1..64 字符（超长截断）。仅 asAgent=true 时生效并记到账号（以最近一次声明
   * 为准，不填保留上次）；自报不验证，仅用于排行榜展示（标注「自报」）。玩家登录忽略。
   */
  agentModel?: string;
}

export interface LoginResponseData {
  accountId: string;
  username: string;
  role: InitiatorRole;
  /** 会话令牌：密码登录返回新签发的令牌；令牌登录原样返回（已滑动续期） */
  sessionToken: string;
  /** 会话过期时间（ISO 8601）；每次令牌登录成功都会续期 */
  expiresAt: string;
  /** 服务端当前协议版本（v32） */
  protocolVersion: number;
  /** 文档更新提示（v32，仅 Agent 连接；文档已是最新或玩家连接为 null） */
  docNotice: string | null;
}

export interface GetEventsRequestData {
  /** 返回条数上限，1..200，默认 50 */
  limit?: number;
  /** 与 sinceId 二选一：分页游标，返回 id 小于它的最新事件 */
  beforeId?: number;
  /** 与 beforeId 二选一：增量游标，返回 id 大于它的旧→新事件 */
  sinceId?: number;
}

export interface GetAgentInfoResponseData {
  agentOnline: boolean;
  connections: Array<{ role: InitiatorRole; connectedAt: string }>;
  /** Agent 最近一次上报的计划（v10；从未上报为 null） */
  plan: AgentPlanView | null;
  // directive（玩家设置的作战方针快照，v23）已随 v49 移除：方针改为玩家与自己的 Agent 直接讨论。
  recentEvents: EventView[];
  /** 账号是否已绑定 Google（v44；服务端没配置 Google Client ID 时恒为 false） */
  googleBound: boolean;
  /** 账号是否已绑定 GitHub（v45；服务端没配置 GitHub OAuth App 时恒为 false） */
  githubBound: boolean;
  /** 绑定的 GitHub 用户名（v45；未绑定为 null） */
  githubLogin: string | null;
}

/** Agent 计划快照（v10）：自报的展示信息，未经验证、不参与游戏逻辑 */
export interface AgentPlanView {
  /** 下一步动作（Agent 自报；≤200 字符，空为 null） */
  nextAction: string | null;
  /** 整体计划（Agent 自报；≤500 字符，空为 null） */
  overallPlan: string | null;
  /** 最近一次上报时间（ISO 8601） */
  updatedAt: string;
}

export interface AgentStatusPushData {
  online: boolean;
  at: string;
}

/** AGENT_REPORT_PLAN（op 27）请求载荷：两段都可只更新其一；提供空串表示清除该段 */
export interface AgentReportPlanRequestData {
  /** 下一步动作，trim 后 0..200 字符（空串 = 清除；缺省 = 保持不变） */
  nextAction?: string;
  /** 整体计划，trim 后 0..500 字符（空串 = 清除；缺省 = 保持不变） */
  overallPlan?: string;
}

export interface AgentReportPlanResponseData {
  /** 更新后的计划快照（与 GET_AGENT_INFO 的 plan、PUSH_AGENT_PLAN 的 data 同构） */
  plan: AgentPlanView;
}

/** PUSH_AGENT_PLAN（op 2003）推送载荷：账号内任一 Agent 连接上报计划后，推给其他在线连接 */
export interface AgentPlanPushData extends AgentPlanView {}

export interface NpcAttackWarningPushData {
  attackId: string;
  x: number;
  y: number;
  /** wilderness = 袭击占领野地；city = 袭击主城 */
  target: 'wilderness' | 'city';
  /** 目标地形（仅野地袭击有值；主城为 null） */
  terrain: string | null;
  /** 袭击强度等级（野地 = 地块等级；主城 = 按守军战力推导的袭击等级） */
  level: number;
  armyMin: number;
  armyMax: number;
  /** 敌情详细度（v31，AISLG-81；由被袭击城的烽火台等级决定）：range 只给总兵力范围 / kinds 另给各兵种范围
   *  armyKinds / exact 另给精确编成 army；缺省视为 range（历史预警） */
  intel?: 'range' | 'kinds' | 'exact';
  /** 被袭击城的烽火台等级（v31；0 = 未建） */
  beaconLevel?: number;
  armyKinds?: Partial<Record<import('./protocol-army').TroopKind, { min: number; max: number }>>;
  army?: Partial<Record<import('./protocol-army').TroopKind, number>>;
  /** 预计到达时刻（ISO 8601；随 timeScale 缩放后的实际结算时刻） */
  arriveAt: string;
}

export type { ArmyCounts, RecruitView, TroopKind } from './protocol-army';
export { TROOP_KINDS, isTroopKind } from './protocol-army';
import type { ArmyCounts, RecruitView } from './protocol-army';
export type {
  TerrainKind,
  TerrainResource,
  TileKind,
  TileView,
  TileDetailView,
  TileOwnerView,
  TerritoryView,
  MarchView,
  WorldMapRequestData,
  WorldMapResponseData,
  GetTileRequestData,
  GetTileResponseData,
  MarchRequestData,
  MarchResponseData,
  RecallGarrisonRequestData,
  RecallGarrisonResponseData,
  MarchStatePushData,
  TileStatePushData,
  FamousTileView,
  NpcStockTier,
} from './protocol-world';
export { TERRAIN_KINDS, isTerrainKind, TILE_KINDS } from './protocol-world';
export type {
  BattleReportView,
  BattleReportCommentView,
  BattleRoundLogEntryView,
  BattleSideView,
  ScoutRequestData,
  ScoutResponseData,
  RecallMarchRequestData,
  RecallMarchResponseData,
  GetBattleReportsRequestData,
  GetBattleReportsResponseData,
  BattleReportPushData,
  AgentCommentReportRequestData,
  AgentCommentReportResponseData,
  BattleReportCommentPushData,
  ScoutIntel,
} from './protocol-battle';
export { MARCH_PURPOSES, isMarchPurpose, MARCH_TASKS, isMarchTask } from './protocol-battle';
export type { MarchPurpose, MarchTask } from './protocol-battle';
import type { MarchView, TerritoryView } from './protocol-world';

// 城池操作（建造 / 升级 / 取消 / 改名 / 重置 / 城池推送）的载荷类型在 protocol-city.ts；
// Agent 协作（日报 / 离线汇总）在 protocol-agent.ts；全服维度（播报 / 排行榜）
// 在 protocol-server.ts——原名再导出，既有 import 路径不变
export type {
  AgentDailyReportView,
  OfflineDigestView,
  GetOfflineReportResponseData,
  AgentDailyReportRequestData,
  AgentDailyReportResponseData,
} from './protocol-agent';
export type {
  ServerBroadcastType,
  ServerBroadcastView,
  GetServerBroadcastsRequestData,
  GetServerBroadcastsResponseData,
  ServerBroadcastPushData,
  LeaderboardKind,
  LeaderboardEntryView,
  ModelLeaderboardEntryView,
  GetLeaderboardResponseData,
} from './protocol-server';
export { SERVER_BROADCAST_TYPES, isServerBroadcastType, LEADERBOARD_KINDS, isLeaderboardKind } from './protocol-server';
export type {
  BuildRequestData,
  UpgradeRequestData,
  BuildResponseData,
  BuildFarmResponseData,
  BuildStatePushData,
  CancelBuildRequestData,
  CancelBuildResponseData,
  RenameCityRequestData,
  RenameCityResponseData,
  CityStatePushData,
  ResetAccountRequestData,
  ResetAccountResponseData,
} from './protocol-city';

// 黄巾之乱（v29，AISLG-76）的载荷类型在 protocol-yt.ts，规则与数值在 yellow-turban.ts
export type {
  YtTileCampView,
  YtCampView,
  YtEventView,
  YtContributionView,
  YtRewardTierView,
  GetYellowTurbanResponseData,
  YellowTurbanPushData,
} from './protocol-yt';
export { YT_TIERS, isYtTier } from './yellow-turban';
export type { YtTier } from './yellow-turban';

// 移动目标（v28，AISLG-78）的载荷类型在 protocol-moving.ts，规则与数值在 moving-target.ts
export type { MovingTargetView, GetMovingTargetsResponseData, MovingTargetPushData } from './protocol-moving';
export { MOVING_KINDS, isMovingKind } from './moving-target';
export type {
  HeroView,
  HeroCandidateView,
  FamousClaimView,
  HeroStateView,
  GetHeroesRequestData,
  GetHeroesResponseData,
  RecruitHeroRequestData,
  RecruitHeroResponseData,
  DismissHeroRequestData,
  DismissHeroResponseData,
  AssignHeroRequestData,
  AssignHeroResponseData,
  HeroStatePushData,
} from './protocol-hero';
export type { MovingKind } from './moving-target';

// 玩家对抗（一）（v38，AISLG-122）的载荷类型在 protocol-pvp.ts，规则与数值在 protection.ts
export type {
  PlayerAttackWarningPushData,
  TruceRequestData,
  TruceResponseData,
  TileProtectionView,
} from './protocol-pvp';

// 科技研究（v27，AISLG-77）的载荷类型在 protocol-tech.ts，规则与数值在 tech.ts
export type {
  TechEntryView,
  ResearchView,
  GetTechsRequestData,
  GetTechsResponseData,
  TechStateView,
  ResearchTechRequestData,
  ResearchTechResponseData,
  CancelResearchRequestData,
  CancelResearchResponseData,
  TechStatePushData,
} from './protocol-tech';
export { TECH_KINDS, isTechKind } from './tech';
export type { TechKind, TechLevels } from './tech';

// 城池 / 事件 / 建造 / 生产的视图类型（v7..v12 既有形态）同样拆在 protocol-city.ts
export type {
  KindActionCosts,
  ProductionRates,
  PopulationView,
  StorageCaps,
  BuildView,
  CityView,
  EventView,
} from './protocol-city';
export { EventType } from './protocol-city';
