# 联盟系统（AISLG-143）

需求总述在云效 AISLG-143；本文记录已落地部分的约定，供后续子单（盟友互不攻击、联盟频道、地图标记、联盟榜、前端）对接。
旧游戏参考：`/Users/mac/work/research/rxsg/server/game/UnionFunc.php`（只借思路，数值以本项目为准）。

## 子单进度

| 子单 | 云效 | 内容 | 状态 |
|---|---|---|---|
| A | AISLG-181 | 建盟、入盟、职位、踢人退出、冷却、盟主自动转让、Agent 拦截（协议 v66） | 已开发 |
| B | AISLG-182 | 盟友互不攻击（协议 v67） | 已开发 |
| C | AISLG-183 | 联盟频道与系统消息（协议 v68） | 已开发 |
| D | AISLG-184 | 联盟地图标记（协议 v69） | 已开发 |
| E | AISLG-185 | 联盟榜、联盟信息页、名人堂（协议 v70） | 已开发 |
| F | AISLG-186 | 前端全部界面 | 已开发（F1 联盟面板；F2 聊天页签、地图着色与标记、联盟榜与名人堂） |

## 已定规则（A 单已实现，数值为占位，常量在 `backend/common/src/protocol-alliance.ts`，均按现实时间计）

- 建盟：主城官府 ≥ 5 级、从主城扣 10 万金币；联盟名 2–8 字，无空白 / 控制字符，过聊天屏蔽词，全服唯一（忽略大小写）。
- 一个账号只在一个联盟。成员上限 30，**待处理邀请也占名额**。
- 申请：一人同时 1 条，可撤回，48 小时过期。邀请：盟主 / 副盟主发出，被邀请人接受 / 拒绝，邀请人可撤回，重复邀请覆盖，48 小时过期。
- 职位：盟主 1、副盟主 ≤ 2、成员。盟主可任免副盟主、踢任何人、转让（对象可以是任意成员，原盟主降为成员）、解散、改公告；副盟主可审批、邀请、踢**普通成员**、改公告。
- 踢人**立即生效**（旧游戏是延时，不采用）。盟主在盟里还有别人时不能直接退出，须先转让；只剩一人时退出等于解散。
- 退出 / 被踢 / 解散者 24 小时内不能创建也不能加入（`accounts.alliance_cooldown_until`）；解散时只有解散者本人吃冷却，其他成员不吃。
- 盟主 7 天没有活跃自动转让：转给最近活跃的副盟主，没有副盟主则转给最早入盟的成员，盟里只有盟主一人不动（Worker `alliance-tick.ts`，每分钟扫一次）。
  「活跃」用 `accounts.last_active_at`：玩家登录、玩家全部断线、玩家在线期间每小时心跳刷新（`api/src/active-heartbeat.ts`）。**不能用 `last_online_at`**——它只在全部断线时才写。
- 管理类协议（建盟、申请、邀请、答复、退出、解散、踢人、任免、公告）仅限玩家连接，Agent 返回 `AGENT_FORBIDDEN`；查询类 `GET_ALLIANCE` / `LIST_ALLIANCES` 玩家与 Agent 通用，对外 Agent 文档只收录查询类与推送。
- 赛季：`alliances` / `alliance_members` 跨季保留；`alliance_requests` / `alliance_invites` 换季清空（`season-tables.ts`）。

## 盟友互不攻击（B 单已实现，协议 v67）

- 目标是盟友（同一联盟成员）的城池 / 野地：`MARCH` 掠夺、占领分城、抢占野地，以及 `SCOUT` 侦察，一律返回 `ALLY_NOT_ATTACKABLE`（`march-target.ts` 的 `resolveMarchTarget`、`handlers-battle.ts` 的 `handleScout`）。运输、增援、调兵不受影响。侦察被拒不触发新手保护失效。
- 出发后才入盟：Worker 到达结算（`pvp-raid.ts` / `pvp-tile.ts` / `pvp-conquer.ts` / 侦察 `world-tick.ts`）不开战，调用 `tick-shared.ts` 的 `abortForAlly`，部队原路返回，事件 `outcome=aborted`、`cause=ALLY_NOT_ATTACKABLE`。
- 地图：`TileView.owner.ally`（占领者是你的盟友；自己、外人、未入盟都为 false）；`GET_MAP_OVERVIEW` 的 side 新增 `ally`。前端只给小地图补了绿点，**主地图格子按 `owner.ally` 着色归 AISLG-186**。
- 来袭预警不用改：预警只在 `MARCH` 成功发起后触发，盟友打不了，自然不触发。
- 测试：`backend/test/alliance-pvp.test.ts`。

