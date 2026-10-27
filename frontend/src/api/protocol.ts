// 协议常量与消息形状：镜像自后端契约。唯一事实来源是 backend/common/src/protocol.ts，
// 对外文档为 docs/agent-api.md；协议调整时以后端生成文档为准同步本文件。

import type { CityGuardView } from './protocol-hero';

export const PROTOCOL_VERSION = 78;

/** 协议号（请求与响应用同一值，推送以 op 区分类型） */
export const Op = {
  LOGIN: 1,
  LOGOUT: 2,
  GET_STATE: 10,
  GET_EVENTS: 11,
  GET_AGENT_INFO: 12,
  /** 兼容入口：等价于 BUILD 且 kind='farm'；前端统一走 BUILD */
  BUILD_FARM: 20,
  BUILD: 21,
  /** 发起建筑升级（升到下一等级，v5，与建造共用队列） */
  UPGRADE: 22,
  /** 取消建造队列中的条目（v7 排队可取消，v71 起建造中也可取消）：全额返还已扣成本（连升只退未完成级）；已完成 / 已取消返回 BUILD_NOT_CANCELLABLE */
  CANCEL_BUILD: 24,
  /** 城池改名（v7） */
  RENAME_CITY: 25,
  /** 一键重置账号数据（v9）：data.confirm 必须显式为 true；仅限玩家连接（Agent 返回 AGENT_FORBIDDEN） */
  RESET_ACCOUNT: 26,
  /** Agent 上报计划（v10）：data.nextAction / data.overallPlan；仅限 Agent 连接（玩家返回 AGENT_FORBIDDEN） */
  AGENT_REPORT_PLAN: 27,
  /** 发起征兵（v11）：data.troop 兵种 + data.count 数量；军营等级解锁兵种，发起时扣减资源与人口 */
  RECRUIT: 28,
  /** 取消征兵队列中的排队条目（v11）：data.recruitId；全额返还资源与人口，征募中不可取消 */
  CANCEL_RECRUIT: 29,
  /** 查询世界地图窗口（v12）：data.x/y/w/h 可选，缺省以主城为中心 10×10 */
  GET_WORLD_MAP: 30,
  /** 查询地块详情（v12）：data.x + data.y */
  GET_TILE: 31,
  /** 出征（v12）：data.x/y 目标 + data.troops 按兵种数量；到达由服务端结算 */
  MARCH: 32,
  /** 撤回占领野地的驻军（v12）：data.x + data.y；撤回即放弃占领 */
  RECALL_GARRISON: 33,
  /** 斥候侦察（v13）：data.x/y + data.count；到达产出情报快照并返程 */
  SCOUT: 34,
  /** 撤回行军途中的部队（v13）：data.marchId；原地折返、按已走时长返程 */
  RECALL_MARCH: 35,
  /** 查询战斗战报（v13）：data.limit / beforeId */
  GET_BATTLE_REPORTS: 36,
  /** 集市兑换（v22）：data.resource 四选一 + data.amount */
  EXCHANGE: 37,
  // SET_AGENT_DIRECTIVE（op 38，作战方针）已随协议 v49 移除：玩家改与自己的 Agent 直接讨论
  /** Agent 写回战报点评（v23 AISLG-53）：data.reportId + data.text；仅 Agent 连接 */
  AGENT_COMMENT_REPORT: 39,
  /** Agent 写离线日报（v23 AISLG-54）：data.text；仅 Agent 连接 */
  AGENT_DAILY_REPORT: 40,
  /** 查询离线日报（v23 AISLG-54）：离线时长、收获/损失汇总与 Agent 最近日报 */
  GET_OFFLINE_REPORT: 41,
  /** 查询全服播报（v23 AISLG-60）：最近的大事列表，新→旧 */
  GET_SERVER_BROADCASTS: 42,
  /** 查询全服排行榜（v23 AISLG-61）：三榜快照，前 50 名 + 我的名次 */
  GET_LEADERBOARD: 43,
  /** 查询科技状态（v27 AISLG-77；v72 AISLG-192 起 16 项）：等级 / 下一级成本与耗时 / 进行中的研究 */
  GET_TECHS: 44,
  /** 发起科技研究（v27 AISLG-77）：data.tech；账号同一时间只研究一项，需书院 */
  RESEARCH_TECH: 45,
  /** 取消进行中的研究（v27 AISLG-77）：全额返还 */
  CANCEL_RESEARCH: 46,
  /** 查询移动目标（v28 AISLG-78）：流寇与运粮商队的当前位置、公开路线与时刻表 */
  GET_MOVING_TARGETS: 47,
  /** 查询黄巾之乱（v29 AISLG-76）：事件进度 / 营地与老巢 / 我的贡献与名次 / 贡献榜 */
  GET_YELLOW_TURBAN: 48,
  /** 查询武将（v36 AISLG-114）：账号全部武将 / 当前城酒馆候选 / 上限 / 名将归属 */
  GET_HEROES: 49,
  /** 招募酒馆候选武将（v36）：data.candidateId；扣酒馆所在城金币 */
  RECRUIT_HERO: 50,
  /** 解雇武将（v36）：data.heroId；名将解雇后回到全服可获得状态 */
  DISMISS_HERO: 51,
  /** 任命 / 撤换城守（v36 AISLG-115）：data.heroId（null = 撤任）+ 可选 data.cityId */
  ASSIGN_HERO: 52,
  /** 开启主动免战（v38 AISLG-122）：无参数；每周一次免费、12 小时，期内别人打不了他、他也不能出兵打玩家 */
  TRUCE: 53,
  /** 生成微信扫码二维码（v43）：data.purpose = login | bind；login 登录前即可发，bind 需玩家已登录 */
  WX_QR_CREATE: 54,
  /** 微信小游戏扫码上报（v43）：data.ticket + data.code；登录前即可发，仅供微信小游戏 */
  WX_SCAN: 55,
  /** 微信小游戏确认登录 / 绑定（v43）：data.ticket；只接受扫码的那条连接，仅供微信小游戏 */
  WX_CONFIRM: 56,
  /** 微信小游戏取消登录 / 绑定（v43）：data.ticket；只接受扫码的那条连接，仅供微信小游戏 */
  WX_CANCEL: 57,
  /** 查看本账号永久 Agent 令牌（v46）：仅玩家连接，没有时自动补生成 */
  GET_AGENT_TOKEN: 64,
  /** 重置永久 Agent 令牌（v46）：仅玩家连接，旧令牌立即失效、用它在线的连接被断开 */
  RESET_AGENT_TOKEN: 65,
  /** 聊天（v51）：消息查询 / 发送 / 私聊会话与未读 / 已读 / 屏蔽 / 战报卡片详情（仅玩家连接） */
  CHAT_HISTORY: 66,
  CHAT_SEND: 67,
  CHAT_CONVERSATIONS: 68,
  CHAT_READ: 69,
  CHAT_BLOCK: 70,
  CHAT_REPORT_DETAIL: 71,
  /** 修改账号昵称（v52，AISLG-142）：data.nickname；仅玩家连接；昵称即账号 username，全服唯一（NICKNAME_TAKEN） */
  SET_NICKNAME: 72,
  /** 查询竞技场（v53，AISLG-145） */
  GET_ARENA: 73,
  /** 保存竞技场阵容（v53，AISLG-145）：第一次保存即入榜 */
  SET_ARENA_LINEUP: 74,
  /** 发起竞技挑战（v53，AISLG-145）：三局两胜，赢了互换名次 */
  ARENA_CHALLENGE: 75,
  /** 查询竞技场战报（v53，AISLG-145） */
  GET_ARENA_REPORTS: 76,
  /** 分配自由点数（v54，AISLG-144） */
  ALLOCATE_HERO_POINTS: 77,
  /** 洗点（v54，AISLG-144） */
  RESET_HERO_POINTS: 78,
  /** 派武将历练（v54，AISLG-144） */
  TRAIN_HERO: 79,
  /** 赏赐武将（v54，AISLG-144） */
  GIFT_HERO: 80,
  /** 结交在野名将（v54，AISLG-144） */
  BEFRIEND_HERO: 81,
  /** 招揽在野名将（v54，AISLG-144） */
  RECRUIT_FAMOUS_HERO: 82,
  /** 查询日常任务与签到状态（v56，AISLG-200）：data.quest */
  GET_DAILY: 86,
  /** 领取日常任务奖励（v56）：data.taskId；任务未完成 / 重复领取返回 INVALID_PARAMS */
  CLAIM_DAILY: 87,
  /** 查询签到状态（v56） */
  GET_SIGNIN: 88,
  /** 每日签到（v56）：每天一次，连续 7 天一轮循环；当日重复签到返回 INVALID_PARAMS */
  SIGNIN: 89,
  /** 查询主线/支线任务与成就（v56，AISLG-200 二期） */
  GET_QUESTS: 90,
  /** 领取任务/成就奖励（v56）：data.kind=main|side|achv, data.id */
  CLAIM_QUEST: 91,
  /** 查询活动状态（v56，AISLG-200 三期） */
  GET_ACTIVITIES: 92,
  /** 领取活动奖励（v56）：data.id = 阶梯 id */
  CLAIM_ACTIVITY: 93,
  /** C→S 放弃分城（v57，AISLG-153：data.cityId 必填、data.confirm 须为 true；主城不可放弃） */
  DISCARD_CITY: 94,
  /** 世界小地图总览（v58，AISLG-160）：全图城池点位，玩家与 Agent 通用 */
  GET_MAP_OVERVIEW: 95,
  /** 查询赛季（v65，AISLG-134）：当前赛季 / 维护态 / 我的荣誉 / 是否已加入本赛季；维护期间仍可用 */
  GET_SEASON: 99,
  /** 查询名人堂（v65，AISLG-134）：某赛季各榜前列与模型榜，分页；缺省最近一个已结束赛季 */
  GET_HALL_OF_FAME: 100,
  GET_ANNOUNCEMENTS: 96,
  GET_ANNOUNCEMENT: 97,
  READ_ANNOUNCEMENT: 98,
  /** 创建联盟（v66，AISLG-181）：data.name；官府 ≥ 5 级、扣 10 万金币；仅玩家连接 */
  CREATE_ALLIANCE: 101,
  /** 查询联盟（v66）：缺省 = 我的联盟（含我的申请 / 邀请，盟主 / 副盟主另带待审批申请）；给 allianceId = 公开信息 */
  GET_ALLIANCE: 102,
  /** 联盟列表（v66）：按成员数降序分页 */
  LIST_ALLIANCES: 103,
  /** 申请加入联盟 / 撤回申请（v66，仅玩家连接） */
  ALLIANCE_APPLY: 104,
  /** 邀请玩家入盟 / 撤回邀请（v66，盟主或副盟主；仅玩家连接） */
  ALLIANCE_INVITE: 105,
  /** 答复申请或邀请（v66；仅玩家连接） */
  ALLIANCE_RESPOND: 106,
  /** 退出联盟（v66；盟主有其他成员时须先转让；仅玩家连接） */
  ALLIANCE_LEAVE: 107,
  /** 解散联盟（v66；仅盟主） */
  ALLIANCE_DISBAND: 108,
  /** 踢出成员（v66；立即生效；副盟主只能踢普通成员） */
  ALLIANCE_KICK: 109,
  /** 任免副盟主 / 转让盟主（v66；仅盟主） */
  ALLIANCE_SET_ROLE: 110,
  /** 修改联盟公告（v66；盟主或副盟主） */
  ALLIANCE_SET_NOTICE: 111,
  /** 放置联盟地图标记（v69，AISLG-184）：data.x / y / kind，可选 text；同联盟同格不可重复、最多 20 个；玩家与 Agent 通用 */
  ALLIANCE_MARK_ADD: 112,
  /** 删除联盟地图标记（v69，AISLG-184）：data.id；成员只能删自己的，盟主 / 副盟主可删任何人的（仅玩家连接） */
  ALLIANCE_MARK_REMOVE: 113,
  /** 查询本联盟的有效地图标记（v69，AISLG-184） */
  GET_ALLIANCE_MARKS: 114,
  /** 取消进行中的武将历练（v71，AISLG-190）：武将立刻回家，不返还经验 */
  CANCEL_TRAINING: 115,
  /** 提前解除主动免战（v71，AISLG-190）：本周免费次数不返还；被动免战不可解除 */
  CANCEL_TRUCE: 116,
  CRAFT_DEFENSE: 117,
  CANCEL_DEFENSE_CRAFT: 118,
  DISMISS_ASSIST: 119,
  /** 查询剧本战场（v75，AISLG-198）：当前 / 最近一场官渡、据点、我的队伍与军功、军功榜、商店 */
  GET_BATTLEFIELD: 120,
  /** 报名剧本战场（v75）：data.camp = yuan | cao */
  SIGNUP_BATTLEFIELD: 121,
  /** 带部队入场（v75）：data.troops；开战前，按人口最多 3000 */
  ENTER_BATTLEFIELD: 122,
  /** 拆分战场队伍（v75）：data.squadId + troops；每人最多 3 队 */
  SPLIT_BATTLEFIELD_SQUAD: 123,
  /** 战场内行军 / 攻打据点（v75）：data.squadId + strongholdId 或 x / y */
  MARCH_BATTLEFIELD_SQUAD: 124,
  /** 战场商店兑换（v75）：data.item（+ hero_exp 时的 heroId） */
  BUY_BATTLEFIELD_ITEM: 125,
  /** 查询声望与爵位、今日俸禄状态（v76，AISLG-197） */
  GET_NOBILITY: 126,
  /** 领取每日爵位俸禄（v76：北京日每天一次，平民无俸禄） */
  CLAIM_NOBILITY_SALARY: 127,
  ALLIANCE_DIPLOMACY_INVITE: 128,
  ALLIANCE_DIPLOMACY_RESPOND: 129,
  ALLIANCE_DIPLOMACY_END: 130,
  ALLIANCE_DIPLOMACY_HOSTILE: 131,
  GET_ALLIANCE_DIPLOMACY: 132,
  GET_MARKET: 133,
  CREATE_MARKET_ORDER: 134,
  BUY_MARKET_ORDER: 135,
  CANCEL_MARKET_ORDER: 136,
  /** 用 Google ID Token 换会话令牌（v44）：data.credential；登录前可发，仅供网页；第一次自动建号 */
  GOOGLE_LOGIN: 60,
  /** 给当前账号绑定 Google（v44）：data.credential；仅玩家连接，仅供网页 */
  GOOGLE_BIND: 61,
  /** 发起 GitHub 授权（v45）：data.purpose = login | bind；返回 GitHub 授权地址由网页整页跳转 */
  GITHUB_AUTH_START: 62,
  /** 用一次性登录码换会话令牌（v45）：data.code；OAuth 回跳进页面时使用 */
  OAUTH_REDEEM: 63,
  PUSH_BUILD_STATE: 2000,
  PUSH_AGENT_STATUS: 2001,
  /** 城池级状态变化推送（v7；reason：city_renamed，v9 起另有 account_reset；一期不提供建筑拆除） */
  PUSH_CITY_STATE: 2002,
  /** Agent 计划更新推送（v10）：同账号其他在线连接收到完整计划快照 */
  PUSH_AGENT_PLAN: 2003,
  /** 征兵状态变化推送（v11）：开始 / 排队 / 完成（兵力入城）/ 取消 */
  PUSH_RECRUIT_STATE: 2004,
  /** 行军状态变化推送（v12）：出征 / 到达结算 / 返程回城 */
  PUSH_MARCH_STATE: 2005,
  /** 地块归属 / 驻军变化推送（v12）：占领、失守、NPC 城易主等 */
  PUSH_TILE_STATE: 2006,
  /** 战斗战报生成推送（v13）：攻方或守方账号收到 */
  PUSH_BATTLE_REPORT: 2007,
  // PUSH_AGENT_DIRECTIVE（op 2008，作战方针变更推送）已随协议 v49 移除
  /** 战报点评写入推送（v23 AISLG-53）：账号全部在线连接收到 */
  PUSH_BATTLE_REPORT_COMMENT: 2009,
  /** NPC 袭击预警推送（v23 AISLG-57）：被袭击账号全部在线连接收到 */
  PUSH_NPC_ATTACK_WARNING: 2010,
  /** 全服播报推送（v23 AISLG-60）：全部在线连接收到 */
  PUSH_SERVER_BROADCAST: 2011,
  /** 科技研究状态变化推送（v27 AISLG-77）：发起 / 完成 / 取消，账号全部在线连接收到 */
  PUSH_TECH_STATE: 2012,
  /** 移动目标刷出 / 被截获 / 过时消失推送（v28 AISLG-78）：全部在线连接收到 */
  PUSH_MOVING_TARGET_STATE: 2013,
  /** 黄巾之乱起事 / 进度 / 老巢出现 / 收场推送（v29 AISLG-76）：全部在线连接收到 */
  PUSH_YELLOW_TURBAN_STATE: 2014,
  /** 断粮预警 / 哗变推送（v34 AISLG-107）：被影响账号的全部在线连接收到 */
  PUSH_STARVATION_STATE: 2015,
  /** 微信扫码状态变化推送（v43）：scanned / confirmed / canceled / expired，只推给生成二维码的这条连接 */
  PUSH_WX_QR_STATUS: 2018,
  /** 武将状态变化推送（v36）：招募 / 解雇 / 城守变更 / 欠饷 / 重伤 / 经验升级 / 获得名将，账号全部在线连接收到 */
  PUSH_HERO_STATE: 2016,
  /** 玩家部队来袭预警推送（v38 AISLG-122）：被袭击账号全部在线连接收到 */
  PUSH_ATTACK_WARNING: 2017,
  /** 聊天新消息推送（v51）：世界频道 / 私聊，仅推给玩家连接 */
  PUSH_CHAT_MESSAGE: 2019,
  /** 账号级状态变化推送（v52）：account_renamed=昵称被 SET_NICKNAME 修改；账号全部在线连接收到 */
  PUSH_ACCOUNT_STATE: 2020,
  /** 竞技场状态变化推送（v53，AISLG-145）：challenged / daily_reward / milestone，账号全部在线连接收到 */
  PUSH_ARENA_STATE: 2021,
  PUSH_ANNOUNCEMENT: 2022,
  /** 联盟状态变化推送（v66，AISLG-181）：reason = joined / left / kicked / role_changed / disbanded / notice / request_received / request_resolved / invited；收到后重新 GET_ALLIANCE */
  PUSH_ALLIANCE_STATE: 2024,
  /** 联盟地图标记变化推送（v69，AISLG-184）：reason = added / removed */
  PUSH_ALLIANCE_MARK: 2025,
  PUSH_DEFENSE_STATE: 2026,
  /** 剧本战场报名 / 开战 / 据点易手 / 收场（v75，AISLG-198）：全部在线连接收到 */
  PUSH_BATTLEFIELD_STATE: 2027,
  /** 赛季预告 / 换季中 / 新赛季开始（v65，AISLG-134）：全部在线连接收到，含 Agent；started 后服务端断开全部连接 */
  PUSH_SEASON: 2023,
  /** 查询将星塔（v55，AISLG-146） */
  GET_STAR_TOWER: 83,
  /** 挑战将星塔下一层（v55，AISLG-146）：无参数，三局两胜，赢了首通发奖励 */
  STAR_TOWER_CHALLENGE: 84,
  /** 查询将星塔战报（v55，AISLG-146） */
  GET_STAR_TOWER_REPORTS: 85,
} as const;

