// 协议增量变更清单（v32，AISLG-91）：每个协议版本一两句话的结构化摘要，
// 供 GET /agent-api/changes 下发与 LOGIN 的 docNotice 引用——Agent 发现文档落后时
// 只读增量，不必整份重读。详细说明仍以 protocol-version.ts 的注释与 agent-api.md 为准。
// 约定：PROTOCOL_VERSION 每 +1，必须在本表末尾补一条（单元测试校验 1..PROTOCOL_VERSION 连续）。

import { PROTOCOL_VERSION } from './protocol-version';

export interface ProtocolChange {
  version: number;
  summary: string;
}

export const PROTOCOL_CHANGELOG: readonly ProtocolChange[] = [
  { version: 1, summary: '初版：登录（玩家 / Agent 身份声明）、城池状态查询、农田建造与事件推送的最小闭环。' },
  { version: 2, summary: 'LOGIN 新增会话令牌（token）免密登录，响应新增 sessionToken / expiresAt；新增 LOGOUT 与错误码 SESSION_INVALID。' },
  { version: 3, summary: '新增 BUILD（按 kind 建造四种资源建筑）；资源新增 stone / iron；CityView 新增 buildings / production。' },
  { version: 4, summary: '建造队列：有在建时 BUILD 入队（BuildView.status 新增 queued），CityView 新增 queue，新增错误码 QUEUE_FULL。' },
  { version: 5, summary: '建筑单实例 + 等级：新增 UPGRADE，CityView 新增 levels，新增错误码 BUILDING_EXISTS / BUILDING_NOT_BUILT / BUILDING_LEVEL_MAX。' },
  { version: 6, summary: 'CityView 新增 costs：每种建筑下一步动作（建造 / 升级）的成本。' },
  { version: 7, summary: '建筑扩为九种（民房 / 官府 / 军营 / 仓库 / 城墙）；新增 CANCEL_BUILD、RENAME_CITY 与 PUSH_CITY_STATE；CityView 新增 level / population / storage。' },
  { version: 8, summary: '移除建筑拆除；人口上限与储量上限公式定稿，金币上限 100 万；仓库改为防掠夺保护。' },
  { version: 9, summary: '新增 RESET_ACCOUNT（仅玩家连接，confirm=true）与错误码 AGENT_FORBIDDEN。' },
  { version: 10, summary: '新增 AGENT_REPORT_PLAN（op 27，Agent 上报计划）与推送 PUSH_AGENT_PLAN（op 2003）；GET_AGENT_INFO 新增 plan。' },
  { version: 11, summary: '征兵上线：新增 RECRUIT（op 28）/ CANCEL_RECRUIT（op 29）与 PUSH_RECRUIT_STATE（op 2004）；CityView 新增 army / recruitQueue / defenseBonus。' },
  { version: 12, summary: '世界地图上线：新增 GET_WORLD_MAP / GET_TILE / MARCH / RECALL_GARRISON（op 30–33）与行军、地块推送；CityView 新增 marches / territory。' },
  { version: 13, summary: '多回合战斗；新增 SCOUT / RECALL_MARCH / GET_BATTLE_REPORTS（op 34–36）与 PUSH_BATTLE_REPORT（op 2007）；MARCH 支持向自己分城调兵。' },
  { version: 14, summary: '军队持续耗粮：CityView 新增 armyFoodUsePerHour，粮按净产量结算。' },
  { version: 15, summary: '战斗规则定稿（同速同时结算、余伤累计、守方据墙）；回合耗尽战败的幸存部队撤回出发城。' },
  { version: 16, summary: 'MARCH 新增 task（plunder 掠夺 / occupy 占领，缺省 plunder）；掠夺按负重装填、24 小时冷却；新增错误码 PLUNDER_COOLDOWN / TERRITORY_LIMIT / TASK_INVALID_FOR_TARGET。' },
  { version: 17, summary: '非法帧响应形态明确（INVALID_MESSAGE 回带 seq）；地图窗口 w/h 上限 20；NPC 城驻军改为侦察后可见。' },
  { version: 18, summary: '公开七兵种战斗属性表（文档「兵种与战斗属性」、manifest.troops）；战斗公式细节不再对外。' },
  { version: 19, summary: '经济与野地数值校准；新增金矿地形 gold_mine（占领产金）。' },
  { version: 20, summary: '全局时间缩放 time_scale：耗时类 ÷ 倍速、速率类 × 倍速；文档数值为未加速基准。' },
  { version: 21, summary: 'NPC 袭击可打玩家主城（战报 kind=city_raid）；掠夺池含金币；所有推送新增 eventId 去重；战报新增 units / totalHp / avgRange。' },
  { version: 22, summary: '主城被攻破后免战（city.truceUntil）；UPGRADE 新增 toLevel 连续升级；资源不足等失败响应新增 shortfall / retryAfterSeconds；新增 EXCHANGE（op 37）集市兑换。' },
  { version: 23, summary: '二期批次：Agent 方针 / 战报点评 / 离线日报（op 38–41）、NPC 来袭预警（op 2010）、全服播报（op 42 / 2011）、排行榜（op 43）；战报新增 maxRange / rangedUnits。' },
  { version: 24, summary: '城池等级 = 官府等级；城池类协议新增可选 cityId（分城独立操作）；占领 NPC 城变分城；8 座名城两阶段攻打（TileView.famous）。' },
  { version: 25, summary: 'city.costs 每种建筑新增 buildSeconds / upgradeSeconds（已按倍速折算）。' },
  { version: 26, summary: 'MARCH 新增 task=transport 与 cargo：自有城池之间运送资源；新增错误码 CARGO_OVER_CAPACITY。' },
  { version: 27, summary: '科技：新增书院 academy 与 GET_TECHS / RESEARCH_TECH / CANCEL_RESEARCH（op 44–46）、PUSH_TECH_STATE（op 2012）；CityView 新增 techs。' },
  { version: 28, summary: '移动目标（流寇 / 商队）：新增 GET_MOVING_TARGETS（op 47）与 PUSH_MOVING_TARGET_STATE（op 2013）；MARCH 新增 targetId 截击。' },
  { version: 29, summary: '黄巾之乱全服事件：新增 GET_YELLOW_TURBAN（op 48）与 PUSH_YELLOW_TURBAN_STATE（op 2014）；TileView 新增 camp。' },
  { version: 30, summary: '新增四种建筑：校场（同时在外部队上限，错误码 DEPLOY_LIMIT）、烽火台（预警更早更详细）、驿站（自有城间行军加速）、箭塔（守城自动射击）。' },
  { version: 31, summary: '建筑等级上限 10 → 20；10 级以上升级成本与耗时每级 ×1.3；城墙 11~20 级每级 +2%。' },
  { version: 32, summary: 'LOGIN 请求新增可选 docVersion，响应新增 protocolVersion / docNotice（文档落后时提示更新）；新增 HTTP GET /agent-api/changes/{since} 增量变更清单。' },
  { version: 33, summary: '二期四兵种：铁骑兵 iron_cavalry（军营 11 级）/ 辎重车 supply_wagon（负重 5000）/ 床弩 ballista（射程 95）/ 冲车 siege_ram（攻城削弱城墙）；兵种克制倍率；战报新增 wallBreak。' },
  { version: 34, summary: '断粮哗变：粮食为 0 且净产量为负时城内驻军每小时每兵种减 10%（在外部队不召回）；CityView 新增 starveAt / mutinyNextAt；新增推送 PUSH_STARVATION_STATE（op 2015）；离线日报新增 mutinyLost。' },
  { version: 35, summary: '截击「到了先埋伏」：部队提前到达选定格时原地埋伏等目标进入相邻范围再开打（接战时刻 = max(到达时刻, 目标进入范围时刻)，arriveAt 即该时刻）；太晚仍扑空。MarchView 新增 ambushAt（埋伏开始时刻）。' },
  { version: 36, summary: '武将系统：新建筑酒馆（刷新候选 / 金币招募）；MARCH / SCOUT 可带 heroId 随队武将（攻 + 武力×0.3%、减伤 + 智力×0.3%，各封顶 20%、统率×20 超编摊薄）；俸禄每小时扣（欠饷不能出征）、带队战败重伤 2 小时；名将从 PvE 获得（名城首占 / 老巢首杀 / 贡献前二）全服唯一；城守（守城加成 + 产量 +智力×0.1%）；经验升级（100×L²，属性自动成长）。新增 op 49–52 与推送 2016、错误码 HERO_* 等、事件 hero_* / guard_changed、CityView.guard、MarchView.heroId、战报 hero 字段。' },
  { version: 37, summary: '连续升级整链的 build_started / build_queued 事件 detail 新增 toLevel（链终点；cost 为整链总额、level 为首个推进等级）。' },
  { version: 38, summary: '玩家对抗（一）：MARCH 开放掠夺其他玩家的城池（守城战 + 单次比例上限 + 等级差衰减 + 打破后 4 小时免战，战报 kind=pvp_raid，双方各一份）；新手保护（注册 3 天或官府 5 级，期内不可被侦察 / 攻击，主动打玩家即失效，city.newbieUntil）；主动免战 TRUCE（op 53，每周一次 12 小时，city.shieldUntil / shieldNextAt）；TileView 新增 protection（对方保护 / 免战状态与截止时刻）；新增推送 PUSH_ATTACK_WARNING（op 2017 玩家来袭预警）与错误码 NEWBIE_PROTECTED / TARGET_IN_TRUCE / SELF_TRUCE_ACTIVE / TRUCE_ALREADY_ACTIVE / TRUCE_WEEKLY_USED。' },
  { version: 39, summary: '玩家对抗（二）：MARCH task=occupy 开放抢占其他玩家占领的野地（野地战无城墙，战报 kind=pvp_wilderness 双方各一份；守方没驻军直接拿下；名额满则地块变无主）；抢来的地块进入换主保护（1 小时基准随缩放，玩家与 NPC 都不能再抢，tile.protection.ownerChangedUntil）；守方新手保护 / 主动免战期间其野地不可被抢（城级被动免战不保护野地）；PUSH_ATTACK_WARNING（2017）新增 target=wilderness；对他人野地掠夺被拒（TASK_INVALID_FOR_TARGET）；新增错误码 TILE_PROTECTED；事件 wilderness_lost 新增 cause=conquest。' },
  { version: 40, summary: '玩家对抗（三）：分城可被「占领」——守城战打赢一次城防值 −35（冲车占比最多再 −15），归零当场换主（名额条件同占 NPC 城；主城永不可占）；占领打赢不掠夺、掠夺不降城防；打赢进入 4 小时免战、免战内城防不回涨、结束后每小时 +10；换主后城防回满并保护 6 小时，建筑 / 资源 / 名城加成归新主，排队建造 / 征兵 / 研究作废，城守卸任，野地变无主驻军回原主主城，在外部队改回原主主城，NPC 袭击作废；TileView.durability / CityView.durability 下发城防值；战报 kind=pvp_conquest；新事件 city_conquered 与播报 city_conquered；PUSH_TILE_STATE reason 新增 city_conquered / city_durability_hit。' },
  { version: 41, summary: 'NPC 攻破主城时金币单次最多抢走存量的 5%（AISLG-125；此前金币不受仓库保护、全额进池）——四资源仍只扣仓库保护、不加比例上限；玩家掠夺玩家城维持存量 10%（pvpPlunderPool 不受影响）；玩家掠夺 NPC 城、NPC 袭击野地不变。' },
  { version: 42, summary: '玩家对抗数值校准落地（AISLG-126，拍板 2026-10-03，模拟见 docs/battle-calibration.md）：玩家掠夺单次比例四资源 30% → 45%、金币 10% → 15%（让打赢守军接近打平）；新手保护的官府出保门槛 5 级 → 8 级（50 倍速下 5 级约 7 分钟即达，原门槛形同虚设）；被打后免战维持 4 小时、等级差衰减曲线、城防值（100/−35/冲车+15/回涨 10/h）与各换主保护时长均维持不变。' },
  { version: 43, summary: '微信扫码登录与 Agent 令牌：新增 WX_QR_CREATE / WX_SCAN / WX_CONFIRM / WX_CANCEL（op 54–57，WX_* 仅供网页与微信小游戏，Agent 无需调用）与推送 PUSH_WX_QR_STATUS（op 2018）；新增 ISSUE_AGENT_TOKEN / REVOKE_AGENT_TOKEN（op 58 / 59，仅玩家连接）——纯微信账号没有密码，Agent 用玩家签发的令牌以 LOGIN {token, asAgent: true} 接入；GET_AGENT_INFO 新增 agentTokens / wechatBound；新增错误码 WX_* / RATE_LIMITED / AGENT_TOKEN_LIMIT。' },
  { version: 44, summary: 'Google 一键登录：新增 GOOGLE_LOGIN（op 60，登录前可发，仅供网页）用 Google ID Token 换会话令牌（没绑定过的自动建号，随机用户名 g_xxxxxx、无密码），GOOGLE_BIND（op 61，仅玩家连接）给当前账号绑定 Google（一号一 Google）；GET_AGENT_INFO 新增 googleBound；新增 HTTP GET /auth/config（googleClientId / wechatEnabled，前端据此显示登录入口）；新增错误码 GOOGLE_UNAVAILABLE / GOOGLE_CREDENTIAL_INVALID / GOOGLE_ALREADY_BOUND。Agent 无需 Google 登录：纯 Google 账号沿用 Agent 令牌接入。' },
  { version: 45, summary: 'GitHub 一键登录（OAuth 授权码、整页跳转）：新增 GITHUB_AUTH_START（op 62，登录前可发；返回 GitHub 授权地址）与 OAUTH_REDEEM（op 63，登录前可发；用 60 秒一次性登录码换会话令牌，再走 LOGIN {token}）；新增 HTTP GET /auth/github/callback（GitHub 回跳：login 发一次性码 302 回前端，bind 直接写绑定；取消 / 过期带 error 回跳）；第三方身份迁入共用表 oauth_identities（google 同步迁入）；GET_AGENT_INFO 新增 githubBound / githubLogin；/auth/config 新增 githubEnabled；新增错误码 GITHUB_UNAVAILABLE / OAUTH_CODE_INVALID / GITHUB_ALREADY_BOUND。Agent 无需 GitHub 登录：纯 GitHub 账号沿用 Agent 令牌接入。' },
  { version: 46, summary: '永久 Agent 令牌：每账号一个（sk_ 前缀、永不过期、建号自动生成、原文可反复查看），「复制给 AI」的提示词自动带上。新增 GET_AGENT_TOKEN / RESET_AGENT_TOKEN（op 64 / 65，仅玩家连接：查看 / 重置并断开旧令牌在线连接）。LOGIN {token} 先查会话令牌、查不到再按永久令牌（expiresAt 为 null、LOGOUT 不吊销）。移除 ISSUE_AGENT_TOKEN / REVOKE_AGENT_TOKEN（op 58 / 59）、AGENT_TOKEN_LIMIT 与 GET_AGENT_INFO.agentTokens——多令牌体系从未上线，删除不涉及兼容。' },
  { version: 47, summary: '双站点与 Agent 令牌-only 登录（AISLG-130）：游戏两个站（国内站 / 国际站 slg.yuntianyou.cc）共用同一套服务与数据库、账号通用，按连接访问的 Host 区分站点。国际站整站关闭账号密码登录（LOGIN 密码分支返回新错误码 PASSWORD_LOGIN_CLOSED，界面按 GET /auth/config 的 passwordLogin=false 隐藏密码表单，绕过界面直发也照样被拒）；国内站照旧。Agent 一律不能用账号密码登录（哪个站都一样），LOGIN 密码分支遇 asAgent=true 返回新错误码 AGENT_PASSWORD_FORBIDDEN，提示改用永久令牌（v46）——密码登录自此只属于玩家本人。GitHub 登录按站点分套（OAuth App 回调地址只能填一个，两站各建一个）：新环境变量 GITHUB_SITES（JSON，键为 Host，支持 "default" 兜底）替代旧四变量（仍可用），state 记发起站点、回调按它选配置套并跳回对应前端；/auth/config 的 passwordLogin 与 githubEnabled 按请求 Host 下发。协议消息结构无变化。' },
  { version: 48, summary: '关闭密码登录的自动注册：LOGIN 密码分支遇到不存在的用户名不再建号，返回新错误码 SIGNUP_CLOSED（提示改走第三方登录注册）；已有账号的密码登录不受影响。新账号自此只能经第三方登录创建（Google / GitHub / 微信扫码）。移除错误码 USERNAME_TAKEN（并发同名注册专用，随注册通道关闭而消失）。协议消息结构无变化。' },
  { version: 49, summary: '作战方针模块整体移除：删除 SET_AGENT_DIRECTIVE（op 38）与推送 PUSH_AGENT_DIRECTIVE（op 2008），GET_AGENT_INFO 不再返回 directive 字段（agent_directives 表随上线清理删除）。玩家对 Agent 的打法意图改为与自己的 Agent 直接讨论，不再经游戏设置。老客户端发 op 38 会收到 UNKNOWN_OP。' },
  { version: 50, summary: '排行榜按 AI 模型分组（AISLG-133）：LOGIN 请求新增可选 agentModel（仅 asAgent=true 生效：Agent 自报驱动自己的模型 / 脚本名，限长 64、以最近一次声明为准，不填也能正常登录）。GET_LEADERBOARD 玩家三榜条目新增 agentModel（自报原文，null = 从未声明）；新增 kind=model 模型榜，响应经 modelEntries 按归类后的模型聚合下发（entries 为空、me 为 null）：只统计最近 7 天 Agent 上线过且进了战力统计的账号，排名 = 该模型实力前 10 名的平均战力，未声明与名单外（「其他」）同样是组。模型为自报口径，不验证。' },
  { version: 51, summary: '新增玩家专属功能（聊天）：仅玩家连接可用，Agent 连接调用返回 AGENT_FORBIDDEN，本文档不收录其接口。其余协议（消息结构、既有协议号与错误码）无变化。' },
  { version: 52, summary: '新增 SET_NICKNAME（op 72，仅玩家连接）：修改账号昵称（trim 后 1..32 字符），全服唯一，撞名返回新错误码 NICKNAME_TAKEN。昵称即账号 username——聊天、地图归属、排行榜展示的都是它（改名后实时生效，排行榜快照 ≤10 分钟重算覆盖）；它同时是密码登录键，改名后密码登录用新昵称，第三方与令牌登录绑定账号 id 不受影响。新增推送 PUSH_ACCOUNT_STATE（op 2020，reason=account_renamed）与事件 account_renamed（detail={from,to}）。' },
  { version: 53, summary: '新增竞技场（AISLG-145，玩家与 Agent 同一套规则）：GET_ARENA（op 73）查询、SET_ARENA_LINEUP（op 74）保存 3 人阵容（第一次保存即入榜）、ARENA_CHALLENGE（op 75）三局两胜挑战对手、GET_ARENA_REPORTS（op 76）查战报（保留 7 天）；推送 PUSH_ARENA_STATE（op 2021，reason=challenged / daily_reward / milestone）；全服播报新增 arena_champion（登上第 1 名）。新增错误码 ARENA_NOT_JOINED / ARENA_TARGET_INVALID / ARENA_NO_CHALLENGES / ARENA_TARGET_BUSY / ARENA_PAIR_COOLDOWN。其余协议无变化。' },
  { version: 54, summary: '武将培养与在野名将（AISLG-144，只加不改，除升级成长方式外）：新增 ALLOCATE_HERO_POINTS（op 77）加点、RESET_HERO_POINTS（op 78）洗点、TRAIN_HERO（op 79）历练、GIFT_HERO（op 80）赏赐、BEFRIEND_HERO（op 81）结交、RECRUIT_FAMOUS_HERO（op 82）招揽；HeroView 新增 freePoints / training / dailyLeft；GET_HEROES 新增 friendships / unlocks / friendshipCap，famousClaims 新增 wildAt；名将扩到 40 名（在野 29 名落在 Lv3+ 野地，GET_WORLD_MAP 的 tiles[].wildFamous 标记，GET_TILE 的 wildFamousIntel 侦察后给出名字与属性）；等级上限 20 → 40，升级不再自动加三项属性而是得自由点数（普通将 3、名将 5）；推送 PUSH_HERO_STATE 新增 reason training_started / training_done / points_changed / gifted / friendship_changed。新增错误码 HERO_TRAINING / HERO_POINTS_INSUFFICIENT / HERO_NOTHING_TO_RESET / HERO_DAILY_LIMIT / HERO_NOT_UNLOCKED / HERO_FRIENDSHIP_LIMIT / HERO_FAVOR_INSUFFICIENT / HERO_FAVOR_FULL / FAMOUS_CLAIMED。'},
  { version: 55, summary: '新增将星塔（AISLG-146，单机爬塔，玩家与 Agent 同一套规则）：GET_STAR_TOWER（op 83）查询已通过的最高层、下一层敌方阵容与首通奖励、阵容；STAR_TOWER_CHALLENGE（op 84，无参数）挑战下一层，三局两胜，赢了首通发金币（进主城）与武将经验并推进进度；GET_STAR_TOWER_REPORTS（op 85）查战报（每人保留 50 条）。固定 100 层，每 10 层为 Boss 层，首通全服播报 star_tower_cleared。阵容与竞技场共用（SET_ARENA_LINEUP）。新增错误码 STAR_TOWER_CLEARED / STAR_TOWER_NO_CITY / STAR_TOWER_NO_LINEUP。其余协议无变化。' },
  { version: 56, summary: '新增任务与活动（AISLG-200，只加不改）：日常任务 GET_DAILY（op 86）/ CLAIM_DAILY（op 87），6 条，按北京日（Asia/Shanghai）刷新，完成判定读 events 表当日事件；每日签到 GET_SIGNIN（op 88）/ SIGNIN（op 89），连续签到 7 天一轮循环（断签归 1），奖励按档位递增；主线任务链 10 环（顺序解锁、顺序领取）、支线 4 条、成就 6 条 × 3 档：GET_QUESTS（op 90）/ CLAIM_QUEST（op 91）；活动「开服冲刺」（限时）与「每日活跃」（按天）：GET_ACTIVITIES（op 92）/ CLAIM_ACTIVITY（op 93）。进度从 events / 建筑 / 科技 / 武将 / 签到等既有数据派生，不新增埋点；奖励发往主城；领奖原子去重，并发重复领取只发一次。新表 quest_claims / signin_state / quest_claims_once。无新增错误码（未达成 / 前置未完成 / 不在活动期 / 重复领取复用 INVALID_PARAMS）。' },
  { version: 57, summary: '分城上限放宽与放弃分城（AISLG-155、AISLG-153）：分城上限由 floor(主城官府等级 ÷ 3) 放宽为 floor(主城官府等级 ÷ 2)，官府 4 级起 2 个、20 级满级 10 个（占位，上线后按数据调整）；已有名额只增不减。新增 DISCARD_CITY（op 94，玩家与 Agent 通用）：放弃一座分城（data.cityId 必填、data.confirm 须为 true；主城不可放弃）。被拒的理由见错误码 DISCARD_MAIN_CITY / CITY_IN_BATTLE / ARMY_OUTSIDE / WILDERNESS_GARRISONED。放弃后城内资源、驻军、建筑与建造 / 征兵 / 研究队列作废（不返还），城守武将解除任命、武将保留；名下野地转为无主；地块回到同级 NPC 城池（名城恢复为未攻破状态）；本账号冷却 = 放弃时的官府等级 天（按时间缩放），冷却内再占该 NPC 城返回新错误码 DISCARD_COOLDOWN（占领结算同样复核）。PUSH_CITY_STATE 新增 reason=city_discarded，EventType 新增 city_discarded。'  },
  { version: 58, summary: '世界小地图总览（AISLG-160，只加不改）：新增 GET_MAP_OVERVIEW（op 95，玩家与 Agent 通用，只读）：返回全图城池点位 cities = [[x, y, side]]，side 为 own 本方城池 / enemy 他方玩家城池 / npc NPC 城池 / famous 未被占领的名城；不含野地与黄巾营地，响应带 size 与统计时刻 at。新增 world_tiles 局部索引 idx_world_tiles_city_kind。无新增错误码，其余协议无变化。' },
  { version: 59, summary: '普通将特长与阵型（只加不改）：普通武将招募成功时随机获得一项固定特长（不可选择、修改或重置），名将与已有武将不变；HeroView 与战斗快照新增 specialty / specialtyBonus。SET_ARENA_LINEUP 新增可选 formations（3 个号位各选 balanced / infantry / ranged / cavalry，不传则保留原选择）；GET_ARENA 与 GET_STAR_TOWER 返回已存阵型与阵型目录。特长经共用战斗引擎作用于竞技场、将星塔、出征与守城；大地图按实际部队结算。其余协议无变化。' },
  { version: 60, summary: '公告（AISLG-162，只加不改）：运营公告（系统公告 / 活动公告）。GET_ANNOUNCEMENTS（op 96）查列表：默认生效中的公告（置顶在前，其余按发布时间倒序），history=true 查往期，返回 unreadCount 红点数；GET_ANNOUNCEMENT（op 97）查正文（服务端过滤为受限 Markdown：分段、加粗、https 链接，图片与 HTML 去掉）；READ_ANNOUNCEMENT（op 98）标记已读（幂等）。三者玩家与 Agent 通用。推送 PUSH_ANNOUNCEMENT（op 2022）新公告到达，只带标题与分类，本站在线连接收到（含 Agent）。公告支持中英双语（英文没填回落中文）、置顶、强提醒（默认关，玩家进主界面弹窗，点确认才算已读）、站点定向、生效 / 结束时间（过期进入往期）。由运维脚本发布，可选同步全服播报（播报类型 announcement）。新表 announcements、announcement_reads；新增错误码 ANNOUNCEMENT_NOT_FOUND。其余协议无变化。' },
  { version: 61, summary: '野地储量（AISLG-165，只加不改）：每块野地有一份储量，驻军采集从中扣，采空即停，没人采时按恢复速度慢慢长回。储量基准 = 1500 + 3500 × 等级（按固定哈希在 ±20% 内取值，金矿 ×0.4），采集上限 = 储量的 10%/h，恢复 = 储量的 2%/h；占领加成不扣储量，连片 / 名城 / 农耕等加成只放大产出。储量与上限为基准单位，bonusRate / gatherRate 同口径；采集上限与恢复速率随 time_scale 放大（产出照常按 time_scale 放大），采空 / 回满的真实时长随之缩短。TileView 与 CityView.territory 新增 reserve（档位 ample / normal / depleted 对所有人可见；当前储量 / 上限 / 预计采空或回满时刻仅归属方与侦察过该地块的账号可见）；TerritoryView.gatherRate 与地块详情的 wilderness.gatherRate 改为受储量约束的瞬时采集速率。新增事件 wilderness_depleted（归属方的事件流，detail = { x, y, terrain, level, at }），并经 PUSH_TILE_STATE 推送 reason=reserve_depleted。掠夺的地形资源以该地块当前储量为上限并从中扣减（金币不受约束）；流寇劫掠同口径。无新增协议号与错误码，老野地无需迁移（无储量值即满储量）。' },
  { version: 62, summary: '名城独有效果（AISLG-166，只加不改）：8 座名城各一项只有占领者享受的效果，跟着城走——洛阳守城城墙减伤 +5 个百分点，长安箭塔伤害 +20%，官渡 / 成都 / 建业 / 邺城辖下对应资源的野地产出 +25%（占领加成与采集同口径，不扣储量），许昌自己城池之间的调兵 / 运输行军速度 +20%，襄阳仓库防掠夺保护额 +50%。TileView.famous 与 CityView 新增 effect / famousEffect（{ kind, percent, resources }）。无新增协议号与错误码。' },
  { version: 63, summary: '名城主题建筑等级上限（AISLG-167，只加不改）：占有名城时其主题建筑可升到 25 级，其余建筑仍为 20 级。主题建筑：洛阳城墙、长安箭塔、官渡农田、成都铁矿、建业伐木场、邺城官府（一期无金矿）、许昌驿站、襄阳仓库；跟着城走，与名城效果同口径；失守后超出上限的存量等级按当前上限生效（库存保留，重新占领即恢复）。CityView 新增 levelMax（各建筑等级上限）；UPGRADE 的等级上限与连升 toLevel 上限按该城判定。城墙守城减伤 21~25 级每级 +1（25 级 75%，加满城防科技与洛阳名城恰为 90% 封顶）。无新增协议号与错误码。' },
  { version: 64, summary: '名城专属兵种（AISLG-168，只加不改）：8 座名城各一种专属精锐兵，只能在占领该名城的分城军营征募。新增 8 个 TroopKind（羽林卫 yulin_guard、丹阳兵 danyang_soldier、白毦兵 baimao_soldier、虎卫军 huwei_guard、诸葛连弩兵 zhuge_crossbow、先登死士 xiandeng_warrior、虎豹骑 hubao_cavalry、西凉铁骑 xiliang_cavalry）；新错误码 ELITE_TROOP_LOCKED；城池非对应名城（含失守后原主人）征募返回该码。数值占位。' },
  { version: 65, summary: '赛季系统（AISLG-134，只加不改）：固定 28 天一季（SEASON_LENGTH_DAYS），换季时地图、城池、军队、武将等世界数据重置，账号、令牌与第三方绑定保留，榜单前列进名人堂。新增 GET_SEASON（op 99，维护期间仍可用）查当前赛季、维护态、我的荣誉与是否已加入本赛季；GET_HALL_OF_FAME（op 100）按赛季、榜种、页查名人堂。推送 PUSH_SEASON（op 2023，phase = warning / resetting / started，全部在线连接收到）。换季期间游戏类请求返回新错误码 MAINTENANCE（附 retryAfterSec）。三条登录成功响应新增 season = { id, endsAt }；账号在新赛季首次登录时惰性加入（获得新主城与新手保护）。'},
  { version: 66, summary: '联盟 · 建盟与成员管理（AISLG-181 / AISLG-143，只加不改）：新增 CREATE_ALLIANCE（op 101，官府 ≥ 5 级、从主城扣 10 万金币、联盟名 2–8 字全服唯一过屏蔽词）、ALLIANCE_APPLY（104，申请 / 撤回，同一时间 1 条，48 小时过期）、ALLIANCE_INVITE（105，盟主或副盟主邀请 / 撤回，待处理邀请占成员名额，48 小时过期）、ALLIANCE_RESPOND（106，审批申请或答复邀请）、ALLIANCE_LEAVE（107，盟主有其他成员时须先转让，只剩一人等于解散）、ALLIANCE_DISBAND（108）、ALLIANCE_KICK（109，立即生效，副盟主只能踢普通成员）、ALLIANCE_SET_ROLE（110，任免副盟主最多 2 人 / 转让盟主）、ALLIANCE_SET_NOTICE（111，公告 ≤ 200 字）；以上均仅限玩家连接，Agent 返回 AGENT_FORBIDDEN。查询类 GET_ALLIANCE（102，缺省 = 我的联盟含申请 / 邀请，给 allianceId = 公开信息）与 LIST_ALLIANCES（103，按成员数降序分页）玩家与 Agent 通用。推送 PUSH_ALLIANCE_STATE（op 2024，reason = joined / left / kicked / role_changed / disbanded / notice / request_received / request_resolved / invited，推给相关账号，收到后重新 GET_ALLIANCE）。成员上限 30，退出 / 被踢 / 解散者 24 小时内不能创建也不能加入，盟主 7 天没有活跃系统自动转让（转给最近活跃的副盟主，没有副盟主则转给最早入盟的成员）。新增错误码 ALLIANCE_NAME_INVALID / ALLIANCE_NAME_TAKEN / ALLIANCE_GOVERNMENT_TOO_LOW / ALLIANCE_ALREADY_IN / ALLIANCE_NOT_IN / ALLIANCE_NOT_FOUND / ALLIANCE_COOLDOWN / ALLIANCE_FULL / ALLIANCE_FORBIDDEN / ALLIANCE_ROLE_FULL / ALLIANCE_LEADER_MUST_TRANSFER / ALLIANCE_REQUEST_EXISTS。新表 alliances / alliance_members / alliance_requests / alliance_invites；联盟与成员关系跨赛季保留，申请与邀请换季清空。其余协议无变化（盟友互不攻击、联盟频道、地图标记、联盟榜在后续版本）。' },
  { version: 67, summary: '联盟 · 盟友互不攻击（AISLG-182 / AISLG-143，只加不改）：同一联盟的成员之间不能互相攻击——MARCH 对盟友的城池掠夺 / 占领分城、对盟友占领的野地抢占 / 掠夺，以及 SCOUT 侦察盟友的城池或野地，一律返回新错误码 ALLY_NOT_ATTACKABLE；运输、增援、调兵不受影响；侦察被拒不触发新手保护失效。出发后目标才成为盟友的，Worker 到达结算时复核，不开战、不侦察，部队原路返回，事件 outcome=aborted、cause=ALLY_NOT_ATTACKABLE。地图：TileView.owner 新增 ally（占领者与你同属一个联盟，自己为 false），GET_MAP_OVERVIEW 的点位 side 新增 ally（盟友城池）。盟友来袭预警不再出现（本来就打不到）。其余协议无变化。' },
  { version: 68, summary: '联盟频道：CHAT_HISTORY / CHAT_SEND 的 channel 新增 alliance（仅本联盟成员，无官府门槛）；消息视图新增 type=system 与 system 字段，联盟大事（入盟、退出、被踢、盟主变更）写成系统消息；sender 可为 null。' },
  { version: 69, summary: '联盟地图标记（AISLG-184，只加不改）：成员可在地图任意格子打标记（rally 集结 / enemy 敌人 / resource 资源 / danger 危险，可附 20 字内一句话，过屏蔽词即拒绝）。新增 ALLIANCE_MARK_ADD（op 112，玩家与 Agent 通用）、ALLIANCE_MARK_REMOVE（113，成员只能删自己的，盟主 / 副盟主可删任何人的，Agent 只能删自己的）、GET_ALLIANCE_MARKS（114，本联盟的有效标记）与推送 PUSH_ALLIANCE_MARK（op 2025，reason = added / removed，只推给本联盟在线成员）。同一联盟最多 20 个有效标记，满了返回 ALLIANCE_MARK_LIMIT（附最早到期时刻）；同一格子不能重复（ALLIANCE_MARK_EXISTS）；每个标记保留 24 小时，过期后不再返回。创建标记时联盟频道写一条系统消息（alliance_mark_created）。新错误码 ALLIANCE_MARK_LIMIT / ALLIANCE_MARK_EXISTS；新表 alliance_marks，换季清空。' },
  { version: 70, summary: '联盟榜与联盟信息（AISLG-185，只加不改）：GET_LEADERBOARD 的 kind 新增 alliance，条目经 allianceEntries 下发（联盟名、盟主、成员数、势力，前 50 名）；势力 = 全体成员占领的野地数 + 名城数 × 10 + 成员主城官府等级之和，成员不足 5 人不上榜，榜单为 Worker 定期快照。GET_ALLIANCE 的联盟详情新增 power（势力）与 rank（名次，未上榜为 null）。GET_HALL_OF_FAME 的 kind 新增 alliance（换季时联盟榜前三进名人堂，条目带盟主与联盟信息；个人条目新增 allianceId / allianceName / memberCount 三个字段，个人榜为 null）。无新增协议号与错误码；新表 alliance_leaderboard_snapshots，换季清空。' },
];