## 给后续子单的接口

- 判断两账号是否盟友：`areAllies(q, a, b)`（`backend/common/src/alliance-db.ts`，B 单用；API 与 Worker 共用）。
- 联盟大事（加入、退出、被踢、盟主变更、解散）统一出口：`recordAllianceEvent(q, allianceId, kind, detail)`（同文件，C 单已接入）。调用点都在各自的事务里，系统消息与变更同生同灭。
- 协议号：A 单占用 101–111 与推送 2024（协议版本 v66）；B 单没有新协议号，只加错误码 `ALLY_NOT_ATTACKABLE`（v67）；D（标记）从 112 起；E 复用 `GET_LEADERBOARD`（op 43）。
- 管理类处理在 `api/src/handlers-alliance-manage.ts`（事务内加锁顺序：操作者账号行 → 联盟行），查询在 `api/src/handlers-alliance.ts`。
- 测试：`backend/test/alliance.test.ts`（需 `TEST_DATABASE_URL`，会在其所指服务器上另建一次性数据库）。

## 联盟频道与系统消息（C 单，AISLG-183，协议 v68）

- 频道：`CHAT_CHANNELS` 新增 `alliance`。CHAT_HISTORY / CHAT_SEND 的 `channel: 'alliance'` 不传 `peerId`，只有本联盟成员能读写；没有联盟返回 `ALLIANCE_NOT_IN`。没有官府等级门槛，Agent 连接一律 `AGENT_FORBIDDEN`（沿用聊天的把关）。
- 规则与世界频道一致：同频道 10 秒一条（`CHAT_RATE_LIMIT_MS`）、屏蔽词替换、屏蔽玩家（看不到对方的发言，对方的发言不推给我）。系统消息没有发送人，不受屏蔽影响。
- 历史只给**入盟之后**的消息：查询按 `chat_messages.created_at >= alliance_members.joined_at` 过滤（`api/src/chat-db.ts` 的 `allianceHistory`）。离盟后看不到该联盟的历史，重新入盟也看不到离盟前的消息；换联盟后旧联盟的消息也不可见。卡片详情（CHAT_REPORT_DETAIL）用同一口径（`canSeeAllianceMessage`）。
- 保留期：联盟频道保留最近 7 天，每个联盟最多 1000 条（系统消息同计，与世界频道一致），清理在 `pruneChatMessages` 里。
- 存储：`chat_messages` 新增 `alliance_id`（外键指向 alliances，`ON DELETE CASCADE`，带索引，不复用 `recipient_id`）、`system_event`（系统消息的内容快照），`sender_id` 放宽为可空。`db.ts` 的 `ensureSchema` 已把联盟表的建表顺序提到聊天表之前（外键依赖）。
- 系统消息：`type: 'system'`，`sender` 与 `text` 为 null，内容为 `system: { kind, ... }`，文案由客户端拼接（后端不写死中文）。种类见 `CHAT_SYSTEM_KINDS`：
  - `alliance_joined`：`player`、`founder`（建盟时盟主自己入盟为 true）；
  - `alliance_left`：`player`；
  - `alliance_kicked`：`player`、`by`；
  - `alliance_leader_changed`：`from`、`to`、`reason`（`transfer` 主动转让 / `inactive` 不活跃自动转让）。
  - 解散不写系统消息（联盟频道随联盟级联删除）。