export type Op = (typeof Op)[keyof typeof Op];

/** 声明式登录类型：连接自行声明的来源标记，不是可独立验证的身份 */
export type InitiatorRole = 'player' | 'agent';

export type ErrorCode =
  | 'INVALID_MESSAGE'
  | 'ANNOUNCEMENT_NOT_FOUND'
  | 'ALLIANCE_NAME_INVALID'
  | 'ALLIANCE_NAME_TAKEN'
  | 'ALLIANCE_GOVERNMENT_TOO_LOW'
  | 'ALLIANCE_ALREADY_IN'
  | 'ALLIANCE_NOT_IN'
  | 'ALLIANCE_NOT_FOUND'
  | 'ALLIANCE_COOLDOWN'
  | 'ALLIANCE_FULL'
  | 'ALLIANCE_FORBIDDEN'
  | 'ALLIANCE_ROLE_FULL'
  | 'ALLIANCE_LEADER_MUST_TRANSFER'
  | 'ALLIANCE_REQUEST_EXISTS'
  | 'UNKNOWN_OP'
  | 'NOT_LOGGED_IN'
  | 'ALREADY_LOGGED_IN'
  | 'INVALID_PARAMS'
  | 'INVALID_CREDENTIALS'
  | 'SIGNUP_CLOSED'
  | 'SESSION_INVALID'
  | 'INSUFFICIENT_RESOURCES'
  | 'BUILD_IN_PROGRESS'
  | 'QUEUE_FULL'
  | 'BUILDING_EXISTS'
  | 'BUILDING_NOT_BUILT'
  | 'BUILDING_LEVEL_MAX'
  | 'BUILD_NOT_CANCELLABLE'
  | 'TRAINING_NOT_CANCELLABLE'
  | 'AGENT_FORBIDDEN'
  | 'TROOP_NOT_AVAILABLE'
  | 'ELITE_TROOP_LOCKED'
  | 'INSUFFICIENT_POPULATION'
  | 'RECRUIT_QUEUE_FULL'
  | 'RECRUIT_NOT_CANCELLABLE'
  | 'TARGET_NOT_ATTACKABLE'
  | 'INSUFFICIENT_TROOPS'
  | 'TILE_NOT_OCCUPIED'
  | 'MARCH_NOT_RECALLABLE'
  | 'PLUNDER_COOLDOWN'
  | 'TASK_INVALID_FOR_TARGET'
  | 'TERRITORY_LIMIT'
  | 'GOVERNMENT_TOO_LOW'
  | 'BRANCH_LIMIT'
  | 'TARGET_LEVEL_TOO_HIGH'
  | 'OUTER_NOT_CLEARED'
  | 'CARGO_OVER_CAPACITY'
  | 'TECH_LEVEL_MAX'
  | 'RESEARCH_IN_PROGRESS'
  | 'ACADEMY_TOO_LOW'
  | 'RESEARCH_NOT_CANCELLABLE'
  | 'MOVING_TARGET_GONE'
  | 'DEPLOY_LIMIT'
  | 'TAVERN_NOT_BUILT'
  | 'HERO_CANDIDATE_GONE'
  | 'HERO_CAP_REACHED'
  | 'HERO_NOT_FOUND'
  | 'HERO_BUSY'
  | 'HERO_WOUNDED'
  | 'HERO_ARREARS'
  | 'GUARD_ASSIGN_DENIED'
  | 'HERO_TRAINING'
  | 'HERO_POINTS_INSUFFICIENT'
  | 'HERO_NOTHING_TO_RESET'
  | 'HERO_DAILY_LIMIT'
  | 'HERO_NOT_UNLOCKED'
  | 'HERO_FRIENDSHIP_LIMIT'
  | 'HERO_FAVOR_INSUFFICIENT'
  | 'HERO_FAVOR_FULL'
  | 'FAMOUS_CLAIMED'
  | 'NEWBIE_PROTECTED'
  | 'TARGET_IN_TRUCE'
  | 'SELF_TRUCE_ACTIVE'
  | 'TRUCE_ALREADY_ACTIVE'
  | 'TRUCE_WEEKLY_USED'
  | 'TRUCE_NOT_ACTIVE'
  | 'PASSIVE_TRUCE_NOT_CANCELLABLE'
  | 'TILE_PROTECTED'
  | 'ALLY_NOT_ATTACKABLE'
  | 'DIPLOMACY_LIMIT'
  | 'DIPLOMACY_COOLDOWN'
  | 'DIPLOMACY_EXISTS'
  | 'DIPLOMACY_INVITE_NOT_FOUND'
  | 'MARKET_LOCKED'
  | 'PRICE_OUT_OF_RANGE'
  | 'ORDER_LIMIT'
  | 'DAILY_TRADE_LIMIT'
  | 'ORDER_NOT_FOUND'
  | 'MARKET_ALLY_ONLY'
  | 'ORDER_NOT_CANCELLABLE'
  | 'NOBILITY_TOO_LOW'
  | 'NOBILITY_SALARY_CLAIMED'
  | 'NOBILITY_SALARY_NONE'
  | 'ALLIANCE_MARK_LIMIT'
  | 'ALLIANCE_MARK_EXISTS'
  | 'WX_TICKET_INVALID'
  | 'WX_CODE_INVALID'
  | 'WX_ALREADY_BOUND'
  | 'WX_UNAVAILABLE'
  | 'GOOGLE_UNAVAILABLE'
  | 'GOOGLE_CREDENTIAL_INVALID'
  | 'GOOGLE_ALREADY_BOUND'
  | 'GITHUB_UNAVAILABLE'
  | 'OAUTH_CODE_INVALID'
  | 'GITHUB_ALREADY_BOUND'
  | 'RATE_LIMITED'
  | 'AGENT_PASSWORD_FORBIDDEN'
  | 'PASSWORD_LOGIN_CLOSED'
  | 'CHAT_GOVERNMENT_TOO_LOW'
  | 'CHAT_MUTED'
  | 'CHAT_BLOCKED'
  | 'CHAT_RATE_LIMITED'
  | 'NICKNAME_TAKEN'
  | 'DISCARD_COOLDOWN'
  | 'DISCARD_MAIN_CITY'
  | 'CITY_IN_BATTLE'
  | 'ARMY_OUTSIDE'
  | 'WILDERNESS_GARRISONED'
  | 'ARENA_NOT_JOINED'
  | 'ARENA_TARGET_INVALID'
  | 'ARENA_NO_CHALLENGES'
  | 'ARENA_TARGET_BUSY'
  | 'ARENA_PAIR_COOLDOWN'
  | 'STAR_TOWER_CLEARED'
  | 'STAR_TOWER_NO_CITY'
  | 'STAR_TOWER_NO_LINEUP'
  /** 换季维护中（v65）：除 GET_SEASON 与登录相关协议外一律返回，响应附 retryAfterSec（秒） */
  | 'MAINTENANCE'
  | 'INTERNAL';