/** 增量变更的 HTTP 路径（与 /agent-api.md 同域名；since 为调用方手上文档的版本号） */
export const CHANGES_PATH_PREFIX = '/agent-api/changes';

/** 版本 since 之后（不含）的全部变更，按版本升序；since ≥ 当前版本时为空 */
export function changesSince(since: number): ProtocolChange[] {
  return PROTOCOL_CHANGELOG.filter((c) => c.version > since);
}

/**
 * LOGIN 响应的 docNotice（仅 Agent 连接）：
 * - 带了 docVersion 且低于当前版本 → 提示从哪个版本更新到哪个版本、去哪里看增量；
 * - 没带 docVersion（旧 Agent）→ 给一句通用提示，让它自己比对文档开头的版本号；
 * - docVersion ≥ 当前版本 → null。
 */
export function docNoticeFor(docVersion: number | null): string | null {
  const full = '/agent-api.md';
  if (docVersion === null) {
    return `当前接口协议为 v${PROTOCOL_VERSION}。若你手上 agent-api.md 开头标注的版本低于 v${PROTOCOL_VERSION}，请 GET ${CHANGES_PATH_PREFIX}/<你的版本号> 查看增量变更，或重新下载 ${full}（与本游戏服务同域名的 HTTPS 地址），并在之后的 LOGIN 中带上 docVersion。`;
  }
  if (docVersion >= PROTOCOL_VERSION) {
    return null;
  }
  return `接口文档已从 v${docVersion} 更新到 v${PROTOCOL_VERSION}：请 GET ${CHANGES_PATH_PREFIX}/${docVersion} 查看增量变更，或重新下载 ${full}（与本游戏服务同域名的 HTTPS 地址）。`;
}