- 推送：`recordAllianceEvent` 在事务内写入系统消息并 `pg_notify`（reason = `alliance_chat`，载荷为联盟与消息编号）；事务回滚则通知一并丢弃。API 的 `notify.ts` 收到后取回消息，只推给本联盟在线的玩家连接。Worker 的自动转让同样走这条路，Worker 本身没有连接也能推到。
- 换季：`chat_messages` 本就在换季清空表里，联盟频道消息一并清空；`alliances` / `alliance_members` 保留，外键不影响清空。
- 地图标记（D 单）新增种类 `alliance_mark_created`（`player`、`markKind`、`x`、`y`，附言不进系统消息）。
- **未做（留给后续子单，在 `CHAT_SYSTEM_KINDS` 与 `AllianceEventKind` 追加种类）**：联盟占下名城、成员拿到名将两类系统消息。
- 前端（本单只同步类型，界面归 AISLG-186）：`frontend/src/api/protocol-chat.ts` 已镜像 v68；`sender` 可为 null 后，`ChatMessageRow` 暂不渲染系统消息（返回 null），联盟页签与系统消息的展示由 AISLG-186 完成。
- 测试：`backend/test/alliance-chat.test.ts`（需 `TEST_DATABASE_URL`）。

## 联盟榜、联盟信息与名人堂（E 单，AISLG-185，协议 v70）

- 联盟榜：`GET_LEADERBOARD` 的 kind=alliance，条目经 `allianceEntries` 下发（rank / allianceId / name / leader / memberCount / value），前 50 名；`me` 为我所在联盟的名次与势力（没有联盟或未上榜为 null）。玩家与 Agent 通用。前端页签归 AISLG-186，本单未出页签。
- 势力：`alliancePowerOf`（`common/src/alliance-db.ts`，唯一出处）= 全体成员占领的野地数 × 1 + 名城数 × 10 + 成员主城官府有效等级之和 × 1。权重为占位常量 `ALLIANCE_POWER_*`（`protocol-alliance.ts`）；名城 = 分城 `famous_name` 非空；没有主城的成员按 0。
- 上榜门槛：成员不足 `ALLIANCE_RANK_MIN_MEMBERS`（5）人不上榜，名次为 null。同势力按联盟名排序（联盟名全服唯一，次序稳定）。
- 快照：Worker 与玩家榜同一事务整榜重算，写入 `alliance_leaderboard_snapshots`（不挂外键，允许比联盟本身滞后一个刷新周期；换季清空）。
- 联盟详情（`GET_ALLIANCE`，`alliance` 字段）带 `power` 与 `rank`：势力现算（同一函数，与榜单口径一致），名次取最近一次快照。两者可能相差一个刷新周期内的变化。
- 名人堂：`HALL_KINDS` 新增 `alliance`。换季事务内 `archiveSeason` 存联盟榜前三（`ARCHIVE_ALLIANCE_TOP_N` = 3），`season_archives` 新增 `alliance_id` / `alliance_name` / `member_count` 列（个人榜为 null）；账号列存当时的盟主，`value` 为势力。联盟跨季保留，但不发荣誉称号（`writeHonors` 排除 alliance）。
- 测试：`backend/test/alliance-leaderboard.test.ts`（需 `TEST_DATABASE_URL`）。

## 联盟地图标记（D 单，AISLG-184，协议 v69）

- 协议号：`ALLIANCE_MARK_ADD`（112）、`ALLIANCE_MARK_REMOVE`（113）、`GET_ALLIANCE_MARKS`（114），推送 `PUSH_ALLIANCE_MARK`（2025，reason = `added` / `removed`）。
  三条请求玩家与 Agent 通用，**不走** `handleAllianceOp` 的「仅玩家」把关，由 `api/src/handlers-alliance-mark.ts` 分发（`handlers.ts` 直接路由）。