// 协议载荷补齐（v65）：请求 / 响应类型、枚举常量与守卫，以及赛季协议（GET_SEASON / GET_HALL_OF_FAME / PUSH_SEASON）
export * from './protocol-wire';
export * from './protocol-season';

export interface Resources {
  gold: number;
  wood: number;
  food: number;
  stone: number;
  iron: number;
}

/** 建造排队上限（不含在建，占位）：镜像 rules.ts 的 BUILD_QUEUE_CAPACITY，仅用于界面禁用；权威判定在服务端（QUEUE_FULL）。 */
export const BUILD_QUEUE_CAPACITY = 2;

/** 建筑等级上限（普通建筑）：镜像 rules.ts 的 MAX_BUILDING_LEVEL。界面按建筑取值请用 CityView.levelMax（名城主题建筑为 25）；权威判定在服务端（BUILDING_LEVEL_MAX）。 */
export const BUILDING_LEVEL_MAX = 20;

/**
 * 一期九种建筑（v7 起，每种同城限一座；v27 AISLG-77 加第十种书院 academy：科技研究所需）：四种资源生产建筑 + 民房（人口上限）/
 * 官府（自动产金）/ 军营（征兵，v11 已上线）/ 仓库（防掠夺保护随战斗玩法）/ 城墙（守城加成，v11 起随 city.defenseBonus 下发）。
 */
