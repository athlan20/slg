// 协议版本与变更历史（从 protocol.ts 拆出以控制单文件行数；对外语义不变）。
// 协议的对外文档由 protocol-doc*.ts 清单生成（npm run gen:api-doc → docs/agent-api.*）。
/**
 * 协议版本：对外协议内容每次变化（新增/废弃协议号、字段、错误码）时 +1。
 * 兼容策略「只加不改」见 docs/agent-api.md「版本与兼容」。
 * v2：LOGIN 新增 token 令牌登录变体与 sessionToken/expiresAt 响应字段，
 * 新增 LOGOUT 协议与 SESSION_INVALID 错误码。
 * v3：新增 BUILD 协议（按建筑类型发起建造，四种资源生产建筑）；
 * Resources 新增 stone / iron；CityView 新增 buildings / production 字段。
 * BUILD_FARM（op 20）保留为 kind=farm 的兼容入口。
 * v4：建造队列——BUILD 在有在建时不再直接失败，而是入队（排队上限内）；
 * BuildView.status 新增 'queued'（此时 dueAt 为 null）；CityView 新增 queue 字段
 * （在建 + 排队，按顺序）；推送 reason 新增 'build_queued'；新增错误码 QUEUE_FULL
 * 与事件类型 build_queued。BUILD_IN_PROGRESS 不再由 BUILD 返回（保留错误码定义）。
 * v5：建筑单实例 + 等级——每种建筑同城唯一（重复建造返回 BUILDING_EXISTS）；
 * 新增 UPGRADE 协议（升级到下一等级，与建造共用队列）；CityView 新增 levels
 * （各类型当前等级，0 = 未建），buildings 语义保持为数量（0/1）；BuildView.level
 * 为目标等级（建造恒为 1，升级为当前 + 1）；新增错误码 BUILDING_NOT_BUILT /
 * BUILDING_LEVEL_MAX。
 * v6：CityView 新增 costs——每种建筑「下一步动作」的成本（未建为建造成本，
 * 已建未满级为升级成本，满级均为 null），供客户端在发起前展示与预判不足。
 * v7（docs/phase-1-launch-scope.md「城池、建筑与经济」）：建筑从四种扩展为九种
 * （新增 house 民房 / government 官府 / barracks 军营 / warehouse 仓库 / wall 城墙）；
 * 新增 CANCEL_BUILD（取消排队条目并返还成本）、RENAME_CITY（城池改名）协议
 * 与 PUSH_CITY_STATE 推送；CityView 新增 level（城池数字等级）、population（人口现状）、
 * storage（储量上限）字段，production 新增 gold（官府产金）；BuildView.status
 * 新增 'cancelled'；新增错误码 BUILD_NOT_CANCELLABLE 与事件 build_cancelled / city_renamed。
 * v8（2026-09-27 规则确认）：移除 DEMOLISH 协议与 building_demolished 事件、对应
 * PUSH_CITY_STATE reason 与错误码 BUILDING_IN_QUEUE——一期不提供建筑拆除；v7 未对外
 * 发布（仅工作区迭代），直接移除不构成兼容问题。人口上限改为 100 × 民房等级 ×
 * (等级 + 1)（无民房为 0）、增速 10/小时；储量上限改为四资源各自 10000 + 基础小时
 * 产量 × 100、金币固定 100 万（storage 视图新增 gold 字段）；仓库不再提高储量上限
 * （改为后续战斗玩法的防掠夺保护），storage 语义由「仓储上限」改为「储量上限」。
 * v9：新增 RESET_ACCOUNT——一键把账号的全部游戏数据重置为开号初始状态
 * （城池资源/等级/名称、建筑、建造队列与历史、人口、事件流；会话凭证保留），
 * 请求须带 confirm=true 防误触，且仅限玩家连接调用（Agent 连接返回 AGENT_FORBIDDEN；
 * 基于连接自报 role 的协议级限制，不是可验证的安全边界，见「身份边界」）；新增事件
 * account_reset、错误码 AGENT_FORBIDDEN，PUSH_CITY_STATE 新增 reason 'account_reset'。
 * v10：新增 AGENT_REPORT_PLAN（op 27，仅 Agent 连接）——Agent 上报「下一步动作
 * nextAction」与「整体计划 overallPlan」两段自报文本（空串清除、缺省保持不变），
 * 服务端保存账号最新快照；GET_AGENT_INFO 新增 plan 字段，变更经新推送
 * PUSH_AGENT_PLAN（op 2003）通知在线连接；RESET_ACCOUNT 同时清空计划。
 * 计划是未验证的展示信息，只用于托管监控，不参与任何游戏逻辑。
 * v11：军营征兵与城墙守城加成接入。新增 RECRUIT（op 28，按兵种征募 1..100，消耗
 * 资源与人口，军营等级解锁兵种）与 CANCEL_RECRUIT（op 29，取消排队条目并全额返还
 * 资源与人口）；征兵队列独立于建造队列（1 征募中 + 2 排队，占位）；新推送
 * PUSH_RECRUIT_STATE（op 2004）与事件 recruit_*；CityView 新增 army（城内驻军）、
 * recruitQueue（征兵队列）、defenseBonus（城墙守城加成，占位 = 城墙等级 × 5%）；
 * 新增错误码 TROOP_NOT_AVAILABLE / INSUFFICIENT_POPULATION / RECRUIT_QUEUE_FULL /
 * RECRUIT_NOT_CANCELLABLE。军队耗粮与战斗结算（含守城加成的消费方）随战斗玩法设计。
 * v12：世界地图、野地与 NPC 城池上线（范围文档「世界地图、野地与 NPC」）。新增
 * GET_WORLD_MAP（op 30）、GET_TILE（op 31）、MARCH（op 32，从主城出征）与
 * RECALL_GARRISON（op 33，撤回占领野地的驻军，撤回即放弃占领）；新推送 PUSH_MARCH_STATE
 * （op 2005）与 PUSH_TILE_STATE（op 2006）；事件新增 march_* / wilderness_* /
 * npc_city_occupied / npc_raid；CityView 新增
 * marches（进行中行军）与 territory（占领野地），production 计入野地占领加成与驻军
 * 采集；GET_STATE 响应新增 cities（账号全部城池坐标）；新增错误码 TARGET_NOT_ATTACKABLE
 * / INSUFFICIENT_TROOPS / TILE_NOT_OCCUPIED。战斗结算为占位的总战力对比（battle.ts）。
 * v13（范围文档「征兵、行军与战斗」）：战斗升级为多回合推进结构（battle.ts：速度 /
 * 射程 / 互斥判定链 / 城墙防御加成，全部数值占位）；野地原住守军与 NPC 袭击改为
 * 真实编成。新增 SCOUT（op 34，斥候侦察，产出情报并返程）、RECALL_MARCH（op 35，
 * 行军途中撤回）、GET_BATTLE_REPORTS（op 36，战报查询）与 PUSH_BATTLE_REPORT
 * （op 2007，战报生成推送）；MARCH 支持目标为本账号分城（调兵，不战斗）与按编队
 * 最慢兵种的行军速度；MarchView.purpose 新增 'scout' / 'transfer'；GET_TILE 的
 * NPC 城池详情（npc 字段）改为需侦察：未侦察返回 null，已侦察返回最近一次侦察
 * 快照（新增 scoutedAt 字段）——v12 未对外发布，语义调整不构成兼容问题（对齐 v8
 * 移除 DEMOLISH 的先例）；新增错误码 MARCH_NOT_RECALLABLE。
 * v14：军队持续耗粮接入。CityView 新增 armyFoodUsePerHour（全军小时耗粮：城内驻军
 * 1 倍 + 行军中/野地驻军 2 倍，单兵 foodUse 见兵种表，占位数值未经评审）；粮的懒结算
 * 改为净产量（production.food − armyFoodUsePerHour，production.food 语义不变仍为毛产量），
 * 粮食扣到 0 为止：断粮仅停止增长，部队不解散、不记负债。其余四种资源结算不受影响。
 * v15（AISLG-2 战斗与耗粮数值评审定稿）：战斗结算语义调整——行动顺序改为全体兵堆
 * 按速度降序分档、同速档同时结算（互无先手差）；兵堆保留余伤（不足单兵生命的伤害
 * 累计折算，伤害不再按下限取整）；攻城守方「据墙待敌」：城墙位（战场终端）守方
 * 受击减免、敌方逼近时原地等待、够不到且敌方全部驻足时才出城迎击（离墙失减伤，
 * 修复守方纯近战被远程无风险压制的结构问题）；回合耗尽战败的幸存部队撤回出发城
 * （march_completed 的 battle_lost 详情新增 returning 字段 = 返程行军 id 或 null；
 * 攻方全灭时幸存为 0、无返程）。兵种属性 / 判定链概率 / 战场长度（120）/ 城墙减伤
 * （每级 5%）等数值经固定种子批量模拟评审定稿（评审记录 docs/battle-calibration.md）；
 * 耗粮数值评审通过、维持 v14 量级。协议字段只加不改（战报结构不变，endReason 的
 * round_limit 语义补充为「攻方未能突破，幸存部队撤回」）。
 * v16（AISLG-4 仓库防掠夺保护与掠夺结算）：MARCH 新增可选 data.task（'plunder' 掠夺 /
 * 'occupy' 占领，缺省 'plunder'——对 v15 及以前不带 task 的请求是已确认的破坏性语义
 * 变更：旧式不带 task 的出征将从「战斗并占领」变为「掠夺」）。MarchView.purpose 新增
 * 'plunder' / 'occupy' / 'reinforce'（增援自有野地不再记 'attack'）；'attack' 仅保留给
 * 升级前已发出的在途行军结算（legacy 战利品：金币 + 地形资源、NPC 全额库存并占领）。
 * 野地掠夺：胜利仅得地形资源 250×等级（无金币），按幸存部队负重（Σ 数量×单兵 carry，
 * 新增兵种属性 carry）装填并立即入账出发城，不改归属、幸存部队返程；成功掠夺的地块
 * 进入 24 小时冷却（world_tiles.plundered_at，GET_TILE 新增 tile.plunderedAt 下发；
 * MARCH 发起时校验并返回新错误码 PLUNDER_COOLDOWN，在途到达仍战斗但资源为零）。
 * 野地占领：无一次性战利品；该城占领野地数低于官府等级时改归属、幸存驻守并获得
 * 持续加成，发起时初核（新错误码 TERRITORY_LIMIT）、到达复核（超限则胜利后返程，
 * 事件记录 occupied=false / denial=TERRITORY_LIMIT）。NPC 城池本期仅开放掠夺（task=
 * 'occupy' 返回新错误码 TASK_INVALID_FOR_TARGET）：按负重从持久化库存扣减四资源、
 * 金币不可掠夺、库存不再生。仓库保护规则落地共用层（保护量 4000×等级、四资源固定
 * 均分各 1000×等级）；玩家城池仍不可攻击（TARGET_NOT_ATTACKABLE），仓库保护的真实
 * 消费方随玩家对抗阶段接入。march_completed 事件新增 outcome 'plunder_won' 与
 * task / carry / occupied / denial 字段；占位值与评审曲线见 docs/battle-calibration.md
 * v16 一节（npm run calibrate:plunder）。
 * v17（线上 v16 回归 AISLG-11/12/15/16）：非法帧响应形态明确——INVALID_MESSAGE 响应
 * 帧 op 恒为 0，帧内可解析出数字 seq 时原样回带（此前不回带，客户端无法对账）；
 * op 非整数（如 21.5）从 UNKNOWN_OP 改判 INVALID_MESSAGE，不再把非整数原样回显进
 * 响应帧。GET_WORLD_MAP 的 w/h 语义明确为「1..20 的整数，非法或越界视为未提供、取
 * 缺省 10，不做钳制放大」（实现侧魔法上限 40 与文档 20 不一致，统一为 MAX_MAP_WINDOW；
 * 起点坐标仍按世界边界钳制）。GET_STATE 的 city.territory[].garrison 修复为恒 number
 * （sum 聚合的 int8 被 node-postgres 解析成字符串导致有驻军时变 string，AISLG-11；
 * 文档语义不变，属实现对齐修复）。NPC 城池的 tiles[].garrison / tile.garrison 修复为
 * 侦察门控（AISLG-14）：未侦察为 0（与 garrisonDetail 全 0、npc=null、scoutedAt=null
 * 一致；此前未经侦察即返回真实驻军总数，与侦察设计冲突），已侦察为最近一次侦察快照的
 * 总数；GET_WORLD_MAP / GET_TILE / PUSH_TILE_STATE 三条路径一致（查询联表请求账号的
 * scout_intel）。野地与玩家城池的驻军保持实时可见（设计不变）。
 * v18（AISLG-21 战斗信息透明度）：公开七兵种单兵战斗属性表（hp/atk/def/speed/range/
 * marchSpeed，生成器直引战斗引擎定稿常量 TROOP_STATS）——agent-api.md 新增「兵种与
 * 战斗属性」一节、agent-api.json 新增 manifest.troops。战斗算法的公式细节从对外文档
 * 移除（伤害公式、判定链数值与顺序、城墙减伤比例、战场长度、回合上限值），术语表
 * 「战斗」与 city.defenseBonus 改为定性描述——机制可见、公式不可见（产品决策）。
 * 参考战力定位降级为「规模粗估、不构成胜负预测」（nativePower 与 GET_TILE 的 Agent
 * 提示改道：兵种属性表 + 侦察快照 + 战报复盘）。战斗结算行为与战报结构无任何变化。
 * 另补文档缺口（AISLG-22）：city.population 写明「current ≥ cap 停止增长」的既定规则
 * （新号 50/0 不增长、建民房后恢复），仅文档澄清，行为不变。
 * v19（设计中数值评审 AISLG-17/18/19/20/22）：经济与野地数值校准——人口上限 =
 * 50 + 100×民房等级×(等级+1)（无民房基线 50，新号 50/50 满编，不再出现 50/0）；
 * 人口增速 = 10×民房等级×(等级+1)/小时（无民房为 0，升民房同时改善上限与增速）；
 * 官府产金 10 → 100×等级/小时；新增金矿地形 gold_mine（占领加成 100×等级/小时产金，
 * plunder 奖励池为空——金币仍全局不可掠夺，只可占领生息）；其余地形占领加成 ×10
 * （60~120/等级/小时）与驻军采集 0.1 → 1×等级×兵力/小时；野地掠夺奖励池 250 →
 * 1500×等级（legacy 在途 attack 战利品维持 250×等级不变）；NPC 袭击默认间隔
 * 5 分钟 → 30 分钟。协议面只加不改：tiles[].terrain / tile.terrain 新增取值
 * 'gold_mine'，tile.wilderness.resource / territory[].resource 新增取值 'gold'；
 * growthPerHour / bonusRate / 奖励池等为数值变化，字段结构不变。
 * v20（AISLG-38 全局时间缩放）：运行时开关 time_scale（settings 表，API 与 Worker
 * 共享、缓存 TTL 刷新、切换无需重启；默认 50，设 1 恢复正常节奏）——耗时类数值
 * = 基准 ÷ scale（钳 1 秒下限）：建造/升级（基准 60s×等级）、征兵（基准各兵种
 * unitSeconds）、行军（基准 15s/格）、掠夺冷却（基准 24h）、NPC 袭击间隔（基准
 * 30min）；速率类 = 基准 × scale：城池产出（productionPerHour 聚合出口）、人口
 * 增长（growthPerHour）、军队耗粮（armyFoodUsePerHour，与产出同幅保持经济关系）。
 * 只作用于新发起的任务与下一次惰性结算，存量 due_at 不重算。协议消息结构无变化，
 * 各时长/速率字段的「实际值」语义随配置变化，文档数值为未加速基准（scale=1）。
 * v21（线上回归 AISLG-27/23/35 + 再开批 AISLG-28~37 数值与协议演进）：
 * ——实现对齐修复（AISLG-27）：征兵队列激活事件（recruit_started 且
 * detail.fromQueue=true）的 detail 补齐 cost / population——文档 v11 起即承诺
 * 「征兵开始/入队含 { troop, count, cost, population }（队列激活时另含 fromQueue:
 * true）」，此前激活路径漏带两字段（build_started 激活事件一直正确），字段只加不改。
 * ——文档勘误（AISLG-23/35，行为不变）：术语表「仓储上限」公式更正为「对应资源
 * 建筑产量（不含无建筑的 100/h 基础产量与野地占领加成）× 100」；MARCH task=occupy
 * 段删除过期残留「当前为 1」。
 * ——经济与袭击数值（AISLG-28/31，再开批设计方案）：野地占领加成改为「固定基线 +
 * 等级 × 每级增量」（Lv1 合计 = v19 同值 60~120/h，高等级收敛，低等级不再有负收益
 * 区间）；NPC 袭击间隔 30 → 120 分钟、袭击编成 义兵 15×等级 + 弓箭兵 2×等级
 * → 义兵 10×等级 + 弓箭兵 1×等级（参考战力 40×等级 → 25×等级，编成公式对文档
 * 公开并给出防御口径 ≥ 4×编成战力）；掠夺奖励池加入金币——野地池 = 地形资源
 * 750×等级 + 金币 250×等级（金矿保持空池）、NPC 城持久化库存含金币，装填顺序
 * 粮→木→石→铁 → 金→粮→木→石→铁；开局资源 5000×5 → 800×5。
 * ——NPC 袭击目标池扩展（AISLG-32 方案 A）：袭击目标 = 已占领野地（80%）+ 官府
 * ≥ 2 的玩家主城（20%）：主城袭击走守城战（城墙 defenseBonus 生效，战报新增
 * kind='city_raid'），攻破后按被掠城仓库保护结算掠夺（可掠量 = max(0, 存量 −
 * 1000×仓库等级/资源)，金币不享受保护；plunder.ts 新增 cityPlunderPool）——城墙
 * 与仓库两个占位建筑自此有真实消费方；事件 npc_raid 新增 target / level 字段
 * （主城被掠另含 loot）。
 * ——战报口径字段（AISLG-33/30，只加不改）：BattleSideView 新增 units（总单位数）、
 * totalHp（总血量）、avgRange（编成平均射程，1 位小数），读取时按 troops 汇总、
 * 历史战报同样下发；文档新增「编队指南」与「伤害→减员」定性口径。
 * ——推送可观测性（AISLG-37，只加不改）：所有 PUSH_* 帧新增顶层 eventId（账号
 * 维度单调递增，同一次扇出各连接同值，客户端按已见最大 id 幂等去重）； 
 * PUSH_AGENT_STATUS 改为 online 翻转才推送并新增 connectionCount 字段。
 * ——文档显式化（AISLG-36/34）：BUILD / UPGRADE / RECRUIT 等失败响应说明统一注明
 * 「data 仅含 city，无成功载荷字段，先判 ok」，补齐多个 op 的失败示例；city.buildings
 * / city.farms 标注 DEPRECATED（v3 遗留），说明 city.level 与 levels.government 关系。
 * v22（AISLG-40~43 线上 v21 回归批次）：主城袭击强度锚点从官府等级换到守军战力
 * （level = clamp(ceil(守军战力/25), max(1, 官府/2), 官府等级)）+ 攻破后免战期
 * （cities.truce_until = 2×袭击基准间隔÷timeScale，免战内不入目标池、CityView 新增
 * city.truceUntil、npc_raid 事件 detail 附 truceUntil）；储量上限随全局缩放
 * （storageCaps × timeScale，含金币上限——填满时长恢复基准 100h/2500h，AISLG-41）；
 * UPGRADE 新增可选 toLevel 连续升级（整链按各级公式价预扣、占 1 个队列位、Worker
 * 逐级推进 build.level、build_completed 每级一条；BuildView 新增 toLevel、响应附
 * chain 计划，builds 表新增 to_level 列）；资源 / 人口不足与掠夺冷却的失败响应新增
 * shortfall + retryAfterSeconds（BUILD/UPGRADE/RECRUIT/EXCHANGE/MANCH PLUNDER_COOLDOWN，
 * 按当前净产量 / 增速 / 冷却截止推导，等满重发必然成功）；新增 EXCHANGE（op 37）
 * 集市兑换（四资源按 4:1 换金，AISLG-42 满级后的可持续资源出口）与
 * resource_exchanged 事件。修复 AISLG-39：征兵时长的 1 秒下限从单兵层级改到批次
 * 总时长（max(1, 单兵基准 × 数量 ÷ time_scale)），与建造路径同模型——高缩放比下
 * 批量征兵不再被逐兵钳 1 秒拖慢数倍。
 * v22 补丁（AISLG-38 复核，消息结构不变、不 bump）：行军与升级同样改为「先算总时长
 * 再 ÷ time_scale、钳 1 秒」——此前行军按每格先钳 1 秒再乘格数（scale ≥ 8 时每格恒
 * 1 秒，50 倍速实际只有 15 倍、10 倍速反而偏快）、升级按每级先取整再乘等级；免战时长
 * 在 NPC_RAID_INTERVAL_MS 显式覆盖时不再二次缩放。Agent API 文档示例改按未加速基准
 * 渲染（此前产量 / 储量 / 行军示例被默认 50 倍放大，与文档声明不符）。
 * v22 补丁 2（AISLG-51，消息结构不变、不 bump）：行军结算推送去重——march_resolved 的
 * notify 直推与水位线轮询双路覆盖同一条结算，此前各广播一次生成两个 eventId，客户端
 * 按 eventId 去重会把一次到达 / 返程当成两次；现同一 (marchId, resolved_at) 只广播一次。
 * v23（AISLG-49 战报射程口径 + 二期批次 AISLG-52~62）：
 * ——战报射程口径（AISLG-49，只加不改）：BattleSideView 新增 maxRange（编成单兵射程
 * 最大值）与 rangedUnits（射程 > 近战基准 10 的单位数，当前即弓箭兵），读取时按
 * troops 汇总、历史战报同样补齐；avgRange 字段说明明确「数量加权平均会被近战稀释，
 * 不代表克制关系」。
 * ——侦察报告可见（AISLG-62，前端为主）：GET_TILE 的 tile.scoutedAt 由「仅 NPC 城池」
 * 扩展为「任意侦察过的地块」都返回（字段原本就有，语义补全，无新增字段）。
 * ——Agent 作战方针（AISLG-52）：新增 SET_AGENT_DIRECTIVE（op 38，仅玩家连接；stance
 * 四选一 + minTroops 出征最低兵力 + note 补充说明，三段独立更新）与推送
 * PUSH_AGENT_DIRECTIVE（op 2008，推给账号全部在线连接含 Agent）；agent_directives 表
 * 保存账号级快照，GET_AGENT_INFO 新增 directive 字段；服务端只存储与转发，不校验
 * Agent 是否照做。RESET_ACCOUNT 一并清空。
 * ——战报 Agent 点评（AISLG-53）：新增 AGENT_COMMENT_REPORT（op 39，仅 Agent 连接；
 * reportId + text 1..200，一份战报最新一条、重写覆盖）与推送
 * PUSH_BATTLE_REPORT_COMMENT（op 2009）；battle_reports 新增 agent_comment /
 * agent_commented_at 列，BattleReportView 新增 comment 字段（读取时合并，历史战报
 * 为 null）。
 * ——离线日报（AISLG-54）：新增 GET_OFFLINE_REPORT（op 41）与 AGENT_DAILY_REPORT
 * （op 40，仅 Agent 连接，1..500 字重写覆盖）；accounts 新增 last_online_at（玩家的
 * 最后一条玩家连接断开时写入），离线数字汇总按该时刻从事件流统计（收获 / 战斗 /
 * 减员 / NPC 袭击 / 失地 / 仓库水位），Agent 日报平时写好、上线直读。
 * ——NPC 城库存档位（AISLG-55，只加不改）：TileView 新增 npcStockTier（rich >60% /
 * normal 20%–60% / low <20% / empty 已空，相对该城初始库存；非 NPC 城为 null），
 * GET_WORLD_MAP / GET_TILE / PUSH_TILE_STATE 三条路径一致；只给档位不给精确数值，
 * 精确库存仍走 SCOUT。
 * ——NPC 袭击预警（AISLG-57）：袭击改为「发起（固定编成）→ 预警提前量 = 袭击基准
 * 间隔的 1/8（缩放后约 15 分钟）→ 到达结算」两阶段；新增 npc_attacks 表、事件
 * npc_attack_warning 与推送 PUSH_NPC_ATTACK_WARNING（op 2010，兵力给 ±20% 范围）；
 * 预警期间增援的部队在到达结算时一并参战，目标被召回 / 易主 / 免战则袭击作废。
 * ——野地连片加成（AISLG-59，数值不变仅新增口径字段）：territoryRates 按同地形 +
 * 上下左右相邻的连通块加成（3–4 块 +10% / ≥5 块 +20%，逐块取整），产量即算即得、
 * 占领 / 失守自动重算；CityView.territory[] 新增 clusterSize / clusterBonusPercent。
 * ——全服播报（AISLG-60）：新增 GET_SERVER_BROADCASTS（op 42）与
 * PUSH_SERVER_BROADCAST（op 2011，全服广播）；server_broadcasts / win_streaks 表，
 * 当前四类大事（NPC 城掠空 / 金矿首占 / 主城被攻破 / 1 小时内连胜 5 场），
 * 全服每分钟最多 3 条、超出丢弃，断线重连可查最近若干条。
 * ——全服排行榜（AISLG-61）：新增 GET_LEADERBOARD（op 43；power 综合战力 /
 * territory 领地数量 / plunder 累计掠夺量三榜，前 50 名 + 我的名次）；Worker 每
 * 10 分钟整榜重算快照（leaderboard_snapshots），accounts 新增 plunder_total 台账
 * （掠夺入账时累加四资源合计，重置清零）；agentOnline 按查询时刻连接实时标注。
 * v24（AISLG-48 野地难度 + AISLG-58 城池等级与分城）：
 * ——野地守军新曲线（AISLG-48，数值变更，字段不变）：开局五资源 800 → 2000；野地原住
 * 守军 Lv1–2 纯义兵 8×等级、Lv3 起义兵 6×等级 + 弓箭兵(等级−2)，每块在基准上按坐标
 * 固定 ±20% 浮动（侦察可见具体数量）；战后守军存量落库（native_garrison_state），
 * 每小时惰性恢复基准的 25%（随时间缩放），占领后作废、失守回到野地重新满编；
 * tile.nativePower 随之按当前存量计算。文档新增「野地进攻口径」表（战斗引擎固定种子
 * 模拟生成：推荐兵力 2 倍 / 3 倍、胜率、期望净收益），数值调整后随文档重新生成。
 * ——城池等级 = 官府等级（AISLG-58）：CityView.level / cities[].level 不再恒为 1。
 * ——多城操作（AISLG-58，只加不改）：GET_STATE / BUILD / UPGRADE / RENAME_CITY / RECRUIT /
 * EXCHANGE / MARCH / SCOUT 新增可选 data.cityId（缺省主城，非本账号的城 INVALID_PARAMS）；
 * CANCEL_BUILD / CANCEL_RECRUIT 按条目所属城池定位；BuildView / RecruitView 新增 cityId；
 * GET_STATE 响应新增 branch { count, limit, minGovernment }。分城各自独立结算资源 / 人口 /
 * 仓储 / 队列 / 驻军；调兵并入目标分城的 city_army（不再落地块驻军）。
 * ——占领 NPC 城变分城（AISLG-58）：MARCH task=occupy 对 NPC 城池放行（不再返回
 * TASK_INVALID_FOR_TARGET）：主城官府 ≥ 3 级、分城数 < floor(主城官府 ÷ 3)、目标等级 ≤
 * 出发城官府等级，新增错误码 GOVERNMENT_TOO_LOW / BRANCH_LIMIT / TARGET_LEVEL_TOO_HIGH；
 * 到达时 Worker 复核（不满足则不转城、幸存部队返程，battle_won 事件记 denial），成功后
 * 分城接收 NPC 城的建筑与剩余库存、幸存部队进城驻守。
 * ——名城（AISLG-56，只加不改）：全图 8 座 Lv3 NPC 城原地升格为名城（famous_cities 登记
 * + NPC 快照 famous 标记，不重生成地图）。TileView 新增 famous { name, stage, bonusPercent,
 * recoversAt }；两阶段攻打：外围阶段出征打外围驻军（无战利品，清空后进入城守阶段，
 * battle_won 含 stage='outer' / outerCleared / recoversAt），城守阶段限时内（6 小时 ÷
 * 时间缩放，超时外围恢复满编，惰性推导）攻城守——plunder 掠夺库存、occupy 占领变分城
 * （以名城命名，cities.famous_name 标记，该城产量 +20%，CityView 新增 famousName /
 * productionBonusPercent）；外围未清时 occupy 返回新错误码 OUTER_NOT_CLEARED。守军 =
 * 同级普通 NPC 城 × 3（外围与城守各 × 1.5）。侦察名城按当前阶段给守军 / 城墙口径，
 * ScoutIntel 新增可选 famous { name, stage }。
 * v25（AISLG-71 建造时长下发，只加不改）：city.costs（KindActionCosts）每类型新增
 * buildSeconds / upgradeSeconds（秒，按当前全局时间缩放折算后的单级时长；null 语义
 * 与对应成本字段一致），供客户端在建筑详情里展示「建造 / 升级要多久」，不必本地
 * 镜像时长公式。
 * v26（AISLG-79 自有城池间运输，只加不改）：MARCH 新增 task='transport' 与必填 cargo
 * （{gold,wood,food,stone,iron} 非负整数，总量 ≥ 1 且 ≤ 编队负重）；目标只能是本账号另一座城
 * （其余 TASK_INVALID_FOR_TARGET）。发起即扣出发城资源，到达后货物即时入账目标城（不钳
 * 储量上限），部队自动返程；撤回 / 目标失效时货物随部队带回出发城。MarchView 新增
 * cargo（运输及其返程行军为 Resources，其余 null）、purpose 新增 'transport'；新增错误码
 * CARGO_OVER_CAPACITY；事件 march_completed 新增 outcome='transported'（出发城）与
 * 'transport_received'（目标城）。marches 表新增 cargo 列。
 * v27（AISLG-77 科技研究，只加不改）：新增建筑 academy 书院（BUILD / UPGRADE 的 kind 取值、
 * CityView.levels / buildings 键集扩为十种）；新增 GET_TECHS（op 44）/ RESEARCH_TECH（op 45）/
 * CANCEL_RESEARCH（op 46）与推送 PUSH_TECH_STATE（op 2012）；GET_TECHS / RESEARCH_TECH 支持
 * 可选 cityId（指定用哪座城的书院）。科技账号共享、同一时间只研究一项：6 项（farming 农耕 /
 * carrying 负重 / marching 行军 / storage 储存 / scouting 侦察 / defense 城防），每项最高
 * 10 级，第 N 级要求发起城书院 ≥ N 级；成本 = 基础 × N、耗时 = 建造基准 × 2 × N（随
 * 全局时间缩放）。效果：农耕 / 储存每级 +5% 四资源产量 / 储量上限（已计入 CityView.production /
 * storage）、负重 / 行军每级 +5%（掠夺与运输负重、出征 / 侦察 / 返程行军时长）、城防每级
 * +1% 主城守城减伤（已计入 defenseBonus）、侦察决定情报详细度（ScoutIntel 新增 detail /
 * garrisonTotal，TileDetailView.npc 新增 scoutDetail / garrisonTotal：Lv0–2 只给总兵力约数、
 * Lv3–5 兵种近似、Lv6+ 精确——对既有侦察结果的精度是收紧）。CityView 新增 techs（账号科技
 * 等级）。新增错误码 TECH_LEVEL_MAX / RESEARCH_IN_PROGRESS / ACADEMY_TOO_LOW /
 * RESEARCH_NOT_CANCELLABLE，事件 research_started / research_completed / research_cancelled；
 * account_techs / tech_research 表，RESET_ACCOUNT 一并清空。
 * v28（AISLG-78 移动目标，只加不改）：地图上周期性刷出沿固定路线移动、过时消失的流寇与运粮商队。
 * 新增 GET_MOVING_TARGETS（op 47：位置 / 公开路线与时刻表 / 守军与携带量的大致范围）与全服推送
 * PUSH_MOVING_TARGET_STATE（op 2013：spawned / defeated / expired）；MARCH 新增可选 targetId
 * 截击——(x, y) 须是目标路线上尚未过去的格，到达时目标在该格或相邻格才接战，否则扑空返程；
 * MarchView 新增 targetId、purpose 新增 'intercept'；战报 kind 新增 'intercept'，未接战结果
 * （扑空 / 目标消失）contact='missed'|'gone' 且 endReason='no_contact'；新增错误码
 * MOVING_TARGET_GONE、事件 bandit_plundered（流寇路过玩家野地掠夺）与 march_completed 的
 * outcome=intercepted / intercept_lost / intercept_missed / intercept_gone；moving_targets 表、
 * marches.target_id 列。存在时长基准 6 小时、数量随活跃玩家数（24 小时内登录）调整。
 * v29（AISLG-76 黄巾之乱，只加不改）：全服共同清剿的周期事件（基准每 3 天起事、48 小时时限）：起事（营地按
 * 活跃玩家数定数量、小 / 中 / 大三档对应野地 Lv3 / 6 / 9）→ 坐大（每 6 小时升一档、大营每 3 小时向 40 格内
 * 玩家发兵，走既有 NPC 来袭预警）→ 清剿（MARCH 掠夺任务打营地、战后存量每小时恢复 25%、按负重掉落）→ 清掉
 * 80% 后出现张角老巢（外围 + 城守两段）→ 收场（老巢被打掉或到时限，没清完的营地散成流寇，接 AISLG-78；
 * 按歼敌贡献名次发奖）。新增 GET_YELLOW_TURBAN（op 48）与全服推送 PUSH_YELLOW_TURBAN_STATE（op 2014）；
 * TileView 新增 camp（地块上的营地 / 老巢信息）；战报 kind 新增 'yellow_turban'；全服播报新增 yt_started /
 * yt_grown / yt_boss / yt_boss_first_kill / yt_finished（必达、不受每分钟限频）；事件 yt_reward、
 * march_completed 的 outcome=camp_won / camp_lost / boss_outer_cleared / boss_won；yt_events / yt_camps /
 * yt_contrib 表。营地格 MARCH task=occupy 返回 TASK_INVALID_FOR_TARGET。
 * v30（AISLG-80 校场 + AISLG-81 烽火台 + AISLG-82 箭塔 + AISLG-83 驿站，只加不改）：新增四种建筑
 * parade_ground / beacon / post_station / arrow_tower（BUILD / UPGRADE 的 kind、CityView.levels /
 * buildings 键集扩为十四种）。校场：本城同时在外部队数（行军中含返程 + 驻守野地，不计城内驻军）≤
 * 校场等级（未建按 1），MARCH / SCOUT 超限返回新错误码 DEPLOY_LIMIT（上线前已在外的部队不受影响），
 * CityView 新增 deploy { count, limit }。烽火台：NPC 来袭预警提前量每级 +10%（10 级翻倍）、敌情 0–2 级
 * 兵力范围 / 3–5 级各兵种范围 / 6+ 级精确——PUSH_NPC_ATTACK_WARNING 新增 intel / beaconLevel /
 * armyKinds / army（对被袭击城即预警所属城，含黄巾大营的进攻）。驿站：自己城池之间的调兵 / 运输
 * （含运输返程）行军速度按出发城驿站等级每级 +10%。箭塔：守城战（NPC 袭击主城）城墙位上不会被消灭的
 * 远程单位，每回合固定伤害 150 × 等级、射程 45 + 5 × 等级；CityView 新增 tower { damage, range } | null，
 * 战报新增 towerDamage 与 roundLog[].towerDamage（数值校准见 docs/battle-calibration.md）。
 * v31（AISLG-85 建筑等级上限 10 → 20，只加不改）：MAX_BUILDING_LEVEL 改为 20，UPGRADE toLevel 上限、
 * BUILDING_LEVEL_MAX 口径随之；升级成本与耗时的倍数由「× 当前等级」改为 upgradeLevelFactor：1~9 级仍为 L
 * （前期成本 / 耗时不变），L ≥ 10 时 = 9 × 1.3^(L − 9)（Worker 排队激活 SQL 同公式）；城墙减伤前 10 级每级
 * +5%、11~20 级每级 +2%（city.defenseBonus 随之，20 级 = 70，加城防科技满 +10 = 80 < 引擎封顶 90）。
 * v32（AISLG-91 Agent 及时知道文档更新，只加不改）：LOGIN 请求新增可选 docVersion（Agent 手上文档的
 * 协议版本，非正整数视为未提供），响应新增 protocolVersion（恒有）与 docNotice（仅 Agent 连接：
 * 文档落后或未带 docVersion 时为提示文本，否则 null；玩家连接恒 null）；新增 HTTP
 * GET /agent-api/changes/{since}（亦接受 ?since=）返回 since 之后每个版本的一句话摘要
 * （protocol-changelog.ts，此后每次 bump 必须补一条）；文档开头新增「Agent 必读：保持文档最新」。
 * v33（AISLG-86 冲车 + AISLG-87 兵种克制 + AISLG-88 辎重车 + AISLG-89 床弩 + AISLG-90 铁骑兵，只加不改）：
 * 兵种清单由 7 种扩为 11 种（TroopKind / city.army / MARCH.troops 键集新增 iron_cavalry / supply_wagon /
 * ballista / siege_ram；军营 11 / 3 / 7 / 8 级解锁，单兵人口不再恒为 1）；兵种属性表与 manifest.troops 新增
 * barracksLevel / carry / population / counter。克制倍率表集中在共享规则（troop-counter.ts）：长枪兵打
 * 轻骑 / 铁骑伤害 ×1.2，刀盾兵受弓箭兵 / 床弩攻击伤害 ×0.8。冲车破墙：只在攻城战生效，冲车每占攻方存活总兵数
 * 1% 使城墙减伤相对降低 8%（最多 80%，每回合按存活冲车重算）；战报新增 wallBreak { from, to }（开战时）。
 * 辎重车负重 5000 计入掠夺 / 运输负重；行军时间按全编队最慢兵种（冲车 / 床弩 0.6、辎重车 0.7）折算。
 * v34（AISLG-107 断粮哗变，只加不改）：城池粮食为 0 且净产量为负时，每小时（随倍速缩放）该城城内驻军每兵种
 * 减 10%（向上取整、至少 1；没有逃兵系统），在外部队不强制召回、耗粮照常计入，恢复即停——取代 v14「断粮仅
 * 停止增长」的旧口径。CityView 新增 starveAt（预计断粮时间，不会断粮为 null）/ mutinyNextAt（下次哗变时刻）；
 * 新增推送 PUSH_STARVATION_STATE（op 2015：warning 距断粮不足 1 小时一次、mutiny 每次哗变一条）与事件
 * starvation_warning / mutiny；GET_OFFLINE_REPORT 的 offline 新增 mutinyLost；cities 表新增 mutiny_next_at /
 * starve_warned_at；Worker starvation-tick.ts 周期扫描结算。
 * v35（AISLG-112 截击「到了先埋伏」，只加不改）：截击部队提前到达选定格时不再扑空，而是原地埋伏等目标走进
 * 相邻范围（Chebyshev ≤ 1）再开打——目标路线与时刻表固定，发起时即把 marches.arrive_at 顺延为预计接战时刻 =
 * max(到达时刻, 目标进入相邻范围的时刻)；到达时目标已走出范围（太晚）仍照旧扑空返程。MarchView 新增
 * ambushAt（埋伏开始时刻，非埋伏行军为 null；此时 arriveAt 语义 = 预计接战时刻）、march_started 事件 detail
 * 同步新增 ambushAt；埋伏期间部队照常占校场名额、按在外口径耗粮，可 RECALL_MARCH 撤回，目标被他人击败 /
 * 过时消失照旧「目标消失」返程。marches 表新增 ambush_at 列。
 * v36（AISLG-114/115/116 武将系统，只加不改）：新建筑「酒馆」tavern（每城限一座，4 小时基准随缩放刷新 3 名
 * 候选普通将，招募费 = 500 + 三项属性合计 × 20 金币；账号普通将上限 = ⌈酒馆最高等级 ÷ 2⌉ + 1，名将另算上限 3）。
 * 新增 GET_HEROES / RECRUIT_HERO / DISMISS_HERO / ASSIGN_HERO（op 49–52）与推送 PUSH_HERO_STATE（op 2016）；
 * MARCH / SCOUT 请求新增可选 heroId 随队武将（同一武将同一时间只能在一支部队里，城守不能出征；MarchView 新增
 * heroId）。带兵加成：全军攻击 + 武力 × 0.3%、受到伤害 − 智力 × 0.3%（各封顶 20%），能吃到加成的兵数 = 统率 × 20、
 * 超出按比例摊薄；叠加顺序 基础伤害 → 兵种克制 → 武将加成 → 城墙减伤；战报双方新增 hero 字段。俸禄每小时从主城
 * 扣（普通将 20 × 等级 / 名将 100 × 等级金币），金币不足「欠饷」不能出征、扣款成功自动恢复；带队战败重伤 2 小时
 * （随缩放）不能出征、不会死亡。经验与成长（AISLG-116）：带队参战 / 城守守城获得经验 = 歼灭敌军参考战力（战败
 * 减半），升到 L+1 需 100 × L²，每级三项属性 +1（名将 +2），上限 20 级；march_completed 事件新增 heroExp。
 * 名将（AISLG-115）：8 座名城各绑一名（首占获得）、黄巾老巢首杀得张角、贡献榜前二得张宝 / 张梁——全服唯一
 * （解雇后回到可获得状态），获得时全服播报 hero_granted；GET_HEROES 的 famousClaims 公开归属。城守
 * （ASSIGN_HERO）：守城战享攻防加成、平时该城四资源产量 + 智力 × 0.1%（封顶 5%，CityView 新增 guard）。
 * 新错误码：TAVERN_NOT_BUILT / HERO_CANDIDATE_GONE / HERO_CAP_REACHED / HERO_NOT_FOUND / HERO_BUSY /
 * HERO_WOUNDED / HERO_ARREARS / GUARD_ASSIGN_DENIED；新事件：hero_recruited / hero_dismissed / hero_arrears /
 * hero_wounded / hero_level_up / hero_granted / guard_changed；新表 account_heroes / tavern_candidates /
 * famous_heroes，cities 新增 guard_hero_id、marches 新增 hero_id。
 * v37（AISLG-105 缺陷修复，只加不改）：连续升级（UPGRADE toLevel）整链的 build_started / build_queued 事件 detail 新增
 * toLevel（链终点）——此前事件里 cost 是整链总额、level 是首个推进等级却没有终点，Agent 无法对账。队列激活产生的
 * build_started（fromQueue=true）同样带 toLevel。
 * v38（AISLG-122 玩家对抗一，只加不改）：开放玩家之间互相攻打的第一步——可以侦察、掠夺其他玩家的城池（主城与
 * 分城都行，不用宣战），同时上一套硬性保护：守城战复用 NPC 袭城口径（城墙 + 城防科技 + 箭塔 + 守方城守），发起即
 * 给守方推 PUSH_ATTACK_WARNING（op 2017，预警窗口 = 行军时长，敌情按守方烽火台分档）；掠夺可抢池 = 仓库保护 →
 * 单次比例上限（四资源 30% / 金币 10%）→ 等级差衰减（出发城官府比目标城官府高 5 级起每多 1 级 −15%、最低 25%），
 * 仍受负重装填；攻破后该城被动免战 4 小时（基准随缩放，玩家与 NPC 共用 cities.truce_until）；战报 kind='pvp_raid'
 * 攻守双方各一份。保护：新手保护（注册后 3 天或任一城官府升到 5 级先到为准，期内别人不能侦察 / 攻击——SCOUT 与
 * MARCH 返回 NEWBIE_PROTECTED；他自己侦察 / 攻击其他玩家立即失效，事件 newbie_protection_ended；NPC 袭击目标池
 * 同样跳过）；主动免战 TRUCE（op 53，无参数）：每周一次免费、持续 12 小时（基准随缩放），开着时别人打不了他
 * （TARGET_IN_TRUCE）、他也不能出兵打玩家（SELF_TRUCE_ACTIVE，打野地 / NPC 不受限）；CityView 新增 newbieUntil /
 * shieldUntil / shieldNextAt；TileView 新增 protection（他人城的三个保护截止时刻）；SCOUT 侦察玩家城读 city_army
 * 驻军与城墙减伤；accounts 新增 newbie_until / self_truce_until / self_truce_used_at 列；新事件 player_attack_warning /
 * pvp_raid / truce_started / newbie_protection_ended。占领玩家城随后续阶段开放（occupy 对玩家城
 * 仍返回 TASK_INVALID_FOR_TARGET）。
 * v39（AISLG-123 玩家对抗二，只加不改）：开放抢占其他玩家占领的野地——MARCH task='occupy' 对他人野地受理（缺省
 * plunder 返回 TASK_INVALID_FOR_TARGET，地里没有存货可抢）。战斗为野地战（非 siege：无城墙 / 箭塔 / 城守），守方 =
 * tile_army 驻军，攻方可带随队武将；守方没留驻军不打、直接拿下（无战报）。发起即给守方推 PUSH_ATTACK_WARNING
 * （op 2017 新增 target='wilderness'，敌情按其所属城烽火台分档，预警期间可增援该地块）。打赢且出发城占领名额（官府
 * 等级）有空 → 地块易主、幸存部队驻守、地块进入换主保护 1 小时（基准随缩放，world_tiles.owner_changed_until：期间
 * 玩家抢占与 NPC 袭击都跳过，MARCH 返回 TILE_PROTECTED）；名额已满 → 守方照样失地（wilderness_lost cause=conquest）、
 * 地块变无主（不设保护）、攻方幸存返程。守方新手保护 / 主动免战期间其全部野地不可被抢（NEWBIE_PROTECTED /
 * TARGET_IN_TRUCE）；守方某座城的被动免战只保护城本身、不保护野地；自己新手保护期内抢野地立即破保，主动免战中
 * 不能抢（SELF_TRUCE_ACTIVE）。到达时锁内复核（口径见 MARCH 文档）：地块已无主 / 易主第三人 → 扑空返程
 * （aborted，cause=target_gone / owner_changed）；已归本账号 → 转增援。战报 kind='pvp_wilderness' 双方各一份；
 * TileView.protection 对他人野地同样下发（ownerChangedUntil）；连片加成随 territory 读取自然重算。
 * v40（AISLG-124 玩家对抗三，只加不改）：开放占领其他玩家的**分城**——MARCH task='occupy' 对他人分城受理
 *（主城返回 TASK_INVALID_FOR_TARGET，永不可占），资格与占 NPC 城同口径（GOVERNMENT_TOO_LOW / BRANCH_LIMIT /
 * TARGET_LEVEL_TOO_HIGH，目标等级 = 该城官府等级；到达复核名额，没了照打只降城防值）。分城有城防值（满 100，
 * cities.durability）：守城战打赢一次（守军全灭）−35，攻方幸存冲车占比每 1% 再 +1.5、最多 +15（占比 ≥10% 满额），
 * 归零且名额有空当场换主；占领打赢不掠夺资源、掠夺打赢不降城防；每次打赢进入 4 小时被动免战（免战内不回涨，
 * 结束后每小时回涨 10 至满——占一座分城至少打 3 次隔 8 小时）。换主：建筑（含等级）/ 剩余资源 / 名城加成归新主，
 * 城防回满并保护 6 小时（CITY_CONQUEST_PROTECTION_MS，期间谁都不能打）；该城排队建造 / 征兵 / 该城研究 / 酒馆候选
 * 作废不退资源；城守卸任（武将归原主）；该城野地全变无主、驻军回原主主城；该城在外部队改从原主主城返程；针对该城
 * NPC 袭击作废；原主 city_conquered(outcome=lost) / 新主 outcome=gained + 全服播报 city_conquered。TileView.durability
 *（他人分城当前城防值，非 null 即可被打的分城）与 CityView.durability（自己的分城）下发；战报 kind='pvp_conquest'
 * 双方各一份；march_completed 的 battle_won detail.conquest = { before, damage, ramBonus, after, protectedUntil,
 * transferred? }；PUSH_TILE_STATE reason 新增 city_conquered / city_durability_hit。
 * v41（AISLG-125，规则微调）：NPC 攻破玩家主城时金币可抢量从「存量全额（不享受仓库保护）」改为
 * 「存量 × 5%」（NPC_CITY_GOLD_SHARE，plunder.ts；比玩家互掠的 10% 更轻），仍受 NPC 幸存部队负重
 * 限制；四资源口径不变（存量 − 仓库保护，不加比例上限）。玩家掠夺玩家城维持存量 × 10%
 * （pvpPlunderPool 改基于 warehouseProtectedPool，金币口径不受本变更影响）；玩家掠夺 NPC 城、
 * NPC 袭击野地不受影响。
 * v42（AISLG-126 数值校准拍板落地，模拟记录见 docs/battle-calibration.md「玩家对抗数值校准」）：玩家掠夺玩家城的
 * 单次比例上限四资源 30% → 45%（PVP_PLUNDER_SHARE）、金币 10% → 15%（PVP_GOLD_SHARE）——模拟显示旧值下打赢
 * 同级守军的战损约为战利品 6 倍，「打赢差不多的人」完全不划算；新手保护的官府出保门槛 5 级 → 8 级
 *（NEWBIE_GOVERNMENT_LEVEL；50 倍速下 5 级约 7 分钟即达、保护被「先到为准」架空）。其余数值（被打后免战 4h、
 * 等级差衰减 5 级起每级 −15% 下限 25%、城防值 100/−35/冲车+15/回涨 10/h、野地换主保护 1h、分城换主保护 6h、
 * 主动免战 12h/每周）经模拟量级合理，维持不变。
 * v43（微信扫码登录与 Agent 令牌，docs/wechat-qr-login.md，只加不改）：借用个人微信小游戏做「扫码器」，网页显示带 ticket 的小游戏码，
 * 玩家扫码确认后网页拿到会话令牌再走原有 LOGIN {token}。新增 WX_QR_CREATE / WX_SCAN / WX_CONFIRM / WX_CANCEL（op 54–57，
 * 登录前即可发送——bind 用途的 WX_QR_CREATE 须玩家已登录；后三者仅供微信小游戏，Agent 无需调用）、ISSUE_AGENT_TOKEN /
 * REVOKE_AGENT_TOKEN（op 58 / 59，仅玩家连接）与推送 PUSH_WX_QR_STATUS（op 2018，只推给生成二维码的网页连接）；
 * GET_AGENT_INFO 新增 agentTokens（令牌元信息，不含令牌本身）与 wechatBound。从没绑定过的微信第一次扫码自动建号（随机用户名
 * wx_xxxxxx、无密码——密码登录这类账号一律 INVALID_CREDENTIALS），老账号登录后用 bind 用途绑定。ticket 只存 API 进程内存、
 * 3 分钟有效、一次性，确认须手动点按钮且只接受扫码的那条连接。新增错误码 WX_TICKET_INVALID / WX_CODE_INVALID /
 * WX_ALREADY_BOUND / WX_UNAVAILABLE / RATE_LIMITED / AGENT_TOKEN_LIMIT；新表 wechat_identities，accounts.password_hash 改为
 * 可空，sessions 新增 kind（login | agent_token）与 label 列。
 * v44（Google 一键登录，AISLG-127，只加不改）：网页用 Google Identity Services 拿到 ID Token 后经 GOOGLE_LOGIN（op 60，登录前可发，
 * 仅供网页）换会话令牌再走 LOGIN {token}；没绑定过的 Google 账号自动建号（随机用户名 g_xxxxxx、无密码），已绑定则直接登录绑定账号。
 * GOOGLE_BIND（op 61，仅玩家连接）给当前账号绑定 Google：一号一 Google、一 Google 一号。GET_AGENT_INFO 新增 googleBound；
 * 新增错误码 GOOGLE_UNAVAILABLE / GOOGLE_CREDENTIAL_INVALID / GOOGLE_ALREADY_BOUND（登录尝试按 IP 限频复用 RATE_LIMITED）；
 * 新增 HTTP GET /auth/config（返回 googleClientId / wechatEnabled，前端据此决定显示哪些登录入口）；新表 google_identities。
 * Agent 不使用 Google 登录：纯 Google 账号沿用 v43 的 Agent 令牌接入。
 * v45（GitHub 一键登录，AISLG-128，只加不改）：OAuth 授权码模式（整页跳转）。网页经 GITHUB_AUTH_START（op 62，登录前可发；
 * purpose=login|bind）拿到 GitHub 授权地址并整页跳转；GitHub 授权后回跳 API 的 GET /auth/github/callback，服务端换令牌、
 * 取用户 id/login，login 路径生成 60 秒一次性登录码并 302 回前端，网页用 OAUTH_REDEEM（op 63，登录前可发）换成会话令牌
 * 再走 LOGIN {token}（会话令牌不进 URL，一次性码泄露风险小）；bind 路径直接写绑定后 302 回前端。取消 / 过期 / 重放分别
 * 回 error=canceled / expired / already_bound。第三方身份迁入共用表 oauth_identities（provider 维度；google 自 v45 起读写本表）；
 * GET_AGENT_INFO 新增 githubBound 与 githubLogin；GET /auth/config 新增 githubEnabled；新错误码 GITHUB_UNAVAILABLE /
 * OAUTH_CODE_INVALID / GITHUB_ALREADY_BOUND（GITHUB_AUTH_START 按 IP 限频复用 RATE_LIMITED）。Agent 不使用 GitHub 登录：
 * 纯 GitHub 账号沿用 Agent 令牌接入。
 * v46（永久 Agent 令牌，AISLG-129）：每账号一个永久令牌（sk_ 前缀，agent_tokens 表存哈希 + 原文——随时可再显示是「复制给 AI 的提示词自动带令牌」的前提），建号自动生成、老账号惰性补。新增 GET_AGENT_TOKEN / RESET_AGENT_TOKEN（op 64 / 65，仅玩家连接；查看自动补生成，重置换新并断开旧令牌的在线连接 close 4003）。LOGIN 的 token 先按 sessions 查、查不到再按 agent_tokens（永久令牌登录响应 expiresAt 为 null，LOGOUT 不吊销只断开）。移除 v43 的 ISSUE_AGENT_TOKEN / REVOKE_AGENT_TOKEN（op 58 / 59）、错误码 AGENT_TOKEN_LIMIT 与 GET_AGENT_INFO.agentTokens（令牌不再经 Agent 可调的协议下发）——多令牌体系只在 login 分支存在过、从未上线，删除不涉及兼容；sessions 中 kind='agent_token' 旧行上线清理。
 * v47（双站点 + Agent 令牌-only 登录，AISLG-130）：游戏两个站（slg.example.cn 国内 /
 * slg.yuntianyou.cc 国际）共用同一套服务与数据库、账号通用，按连接访问的 Host 区分站点
 * （握手 Host 头，TRUST_PROXY 时优先 X-Forwarded-Host；连哪个域名就算哪个站，与 Origin 无关）。
 * 国际站整站关闭账号密码登录——LOGIN 密码分支在 PASSWORD_LOGIN_CLOSED_HOSTS（逗号分隔 Host）
 * 列出的站点返回新错误码 PASSWORD_LOGIN_CLOSED（界面按 GET /auth/config 的 passwordLogin=false
 * 隐藏密码表单，绕过界面直发也照样被拒）；国内站照旧。
 * Agent 一律不能用账号密码登录（哪个站都一样），LOGIN 密码分支遇到 asAgent=true 返回新错误码
 * AGENT_PASSWORD_FORBIDDEN，提示改用永久令牌（v46）——密码登录自此只属于玩家本人。
 * GitHub 登录按站点分套（OAuth App 回调地址只能填一个，两站各建一个）：新环境变量 GITHUB_SITES
 * （JSON，键为 Host，另支持 "default" 键）替代旧的 GITHUB_CLIENT_ID 等四变量（仍可用，作 default 套），
 * 授权 state 记发起站点、回调按它选配置套并跳回对应前端；GET /auth/config 的 passwordLogin /
 * githubEnabled 按请求 Host 下发（Google 的已授权来源需在控制台加两个站域名，部署操作）。
 * 协议消息结构无变化，纯登录入口与访问控制调整。
 * v48：关闭密码登录的自动注册——LOGIN 密码分支遇到不存在的用户名不再建号，返回新错误码
 * SIGNUP_CLOSED；新账号只能经第三方登录创建（Google / GitHub / 微信扫码，建号沿用
 * insertAccountWithCity）。移除错误码 USERNAME_TAKEN（并发同名首登注册的错误码，随注册
 * 通道关闭而消失）。协议消息结构无变化。
 * v49：作战方针模块整体移除——删除 SET_AGENT_DIRECTIVE（op 38）与推送 PUSH_AGENT_DIRECTIVE
 * （op 2008），GET_AGENT_INFO 不再返回 directive 字段，agent_directives 表随上线清理删除。
 * 玩家对 Agent 的打法意图改为与自己的 Agent 直接讨论，不再经游戏设置。老客户端发 op 38
 * 收到 UNKNOWN_OP。
 * v50（排行榜按 AI 模型分组，AISLG-133，只加不改）：LOGIN 请求新增可选 agentModel（仅
 * asAgent=true 生效；Agent 自报驱动自己的模型 / 脚本名，限长 64、超长截断，以最近一次
 * 声明为准、不填保留上次；自报不验证，与 asAgent 同为「声明」口径）。accounts 新增
 * agent_model（原文）与 agent_last_seen_at（Agent 登录时刻）。GET_LEADERBOARD 玩家三榜
 * 条目新增 agentModel（自报原文，null = 从未声明），新增 kind=model 模型榜：按常见模型
 * 名单归类聚合（名单外归「其他」，未声明归「未声明」，common/src/agent-models.ts），
 * 只统计最近 7 天 Agent 上线过、且进了战力统计的账号，排名 = 该模型实力前 10 名的
 * 平均战力（不足 10 名取全部平均），响应经 modelEntries 下发（entries 为空、me 为 null）。
 * 新表 leaderboard_model_snapshots，leaderboard_snapshots 加列 agent_model。
 * v51（聊天，AISLG-138，只加不改）：新增玩家专属的聊天协议（op 66–71 与推送 2019，仅玩家连接，
 * Agent 连接返回 AGENT_FORBIDDEN，对外 Agent 文档不收录）：世界频道与私聊的消息查询 / 发送，
 * 私聊会话与未读，已读标记，屏蔽与取消屏蔽，战报卡片详情。新增错误码 CHAT_GOVERNMENT_TOO_LOW /
 * CHAT_MUTED / CHAT_BLOCKED / CHAT_RATE_LIMITED。新表 chat_messages / chat_blocks / chat_reads，
 * accounts 加列 chat_muted_until。
 */
export const PROTOCOL_VERSION = 51;
