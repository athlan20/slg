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