export type BuildingKind =
  | 'farm'
  | 'lumber_mill'
  | 'quarry'
  | 'iron_mine'
  | 'house'
  | 'government'
  | 'barracks'
  | 'warehouse'
  | 'wall'
  | 'academy'
  | 'parade_ground'
  | 'beacon'
  | 'post_station'
  | 'arrow_tower'
  | 'tavern';

/** 按建筑类型统计的已建数量（单实例规则下为 0 或 1） */
export type BuildingCounts = Record<BuildingKind, number>;

/** 单一建筑类型的下一步动作成本（v6，随 GET_STATE 的 city.costs 下发） */
export interface KindActionCosts {
  /** 建造成本；已建成时为 null */
  build: Resources | null;
  /** 升到下一等级的成本；未建造或已达上限时为 null */
  upgrade: Resources | null;
  /** 建造时长（秒，v25 AISLG-71；已按当前全局时间缩放折算）；与 build 同 null 语义 */
  buildSeconds: number | null;
  /** 升到下一等级的时长（秒，v25 AISLG-71；已按当前全局时间缩放折算）；与 upgrade 同 null 语义 */
  upgradeSeconds: number | null;
}

/** 每小时产量（按资源；v7 起含 gold：官府自动产金） */
export interface ProductionRates {
  gold: number;
  food: number;
  wood: number;
  stone: number;
  iron: number;
}

/** 人口现状（v7）：上限 = 100 × 民房等级 × (民房等级 + 1)，无民房为 0；每小时线性增长至上限 */
export interface PopulationView {
  current: number;
  cap: number;
  growthPerHour: number;
}

/** 储量上限（v8 确认规则）：四资源各自 = 10000 + 基础小时产量 × 100，金币固定 100 万 */
export interface StorageCaps {
  gold: number;
  food: number;
  wood: number;
  stone: number;
  iron: number;
}

export interface BuildView {
  id: string;
  /** 所属城池（v24，AISLG-58）：推送属于哪座城（多城时只合并当前查看的城） */
  cityId: string;
  kind: BuildingKind;
  /** v4 起含 'queued'（dueAt 为 null）；v7 起含 'cancelled'（退出队列，保留为历史） */
  status: 'building' | 'queued' | 'completed' | 'cancelled';
  /** 目标等级：建造恒为 1，升级为当前 + 1；连续升级（v22）为当前推进中的目标等级 */
  level: number;
  /** 连续升级的整链终点（v22，AISLG-43）；单级升级与建造为 null */
  toLevel: number | null;
  initiator: InitiatorRole;
  startedAt: string;
  /** 排队中（queued）为 null */
  dueAt: string | null;
  completedAt: string | null;
}