- 类型：`rally` 集结 / `enemy` 敌人 / `resource` 资源 / `danger` 危险；附言可选，去首尾空白后 20 字内，含屏蔽词**整条拒绝**（`INVALID_PARAMS`，与联盟公告的「替换成 *」不同）。
- 坐标：整数且 `inWorld`（0 ≤ x, y < `WORLD_SIZE`），否则 `INVALID_PARAMS`。
- 上限与唯一：同一联盟同时最多 `ALLIANCE_MARK_MAX`（20）个有效标记；同一格子只能有一个（`ALLIANCE_MARK_EXISTS`）。满了返回 `ALLIANCE_MARK_LIMIT`，附 `limit`、`until`（最早一个的到期时刻）与 `retryAfterSeconds`。过期标记不计数。
- 有效期：`ALLIANCE_MARK_TTL_MS`（24 小时，占位）。读取时过滤 `expires_at > now()`；放置时先回收本联盟的过期行（否则它占着同一格子的唯一约束与名额）；Worker 的 `purgeExpired` 定时删除过期行。
- 删除权限：成员只能删自己打的；盟主 / 副盟主可删任何人的，**但只对玩家连接**。Agent 连接即使账号是盟主也只能删自己的，`GET_ALLIANCE_MARKS` 的 `canRemoveAny` 对 Agent 恒为 false。别的联盟或过期的标记按「不存在」返回 `ALLIANCE_NOT_FOUND`，不泄露存在与否。
- 可见性：只有本联盟成员能查、能删；离盟后看不到旧联盟的标记（标记挂在联盟上，不挂在人上）。离盟者打下的标记留在联盟里，他本人之后不能再删。
- 推送：放置 / 删除在事务提交后推给本联盟全部成员的在线连接（含 Agent，与 `PUSH_ALLIANCE_STATE` 同口径）。过期不推送。
- 系统消息：放置时通过 `recordAllianceEvent(..., 'mark_created', ...)` 在联盟频道写一条系统消息，与标记同生同灭；删除不写。
- 存储：`alliance_marks`（`alliance_id` 外键 `ON DELETE CASCADE`，`creator_id` 外键账号 `ON DELETE CASCADE`，`UNIQUE (alliance_id, x, y)`）。解散随联盟级联删除；换季清空（`season-tables.ts` 的 `RESET_TABLES`）。
- 前端（本单只同步类型，界面归 AISLG-186）：`frontend/src/api/protocol.ts` 与 `protocol-alliance.ts` 已镜像 v69。
- 测试：`backend/test/alliance-marks.test.ts`（需 `TEST_DATABASE_URL`）。

## 前端联盟面板（AISLG-186 F1）

- 入口：侧栏「联盟」（`components/shell/Sidebar.tsx`，红点）与底栏「联盟」（`BottomBar.tsx`，红点）；红点数 = 盟主 / 副盟主的待审批申请 + 自己收到的待处理邀请（`allianceSession.ts` 的 `badge`）。弹窗挂在 `ModalHost.tsx`。
- 数据层：`frontend/src/state/allianceSession.ts`，挂在 `useGameSession` 的 `alliance`。连接建立时拉 `GET_ALLIANCE`，`PUSH_ALLIANCE_STATE`（2024）到达重拉，操作成功或失败后都重拉；登出时 `clear`。`PUSH_ALLIANCE_MARK`（2025）暂不处理，归 F2。
- 界面：`frontend/src/components/alliance/`
  - `AllianceModal.tsx`：外壳，分流「没有联盟 / 有联盟」，冷却倒计时条与错误、完成提示。
  - `AllianceNoPanel.tsx`：没有联盟时的「联盟列表（分页，点进看公开信息并申请）/ 创建联盟 / 收到的邀请」。
  - `AllianceMemberPanel.tsx`：「成员」页签（公告编辑、成员行按职位显示操作）与底部固定的 `AllianceFooter`（退出 / 解散）。
  - `AllianceRecruitPanel.tsx`：「招募」页签（待审批申请、已发出邀请、邀请玩家），仅盟主 / 副盟主可见。
  - `allianceParts.tsx`：`InlineConfirm`（两步确认，原地展开，不叠第二层弹窗）、职位标签、联盟名校验。
- 文案：`copy-alliance.ts` / `copy-alliance-en.ts`，`i18n/bundle.ts` 注册 `ALLIANCE_COPY`。错误码翻译 `api/errorText.ts` 的 `allianceErrorText`（邀请 / 申请场景可覆盖个别码）。
- 门槛与上限都取 `protocol-alliance` 常量（官府等级、金币、名额、副盟主上限、公告字数、列表页大小）。创建时金币只在当前城就是主城时预判，否则交给服务端。
- 样式：沿用 `Modal fill`（高度不超过视口），内容区 `overflow-y-auto` 在弹窗内部滚动，弹窗外壳不滚。颜色只用主题变量与现有 Tailwind 类。
- F2 已补上：聊天「联盟」页签、地图盟友着色与标记、联盟榜与名人堂页签（见下节）。

## 前端联盟界面（AISLG-186 F2）