/** 一期兵种（v11，旧游戏 1–7 号）：镜像 backend/common/src/protocol-army.ts 的 TROOP_KINDS */
export const TROOP_KINDS = [
  'porter',
  'militia',
  'scout',
  'pikeman',
  'swordsman',
  'archer',
  'cavalry',
  // v33 二期四兵种（AISLG-86/88/89/90）
  'iron_cavalry',
  'supply_wagon',
  'ballista',
  'siege_ram',
  // v64 名城专属八种（AISLG-168）：占领对应名城的分城才能征募
  'yulin_guard',
  'danyang_soldier',
  'baimao_soldier',
  'huwei_guard',
  'zhuge_crossbow',
  'xiandeng_warrior',
  'hubao_cavalry',
  'xiliang_cavalry',
] as const;

export type TroopKind = (typeof TROOP_KINDS)[number];

/** 按兵种统计的城内驻军数量（v11） */
export type ArmyCounts = Record<TroopKind, number>;

// 世界地图、野地与 NPC / 战斗的类型镜像（v12 起，v13 战斗类、v16 掠夺在 protocol-world.ts）；
// 原名再导出，既有 import 路径不变
// 会话类（事件流 / 帧与错误体 / 登录载荷 / Agent 计划）在 protocol-session.ts——原名再导出
export type {
  EventType,
  EventView,
  AgentPlanView,
  AgentInfoView,
  ClientFrame,
  ResponseFrame,
  PushFrame,
  LoginPasswordData,
  LoginTokenData,
  LoginResultData,
  AgentReportPlanRequestData,
  AgentReportPlanResponseData,
} from './protocol-session';
export type { AgentPlanPushData } from './protocol-session';

// Agent 协作（日报 / 离线汇总）与全服维度（播报 / 排行榜）的类型在
// protocol-agent.ts / protocol-server.ts——原名再导出，既有 import 路径不变
export type {
  AgentDailyReportView,
  OfflineDigestView,
  GetOfflineReportResponseData,
} from './protocol-agent';
export { LEADERBOARD_KINDS, type LeaderboardKind, type LeaderboardEntryView, type ModelLeaderboardEntryView, type GetLeaderboardResponseData, type LeaderboardView } from './protocol-server';
export type {
  ServerBroadcastType,
  ServerBroadcastView,
  GetServerBroadcastsResponseData,
  ServerBroadcastPushData,
  NpcAttackWarningPushData,
  PlayerAttackWarningPushData,
} from './protocol-server';
export { SERVER_BROADCAST_TYPES } from './protocol-server';
export { ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_LANGS } from './protocol-announcement';
export type {
  AnnouncementCategory,
  AnnouncementDetailView,
  AnnouncementLang,
  AnnouncementView,
  GetAnnouncementRequestData,
  GetAnnouncementResponseData,
  GetAnnouncementsRequestData,
  GetAnnouncementsResponseData,
  PushAnnouncementData,
  ReadAnnouncementRequestData,
  ReadAnnouncementResponseData,
} from './protocol-announcement';

export {
  ALLIANCE_COOLDOWN_MS,
  ALLIANCE_CREATE_COST_GOLD,
  ALLIANCE_CREATE_MIN_GOVERNMENT,
  ALLIANCE_INVITE_TTL_MS,
  ALLIANCE_LEADER_INACTIVE_MS,
  ALLIANCE_LIST_PAGE_SIZE,
  ALLIANCE_MAX_MEMBERS,
  ALLIANCE_MAX_VICES,
  ALLIANCE_NAME_MAX_CHARS,
  ALLIANCE_NAME_MIN_CHARS,
  ALLIANCE_NOTICE_MAX_CHARS,
  ALLIANCE_POWER_FAMOUS_WEIGHT,
  ALLIANCE_POWER_GOVERNMENT_WEIGHT,
  ALLIANCE_POWER_TERRITORY_WEIGHT,
  ALLIANCE_RANK_MIN_MEMBERS,
  ALLIANCE_MARK_KINDS,
  ALLIANCE_MARK_MAX,
  ALLIANCE_MARK_PUSH_REASONS,
  ALLIANCE_MARK_TEXT_MAX_CHARS,
  ALLIANCE_MARK_TTL_MS,
  ALLIANCE_PUSH_REASONS,
  ALLIANCE_REQUEST_TTL_MS,
  ALLIANCE_ROLES,
} from './protocol-alliance';
export type {
  AllianceApplyRequestData,
  AllianceBriefView,
  AllianceDetailView,
  AllianceLeaderboardEntryView,
  AllianceInviteRequestData,
  AllianceKickRequestData,
  AllianceMemberView,
  AlliancePlayerView,
  AlliancePushReason,
  AllianceReceivedInviteView,
  AllianceRequestView,
  AllianceRespondRequestData,
  AllianceRole,
  AllianceSentInviteView,
  AllianceSetNoticeRequestData,
  AllianceSetRoleRequestData,
  CreateAllianceRequestData,
  GetAllianceRequestData,
  GetAllianceResponseData,
  ListAlliancesRequestData,
  ListAlliancesResponseData,
  PushAllianceStateData,
  AllianceMarkAddRequestData,
  AllianceMarkAddResponseData,
  AllianceMarkKind,
  AllianceMarkPushReason,
  AllianceMarkRemoveRequestData,
  AllianceMarkRemoveResponseData,
  AllianceMarkView,
  GetAllianceMarksResponseData,
  PushAllianceMarkData,
} from './protocol-alliance';

export type {
  TerrainKind,
  TerrainResource,
  TileKind,
  TileOwnerView,
  TileView,
  TileProtectionView,
  NpcStockTier,
  TileDetailView,
  TerritoryView,
  MarchView,
  MarchTask,
  BranchInfoView,
  CityRefView,
  FamousTileView,
  FamousEffectView,
  WorldMapResponseData,
  MapOverviewResponseData,
  MapOverviewSide,
  MarchRequestData,
  MarchResponseData,
  RecallGarrisonResponseData,
  MarchStatePushData,
  TileStatePushData,
  BattleSideView,
  BattleRoundLogEntryView,
  BattleReportView,
  BattleReportCommentView,
  BattleReportCommentPushData,
  ScoutRequestData,
  ScoutResponseData,
  RecallMarchRequestData,
  RecallMarchResponseData,
  GetBattleReportsResponseData,
  BattleReportPushData,
  ScoutIntel,
} from './protocol-world';
export { TERRAIN_KINDS } from './protocol-world';
export type {
  TechKind,
  TechCategory,
  TechLevels,
  TechEntryView,
  ResearchView,
  TechStateView,
  TechStatePushData,
} from './protocol-tech';
export { TECH_KINDS } from './protocol-tech';
export type {
  HeroView,
  HeroCandidateView,
  FamousClaimView,
  HeroStateView,
  FriendshipView,
  HeroTrainingView,
  TrainingTier,
  AllocateHeroPointsRequestData,
  TrainHeroRequestData,
  BefriendHeroRequestData,
  BefriendHeroResponseData,
  HeroOnlyResponseData,
  GetHeroesRequestData,
  GetHeroesResponseData,
  RecruitHeroRequestData,
  RecruitHeroResponseData,
  DismissHeroRequestData,
  DismissHeroResponseData,
  AssignHeroRequestData,
  AssignHeroResponseData,
  HeroStatePushData,
  CityGuardView,
  BattleHeroView,
  HeroExpDetail,
} from './protocol-hero';
export type { MovingKind, MovingTargetView, MovingTargetPushData, ScheduleEntry } from './protocol-moving';
export { INTERCEPT_REACH, movingIndexAt, reachWindowOf } from './protocol-moving';
export type {
  YtTier,
  YtTileCampView,
  YtCampView,
  YtEventView,
  YtContributionView,
  YtRewardTierView,
  YellowTurbanState,
  YellowTurbanPushData,
} from './protocol-yt';
import type { TechLevels } from './protocol-tech';
import type { DefenseStockView } from './protocol-defense';
import type { AssistOutView, AssistView } from './protocol-assist';
import type { FamousEffectView, MarchView, TerritoryView } from './protocol-world';

/**
 * 单兵征募数值（v11，占位）：镜像 backend/common/src/troops.ts 的 TROOP_INFO，
 * 仅用于界面预填成本与禁用不可征兵种；权威判定在服务端（TROOP_NOT_AVAILABLE 等）。
 * foodUse（v14）为单兵小时耗粮，仅用于征兵面板提示；净产量结算在服务端。
 * carry（v16）为单兵负重，用于出征表单的编队负重预览；掠夺装填在服务端。
 */
export const TROOP_INFO: Record<
  TroopKind,
  { cost: Resources; population: number; unitSeconds: number; barracksLevel: number; foodUse: number; carry: number }
> = {
  porter: { cost: { gold: 50, wood: 30, food: 30, stone: 0, iron: 0 }, population: 1, unitSeconds: 8, barracksLevel: 1, foodUse: 2, carry: 500 },
  militia: { cost: { gold: 80, wood: 20, food: 50, stone: 0, iron: 0 }, population: 1, unitSeconds: 10, barracksLevel: 1, foodUse: 3, carry: 60 },
  scout: { cost: { gold: 100, wood: 50, food: 80, stone: 0, iron: 0 }, population: 1, unitSeconds: 15, barracksLevel: 2, foodUse: 4, carry: 80 },
  pikeman: { cost: { gold: 150, wood: 80, food: 100, stone: 0, iron: 50 }, population: 1, unitSeconds: 20, barracksLevel: 3, foodUse: 5, carry: 60 },
  swordsman: { cost: { gold: 180, wood: 60, food: 120, stone: 0, iron: 80 }, population: 1, unitSeconds: 25, barracksLevel: 4, foodUse: 6, carry: 80 },
  archer: { cost: { gold: 200, wood: 120, food: 100, stone: 0, iron: 60 }, population: 1, unitSeconds: 30, barracksLevel: 5, foodUse: 6, carry: 50 },
  cavalry: { cost: { gold: 300, wood: 80, food: 150, stone: 0, iron: 100 }, population: 1, unitSeconds: 40, barracksLevel: 6, foodUse: 12, carry: 100 },
  iron_cavalry: { cost: { gold: 600, wood: 100, food: 200, stone: 0, iron: 300 }, population: 3, unitSeconds: 60, barracksLevel: 11, foodUse: 30, carry: 100 },
  supply_wagon: { cost: { gold: 200, wood: 300, food: 60, stone: 0, iron: 40 }, population: 6, unitSeconds: 30, barracksLevel: 3, foodUse: 10, carry: 5000 },
  ballista: { cost: { gold: 350, wood: 300, food: 80, stone: 0, iron: 120 }, population: 3, unitSeconds: 45, barracksLevel: 7, foodUse: 8, carry: 0 },
  siege_ram: { cost: { gold: 400, wood: 400, food: 80, stone: 100, iron: 100 }, population: 5, unitSeconds: 60, barracksLevel: 8, foodUse: 10, carry: 0 },
  yulin_guard: { cost: { gold: 360, wood: 120, food: 240, stone: 0, iron: 160 }, population: 2, unitSeconds: 38, barracksLevel: 7, foodUse: 9, carry: 80 },
  danyang_soldier: { cost: { gold: 360, wood: 120, food: 240, stone: 0, iron: 160 }, population: 2, unitSeconds: 38, barracksLevel: 7, foodUse: 9, carry: 80 },
  baimao_soldier: { cost: { gold: 300, wood: 160, food: 200, stone: 0, iron: 100 }, population: 2, unitSeconds: 30, barracksLevel: 6, foodUse: 8, carry: 60 },
  huwei_guard: { cost: { gold: 300, wood: 160, food: 200, stone: 0, iron: 100 }, population: 2, unitSeconds: 30, barracksLevel: 6, foodUse: 8, carry: 60 },
  zhuge_crossbow: { cost: { gold: 400, wood: 240, food: 200, stone: 0, iron: 120 }, population: 2, unitSeconds: 45, barracksLevel: 8, foodUse: 9, carry: 50 },
  xiandeng_warrior: { cost: { gold: 400, wood: 240, food: 200, stone: 0, iron: 120 }, population: 2, unitSeconds: 45, barracksLevel: 8, foodUse: 9, carry: 50 },
  hubao_cavalry: { cost: { gold: 600, wood: 160, food: 300, stone: 0, iron: 200 }, population: 2, unitSeconds: 60, barracksLevel: 9, foodUse: 18, carry: 100 },
  xiliang_cavalry: { cost: { gold: 600, wood: 160, food: 300, stone: 0, iron: 200 }, population: 2, unitSeconds: 60, barracksLevel: 9, foodUse: 18, carry: 100 },
};

/** 名城 → 专属兵种（v64，AISLG-168）：镜像 backend/common/src/famous-effects.ts 的 FAMOUS_ELITE_TROOP */
export const FAMOUS_ELITE_TROOP: Record<string, TroopKind> = {
  洛阳: 'yulin_guard',
  建业: 'danyang_soldier',
  襄阳: 'baimao_soldier',
  许昌: 'huwei_guard',
  成都: 'zhuge_crossbow',
  邺城: 'xiandeng_warrior',
  官渡: 'hubao_cavalry',
  长安: 'xiliang_cavalry',
};

/** 专属兵对应的名城（普通兵为 undefined）：镜像 famousCityOfEliteTroop */
export function famousCityOfEliteTroop(troop: TroopKind): string | undefined {
  return Object.keys(FAMOUS_ELITE_TROOP).find((name) => FAMOUS_ELITE_TROOP[name] === troop);
}

/** 单次征募数量上限（占位）：镜像 backend/common/src/troops.ts 的 RECRUIT_COUNT_MAX */
export const RECRUIT_COUNT_MAX = 100;

// 掠夺与仓库保护的数值镜像（v16）：与兵种负重的预览计算在 protocol-plunder.ts，
// 原名再导出，既有 import 路径不变
export {
  armyCarryCapacity,
  warehouseProtectionPerResource,
  WAREHOUSE_PROTECTION_TOTAL_PER_LEVEL,
  WAREHOUSE_PROTECTION_SPLIT,
  PLUNDER_COOLDOWN_HOURS,
} from './protocol-plunder';

/**
 * 单兵战力（v12，占位决策）：镜像 backend/common/src/battle.ts 的 TROOP_POWER，
 * 仅用于出征表单的编队战力预览；战斗判定在服务端。
 */
export const TROOP_POWER: Record<TroopKind, number> = {
  porter: 1,
  militia: 2,
  scout: 2,
  pikeman: 4,
  swordsman: 5,
  archer: 5,
  cavalry: 8,
  iron_cavalry: 14,
  supply_wagon: 1,
  ballista: 8,
  siege_ram: 3,
  yulin_guard: 7,
  danyang_soldier: 7,
  baimao_soldier: 5,
  huwei_guard: 5,
  zhuge_crossbow: 7,
  xiandeng_warrior: 7,
  hubao_cavalry: 10,
  xiliang_cavalry: 10,
};

/** 征兵排队上限（不含征募中，占位）：镜像 backend/common/src/troops.ts 的 RECRUIT_QUEUE_CAPACITY，
 *  仅用于界面在队满时禁用征兵入口；权威判定在服务端（RECRUIT_QUEUE_FULL）。 */