- 聊天「联盟」页签：`components/chat/ChatWindow.tsx`（页签与输入区）、`ChatPanes.tsx` 的 `ChatAlliancePane`（没有联盟时给引导与「去联盟面板」按钮）、`ChatSystemRow.tsx`（系统消息一行居中小字，文案前端拼，种类见 `CHAT_COPY.systemLine`）。
  数据在 `state/chatAlliance.ts`（最新一页 / 更早翻页 / 推送并入，离盟清空），由 `state/useChat.ts` 统一调度；`state/chatList.ts` 放两者共用的追加 / 接前页工具。
  联盟页签没有未读红点：世界频道本身也没有，两者保持一致。
- 地图：`components/map/WorldMapStage.tsx` 按本地时钟过滤过期标记后传给 `WorldMapGrid.tsx`（盟友描边 / 角旗 / 城名着色用 `--st-online`，标记徽章 `AllianceMarkBadge`，符号与颜色在 `worldMapMarks.tsx`）；悬浮提示与图例见 `worldMapTip.tsx`、`WorldMapLegend.tsx`。
- 选中详情：`components/map/TargetPanel.tsx`——盟友的城池 / 野地，掠夺 / 占领 / 侦察 / 清剿按钮禁用并显示 `ALLY_NOT_ATTACKABLE` 的说明（运输 / 增援 / 调兵 / 截击不受影响）；有联盟时多一个「打标记」操作（`forms/MarkForm.tsx`），格子上已有标记时由 `TargetMarkNote.tsx` 显示类型 / 附言 / 打标人 / 剩余时间并允许删除（自己的，或盟主 / 副盟主的）。
- 标记数据：`state/allianceMarks.ts`，挂在 `useGameSession` 的 `allianceMarks`；随所在联盟加载，`PUSH_ALLIANCE_MARK`（2025）增量并入，断线重连重拉，离盟 / 登出清空。
- 联盟面板的「标记」页签：`components/alliance/AllianceMarkPanel.tsx`（PagedList 分页，定位跳地图、删除二次确认）。
- 联盟榜：`components/LeaderboardModal.tsx` 的第五个页签 → `components/AllianceLeaderboard.tsx`（顶部「我的联盟」，列表点开复用 `alliance/AllianceNoPanel.tsx` 导出的 `DetailView`，已有联盟的玩家看不到申请按钮）。
- 名人堂：`components/HallOfFameView.tsx` 的「联盟」页签（盟主名、成员数、势力）。
- 文案：`copy-alliance.ts` / `-en.ts` 的 `ally` / `marks` / `board` / `markErrors`；聊天文案在 `copy-chat.ts` 的 `alliance` / `systemLine`；错误翻译 `api/errorText.ts` 的 `allianceMarkErrorText`。
- 验证：`test/e2e/alliance-ui.spec.ts`（`E2E_ALLIANCE=1` 才跑，四皮肤 × 三宽度 scanLayout）。


## 前端 e2e 验证方法（联盟界面）

`test/e2e/alliance-layout.spec.ts`（联盟面板）与 `alliance-ui.spec.ts`（聊天页签、地图着色与标记、联盟榜）只在 `E2E_ALLIANCE=1` 时运行，**不进默认的 `npm run test:e2e`**。它们要连一套隔离环境（临时 Postgres + 自己的 API / Worker / 前端），不能连开发库：

1. 起一个一次性 Postgres（initdb 到临时目录，`-c listen_addresses=127.0.0.1 -c unix_socket_directories=''`，端口自选），建库 `slg_ui`。
2. 用该库起 API（`DATABASE_URL=… PORT=<api端口> node --import tsx api/src/index.ts`）、Worker，以及前端（`WEB_PORT=<web端口> API_PORT=<api端口> rsbuild dev`；注意前端只监听 IPv6 localhost，要用 `http://localhost:<web端口>`）。
3. 写一个临时 Playwright 配置：`baseURL` 指向该前端、`process.env.DATABASE_URL` 指向该库、`testMatch: /alliance-.*\.spec\.ts/`、`workers: 1`；运行 `E2E_ALLIANCE=1 npx playwright test -c <临时配置>`。
4. 结果（2026-10-24）：两份用例共 12 项全部通过；四套皮肤 × 三种宽度（1440×900、1100×800、390×844）下联盟面板、聊天联盟页签、地图盟友 / 标记、标记页签、联盟榜、名人堂联盟页签零竖向滚动违规。