export const RECRUIT_QUEUE_CAPACITY = 2;

/** 仓库快满提醒阈值（百分数）：镜像 backend/api/src/handlers-offline.ts 的 STORAGE_FULL_PERCENT，
 *  顶栏资源条本地提示用（粮/木/石/铁参与，金币不参与，与离线日报同口径）。 */
export const STORAGE_FULL_WARN_PERCENT = 80;

/** 集市兑换汇率（v22，占位）：镜像 backend/common/src/rules.ts 的 EXCHANGE_INPUT_PER_GOLD，
 *  仅用于兑换弹窗的到手金币预览；成交值以 EXCHANGE 响应的 exchange.gold 为准。 */
export const EXCHANGE_INPUT_PER_GOLD = 4;

// 城池类操作载荷（集市兑换等）的类型在 protocol-city.ts——原名再导出，既有 import 路径不变
export type { ExchangeRequestData, ExchangeResponseData } from './protocol-city';

/** 征兵状态视图（v11；推送与查询共用同一结构，形态对齐 BuildView） */
export interface RecruitView {
  id: string;
  /** 所属城池（v24，AISLG-58） */
  cityId: string;
  troop: TroopKind;
  /** 本次征募数量 */
  count: number;
  /** recruiting=征募中（队首）；queued=排队；completed=已完成；cancelled=已取消（保留为历史） */
  status: 'recruiting' | 'queued' | 'completed' | 'cancelled';
  initiator: InitiatorRole;
  startedAt: string;
  /** 预计完成时间；排队中为 null */
  dueAt: string | null;
  completedAt: string | null;
}

export interface CityView {
  id: string;
  name: string;
  /** 名城分城标记（v24 AISLG-56）：占领名城得到的分城带名城名；普通城为 null */
  famousName: string | null;
  /** 该城的独占产量加成百分数（v24 AISLG-56：名城分城 +20%，已计入 production）；普通城为 0 */
  productionBonusPercent: number;
  /** 名城独有效果（v62，AISLG-166）：只有占领者享受、跟着城走；普通城为 null */
  famousEffect: FamousEffectView | null;
  /** 城池等级（v24 起 = 该城官府等级） */
  level: number;
  /** 城池称号（v76，AISLG-197）：城池 / 县城 / 郡城 / 州城 / 都城（分城最高州城） */
  title: string;
  /** 账号爵位（v76）：{ index（0 = 平民）, name } */
  nobility: { index: number; name: string };
  resources: Resources;
  /** 按建筑类型统计的已建数量（单实例规则下为 0 或 1） */
  buildings: BuildingCounts;
  /** 各建筑类型的当前等级（0 = 未建造；产量、人口上限与储量上限均按等级推导） */
  levels: BuildingCounts;
  /** 各建筑「下一步动作」成本：build=建造（未建时），upgrade=升级（已建未满级时），null=不可用 */
  costs: Record<BuildingKind, KindActionCosts>;
  /** 各建筑的等级上限（v63）：普通 20；占有对应名城时其主题建筑为 25 */
  levelMax: Record<BuildingKind, number>;
  /** 兼容字段：已建成的农田数量（= buildings.farm） */
  farms: number;
  production: ProductionRates;
  /** 人口现状（v7） */
  population: PopulationView;
  /** 储量上限（v7 新增，v8 规则确认）：达到上限后停止对应生产 */
  storage: StorageCaps;
  /** 城内驻军，按兵种统计（v11；征兵完成时入城） */
  army: ArmyCounts;
  /** 全军小时耗粮（v14）：城内 1 倍 + 行军/野地驻军 2 倍；production.food 为毛产量，净粮 = 两者之差 */
  armyFoodUsePerHour: number;
  /** 全局时间缩放（v20，AISLG-38）：本地折算时长（如掠夺冷却剩余）时使用，勿按文档基准硬算 */
  timeScale: number;
  /** 主城免战截止（v22，AISLG-40）：被 NPC 攻破后 2×袭击间隔（÷timeScale）内不再入袭击目标池；null = 不在免战。
   *  v38（AISLG-122）起被玩家攻破 / 被抢后同样写入（4 小时基准），玩家与 NPC 共用 */
  truceUntil: string | null;
  /** 新手保护截止（v38 AISLG-122，账号级）：期内别人不能侦察 / 攻击；null = 已出保 */
  newbieUntil: string | null;
  /** 主动免战截止（v38 AISLG-122，账号级）：TRUCE 开启后 12 小时基准；null = 未开启 */
  shieldUntil: string | null;
  /** 下一次可开启主动免战的时刻（v38；每周一次）；null = 当前可开 */
  shieldNextAt: string | null;
  /** 分城城防值（v40 AISLG-124；0..100，归零一击换主；主城为 null） */
  durability: number | null;
  /** 征兵队列（v11）：第 1 项为征募中（dueAt 非空），其余为排队；已取消的条目不在其中 */
  recruitQueue: RecruitView[];
  /** 城防器械（v73）：库存、上限（城墙等级 × 60）与打造队列 */
  defenses: DefenseStockView;
  /** 协防（v74）：驻扎在本城的盟友部队（城主视图） */
  assistIn: AssistView[];
  /** 本城派出、正在盟友城里驻扎的部队（派出方视图，可召回；占校场名额） */
  assistOut: AssistOutView[];
  /** 本城可接收的协防部队上限 */
  assistCap: number;
  /** 城墙守城防御加成（v11，占位 = 城墙等级 × 5，百分数数值；战斗结算上线后由其消费） */
  defenseBonus: number;
  /** 账号科技等级（v27 AISLG-77；全账号共享，已计入 production / storage / defenseBonus；负重与行军加成由客户端折算） */
  techs: TechLevels;
  /** 在外部队数与上限（v30 AISLG-80）：count = 行军中（含返程）+ 驻守野地，limit = 校场等级（未建按 1） */
  deploy: { count: number; limit: number };
  /** 预计断粮时间（v34 AISLG-107；ISO 8601）：已断粮 = 当前时刻；不会断粮为 null */
  starveAt: string | null;
  /** 下一次断粮哗变时刻（v34）：已断粮时有值——到点本城城内驻军每兵种减 10% */
  mutinyNextAt: string | null;
  /** 箭塔数值（v30 AISLG-82）：守城每回合固定伤害与射程；未建为 null */
  tower: { damage: number; range: number } | null;
  /** 城守（v36 AISLG-115）：本城任命的武将；产量加成已计入 production，守城战另享攻防加成；未任为 null */
  guard: CityGuardView | null;
  /** 本城进行中的行军（v12；到达与返程由服务端结算并推送 / 事件记录） */
  marches: MarchView[];
  /** 本城占领的野地（v12；production 已计入占领加成与驻军采集） */
  territory: TerritoryView[];
  /** 建造队列：第 1 项为在建，其余为排队，按入队顺序；已取消的条目不在其中 */
  queue: BuildView[];
  /** 兼容字段：当前在建（= queue 中 status=building 的首项） */
  building: BuildView | null;
}

/** CANCEL_BUILD（op 24）请求载荷：取消建造条目（排队中 / 建造中）并全额返还其成本 */
export interface CancelBuildRequestData {
  buildId: string;
}

export interface CancelBuildResponseData {
  build: BuildView;
}

/** RENAME_CITY（op 25）请求载荷：名称 trim 后 1..24 字符 */
export interface RenameCityRequestData {
  name: string;
}

export interface RenameCityResponseData {
  cityId: string;
  name: string;
}

/** PUSH_BUILD_STATE（op 2000）推送载荷 */
export interface BuildStatePushData {
  /** build_started=立即开工或队列激活；build_queued=入队；build_completed=完成；build_cancelled=排队条目被取消（v7） */
  reason: 'build_started' | 'build_queued' | 'build_completed' | 'build_cancelled';
  build: BuildView;
}

/** PUSH_CITY_STATE（op 2002）推送载荷：城池级状态变化 */
export interface CityStatePushData {
  /** city_renamed=城池改名；account_reset=账号数据被重置（v9）；city_discarded=分城被放弃（v57） */
  reason: 'city_renamed' | 'account_reset' | 'city_discarded';
  cityId: string;
  /** reason=city_renamed 时的新名称 */
  name?: string;
}

/** DISCARD_CITY（op 94，v57）请求载荷：放弃分城，不可撤销，confirm 必须显式为 true */
export interface DiscardCityRequestData {
  cityId: string;
  confirm: boolean;
}

/** DISCARD_CITY 响应载荷：被放弃的分城与其地块（已回到 NPC 城池）、本账号的占回冷却截止时刻（ISO 8601） */
export interface DiscardCityResponseData {
  cityId: string;
  x: number;
  y: number;
  cooldownUntil: string;
}

/** RESET_ACCOUNT（op 26）请求载荷：重置不可逆，confirm 必须显式为 true */
export interface ResetAccountRequestData {
  confirm: boolean;
}

/** SET_NICKNAME（op 72）请求载荷：昵称 trim 后 1..32 字符；全服唯一，撞名 NICKNAME_TAKEN */
export interface SetNicknameRequestData {
  nickname: string;
}

export interface SetNicknameResponseData {
  /** 新昵称（即账号新 username） */
  username: string;
}

/** PUSH_ACCOUNT_STATE（op 2020）推送载荷：账号级状态变化（v52） */
export interface AccountStatePushData {
  /** account_renamed=昵称被修改 */
  reason: 'account_renamed';
  /** 新昵称 */
  username: string;
}

/** RESET_ACCOUNT 响应载荷：重置完成后的城池现状（即开号初始状态） */
export interface ResetAccountResponseData {
  city: CityView;
}

/** RECRUIT（op 28）请求载荷：troop 兵种 + count 数量（1..RECRUIT_COUNT_MAX） */
export interface RecruitRequestData {
  troop: TroopKind;
  count: number;
}

export interface RecruitResponseData {
  recruit: RecruitView;
}

/** CANCEL_RECRUIT（op 29）请求载荷：取消征兵条目（排队中 / 征募中），全额返还资源与人口 */
export interface CancelRecruitRequestData {
  recruitId: string;
}

export interface CancelRecruitResponseData {
  recruit: RecruitView;
}

// 盟友协防（v74，AISLG-194）的类型在 protocol-assist.ts
export type { AssistView, AssistOutView, DismissAssistRequestData, DismissAssistResponseData } from './protocol-assist';
export { ASSIST_MAX_PER_CITY } from './protocol-assist';

// 城防器械（v73，AISLG-193）的类型与数值镜像在 protocol-defense.ts
export type {
  DefenseKind,
  DefenseCraftView,
  DefenseStockView,
  DefenseUseView,
  DefenseScoutView,
  CraftDefenseRequestData,
  CraftDefenseResponseData,
  CancelDefenseCraftRequestData,
  CancelDefenseCraftResponseData,
  DefenseStatePushData,
} from './protocol-defense';
export { DEFENSE_KINDS, DEFENSE_INFO, DEFENSE_STOCK_PER_WALL_LEVEL } from './protocol-defense';

/** PUSH_RECRUIT_STATE（op 2004）推送载荷 */
export interface RecruitStatePushData {
  /** recruit_started=开始（或队首激活）；recruit_queued=入队；recruit_completed=完成（兵力入城）；recruit_cancelled=排队条目被取消 */
  reason: 'recruit_started' | 'recruit_queued' | 'recruit_completed' | 'recruit_cancelled';
  recruit: RecruitView;
}

// 聊天（v51）的载荷类型与常量
export type {
  ChatCardRequest,
  ChatCardView,
  ChatChannel,
  ChatConversationView,
  ChatConversationsResponseData,
  ChatHistoryRequestData,
  ChatHistoryResponseData,
  ChatMessageView,
  ChatPlayerView,
  ChatReportDetailResponseData,
  ChatSendRequestData,
  ChatSendResponseData,
  PushChatMessageData,
} from './protocol-chat';
export { CHAT_RATE_LIMIT_MS, CHAT_TEXT_MAX_CHARS, CHAT_WORLD_MIN_GOVERNMENT } from './protocol-chat';

export type {
  ArenaFighterView,
  ArenaOpponentView,
  ArenaTopEntryView,
  ArenaRulesView,
  ArenaStateView,
  ArenaRoundView,
  ArenaMatchView,
  ArenaChallengeResponseData,
  GetArenaReportsResponseData,
  ArenaStatePushData,
} from './protocol-arena';
// 任务与签到（v56，AISLG-200）的载荷类型
export type {
  DailyTaskView,
  SigninDayView,
  SigninView,
  QuestStateView,
  GetDailyResponseData,
  ClaimDailyRequestData,
  ClaimDailyResponseData,
  GetSigninResponseData,
  SigninResponseData,
} from './protocol-quest';

// 任务与活动（v56，AISLG-200）的载荷类型
export type {
  MainStepView,
  MainQuestView,
  SideQuestView,
  AchievementTierView,
  AchievementView,
  QuestsView,
  ActivityTierView,
  ActivityView,
  GetQuestsResponseData,
  ClaimQuestRequestData,
  ClaimQuestResponseData,
  GetActivitiesResponseData,
  ClaimActivityResponseData,
} from './protocol-quests';
export type {
  StarTowerRewardView,
  StarTowerRulesView,
  StarTowerStateView,
  StarTowerMatchView,
  StarTowerChallengeResponseData,
  GetStarTowerReportsResponseData,
} from './protocol-star-tower';

// 剧本战场（v75，AISLG-198）的载荷类型
export type {
  BattlefieldCamp,
  BattlefieldSquadStatus,
  BattlefieldStrongholdKind,
  BattlefieldSquadView,
  BattlefieldStrongholdView,
  BattlefieldCampView,
  BattlefieldEventView,
  BattlefieldMeritEntryView,
  BattlefieldMeView,
  BattlefieldShopItem,
  BattlefieldShopItemView,
  BattlefieldRewardTierView,
  GetBattlefieldResponseData,
  BattlefieldPushData,
  EnterBattlefieldRequestData,
  BuyBattlefieldItemResponseData,
} from './protocol-battlefield';

// 声望与爵位（v76，AISLG-197）
export type { NobilityStatusView, GetNobilityResponseData, ClaimNobilitySalaryResponseData } from './protocol-nobility';

// 联盟外交（v77，AISLG-195）
export type {
  AllianceRelationKind,
  AllianceDiplomacyEntryView,
  AllianceFriendInviteView,
  GetAllianceDiplomacyResponseData,
  AllianceDiplomacyTargetRequestData,
  AllianceDiplomacyInviteRequestData,
  AllianceDiplomacyRespondRequestData,
} from './protocol-alliance';

// 玩家交易所（v78，AISLG-196）
export type {
  MarketSellerView,
  MarketCityView,
  MarketOrderView,
  MarketTradeView,
  MarketLimitsView,
  GetMarketResponseData,
  CreateMarketOrderResponseData,
  BuyMarketOrderResponseData,
  CancelMarketOrderResponseData,
} from './protocol-market';
export { MARKET_RESOURCES, MARKET_BUY_KINDS } from './protocol-market';
export type { MarketResource, MarketBuyKind } from './protocol-market';
