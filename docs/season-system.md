# 赛季系统设计（AISLG-134）

## 1. 目标与范围

固定周期换季：地图、城池、资源、军队、武将等世界数据全部重置；账号、Agent 令牌、第三方登录绑定保留。换季时把各榜（含模型榜）前列存档进“名人堂”。赛季中途随时可加入。

不做：新旧赛季并行、奖励影响战力的东西、赛季内换倍速、邮件（代码里本来就没有）。联盟（AISLG-143）跨季保留，见 `docs/alliance-system.md`。

### 已拍板的默认值（来自需求里的推荐项，开发按此做，可在 `seasons` 表/环境变量里调）

| 项 | 取值 |
|---|---|
| 赛季长度 | 现实时间 28 天（`SEASON_LENGTH_DAYS`，默认 28）。**按现实时间计，不受 timeScale 影响** |
| 奖励 | 只给荣誉：名人堂留名 + 称号（`honors`）。不给资源/兵/加成 |
| 换季方式 | 到点短暂停服（维护态）重置，几分钟；不并行 |
| 倍速 | 每季一个倍速，默认继承上一季；换季时写入 `settings.time_scale`；季内不改 |
| 第 1 季 | 把当前已运行的世界认作第 1 季。**终点已定：2026-10-25 凌晨 4:00（北京时间，`SEASON_1_END=2026-10-25T04:00:00+08:00`；拍板于 2026-10-22），之后每季 28 天**。起点取首次部署时间，可用环境变量 `SEASON_1_START` / `SEASON_1_END`（ISO 时间）覆盖；也可部署后用 `season.ts set-end` 调整 |
| 预告补发 | 部署时若已进入 T-3d 之内，只补发**当前所处的那一个**阶段（最近的），不连发多个 |

## 2. 核心机制

### 2.1 原地重置，不引入 world_id
只有一个世界，换季时在原表上清空并重建。不给所有表加 `world_id`。

### 2.2 新账号/老账号进入新赛季：惰性加入
换季**不为所有账号一次性建主城**（沉睡号会占满地图）。账号在新赛季里第一次认证成功（密码登录、第三方登录、Agent 令牌三条路径都要走到）时，若 `accounts.season_id != 当前赛季 id`，就在同一事务里：重置该账号的赛季字段、建主城并占地块、授予新手保护、把 `accounts.season_id` 置为当前赛季。逻辑抽自 `insertAccountWithCity`（`backend/api/src/auth.ts:60`）和 `handleResetAccount`（`handlers-account.ts:167`）的“建主城/授予新手保护”部分，复用不复制。

这同时满足“赛季中途随时加入”和“玩家重新登录后从新手状态开始”。

> 要点：没有主城的账号（沉睡号）会出现在 `accounts` 里，所有按账号 JOIN `cities` 的查询（排行榜、模型榜、竞技场、将星塔）必须容忍账号没有城；模型榜只统计本季已加入的账号。

### 2.3 数据分类

**保留**：`accounts`（行保留，赛季字段重置）、`sessions`、`agent_tokens`、`wechat_identities`、`google_identities`、`oauth_identities`、`settings`、`announcements`、`announcement_reads`、`chat_blocks`。

**账号上要重置的列**：`plunder_total`、`newbie_until`、`self_truce_until`、`self_truce_used_at`、`last_online_at`。保留 `agent_model`、`agent_last_seen_at`、昵称。

**清空（世界级）**：`world_tiles`、`tile_army`、`native_garrison_state`、`famous_cities`、`npc_attacks`、`moving_targets`、`yt_events`、`yt_camps`、`yt_contrib`、`city_discards`。

**清空（账号级游戏态）**：`cities`、`capital_swaps`、`city_buildings`、`city_army`、`builds`、`recruits`、`marches`、`battle_reports`、`scout_intel`、`events`、`account_techs`、`tech_research`、`account_heroes`、`tavern_candidates`、`famous_heroes`、`hero_unlocks`、`hero_friendship`、`arena_entries`、`arena_daily`、`arena_matches`、`star_tower_progress`、`star_tower_matches`、`quest_claims`、`quest_claims_once`、`signin_state`、`agent_plans`、`agent_daily_reports`、`win_streaks`、`leaderboard_snapshots`、`leaderboard_model_snapshots`、`server_broadcasts`、`chat_messages`、`chat_reads`。

**清空后要重建**：世界地块（`generateWorldTiles`，**新种子**）、名城（`ensureFamousCities`）、野外名将（`ensureWildFamous`）、竞技场 NPC（`seedArenaNpcs`）。

> 开发时以 `backend/common/src/db.ts` 的 `SCHEMA_SQL` 实际表清单为准：新增的表必须归入上面某一类，并有一个单测对照 `information_schema` 断言“所有表都被分类”，防止以后加表漏处理。

### 2.4 世界种子
`WORLD_SEED` 目前是常量 `20260927`（`world.ts:29`）。改为：第 1 季沿用该常量，之后每季 `seed = seasons.seed`（建新赛季时随机生成并落库）。`ensureWorld` 用“地块数 != WORLD_SIZE²”判断重建，需要保持兼容；换季走专门的重置路径，不依赖该判断。

### 2.5 换季流程（Worker 执行，单事务 + 维护态）
触发：`seasons.end_at <= now()` 的当前赛季，或运维脚本一键换季。

1. 抢 PG 咨询锁（新 id `8721420`，事务级），抢不到直接跳过本次 tick。
2. 置维护态：`settings.maintenance = {"reason":"season_reset","since":ts}`，`pg_notify('slg_build_completed', {reason:'maintenance_on'})`。API 收到后对除 `GET_SEASON`、心跳/认证相关外的所有操作返回错误码 `MAINTENANCE`（并带 `retryAfterSec`）。API 另有 2 秒轮询兜底（沿用 `notify.ts` 的写法）。
3. 立即强制刷新一次榜单（调 `refreshLeaderboards`），**然后存档**（见 §3），再往下走。
4. 清空 §2.3 里的表（用 `DELETE`/`TRUNCATE`，**不要 RESTART IDENTITY**；`events` 的 id 起点 API 启动时按 max 计算，清空后序列不能回退）。
5. 重置账号赛季列；`accounts.season_id` 置 NULL。
6. 生成新世界、名城、野外名将、竞技场 NPC。
7. 把当前赛季 `status` 改为 `ended`，插入新赛季（`active`，`start_at=now()`，`end_at=now()+SEASON_LENGTH_DAYS`，新种子，倍速继承）；`settings.time_scale` 同步；清维护态。
8. 事务提交后：`pg_notify` 通知 API 做进程内清理（见下），并发 `PUSH_SEASON{phase:'started'}`。

失败处理：任一步失败整个事务回滚，旧世界原样保留，维护态在 `finally` 里清掉，30 秒后下个 tick 重试，最多连续 5 次，之后停止自动重试并写 error 日志，等人工处理。

**进程内状态清理（API）**：收到 `season_started` 通知后：断开所有连接（客户端带 `PUSH_SEASON` 后会自行重连）、清 WX 票据/OAuth state 之外的与账号游戏态相关的缓存、重置 notify 水位线、刷新 time scale 缓存。Worker 的 NPC 袭击计时器每次从 DB 读状态则无需处理，**开发时需确认**（`worker/src/npc-raid-timer.ts`）。

## 3. 名人堂（存档）

### 3.1 表（新建 `backend/common/src/season-schema.ts`，在 `ensureSchema` 里追加，参照 `arena-schema.ts` 的写法）

```
seasons(
  id serial primary key,
  name text not null,               -- "第 N 赛季"
  status text not null,             -- 'active' | 'ended'
  start_at timestamptz not null,
  end_at timestamptz not null,
  seed integer not null,
  time_scale numeric not null,
  notified_stages text[] not null default '{}',   -- 已发过的预告阶段，防重复
  ended_at timestamptz
)
season_archives(            -- 个人榜存档
  season_id int not null, kind text not null, rank int not null,
  account_id int, username text not null, city_name text,
  value numeric not null, agent_model text,
  primary key (season_id, kind, rank)
)
season_archive_models(      -- 模型榜存档
  season_id int not null, rank int not null,
  model_id text not null, model_label text not null,
  players int not null, top_avg_value numeric not null,
  top_player_name text, top_player_value numeric,
  primary key (season_id, rank)
)
season_honors(              -- 荣誉称号
  account_id int not null, season_id int not null,
  kind text not null, rank int not null, title text not null,
  primary key (account_id, season_id, kind)
)
```
`account_id` 不加外键（账号将来可能被删，存档要保留）。列的具体类型以 `db.ts` 中 `leaderboard_snapshots`、`leaderboard_model_snapshots` 实际定义为准，存档表是它们的镜像加 `season_id`。

### 3.2 存档内容
每季结束存档：`power`、`territory`、`plunder`（各取前 50）、`model`（全部，上限 50）、`arena`（`arena_entries` 里玩家的前 50，排除 NPC）、`starTower`（`star_tower_progress.best_floor` 前 50）、`alliance`（联盟榜前三，v70 起，盟主为账号列，势力为 value，见 alliance-system.md）。竞技场/将星塔目前没有榜单快照，存档时现算。

### 3.3 荣誉
各榜第 1 名 → 称号“第 N 赛季·力量榜冠军”等；2–3 名 → “亚军/季军”；模型榜第 1 的模型，该模型下本季得分最高的玩家获“模型冠军”。称号写入 `season_honors`，在个人信息里展示（`GET_SEASON` 响应的 `myHonors`），不加任何数值效果。

## 4. 预告与通知

阶段（以现实时间距 `end_at`）：`T-3d`、`T-1d`、`T-1h`、`T-10m`。Worker 每 5 秒检查一次（AISLG-208 起节流），到点且 `notified_stages` 里没有则：
- 用 `publishAnnouncement`（`common/src/announcement-publish.ts`）发公告，`--chat` 同步到世界频道；
- `insertServerBroadcast(..., {force:true})` 发全服播报；
- 推 `PUSH_SEASON{phase:'warning', stage, endsAt, remainingSec}` 给**所有在线连接含 Agent**（`broadcastAll`）；
- 把阶段写进 `notified_stages`。

换季中推 `phase:'resetting'`（进入维护态时）、`phase:'started'`（新赛季开始时）。离线的 Agent 下次连上用 `GET_SEASON` 查到。

## 5. 协议（版本 64 → 65，只加不改）

| 项 | 编号 | 说明 |
|---|---|---|
| `GET_SEASON` | 99 | 请求 `{}`。响应：`{season:{id,name,startAt,endAt,remainingSec,timeScale,status}, maintenance:bool, myHonors:[{seasonId,kind,rank,title}], joined:bool}` |
| `GET_HALL_OF_FAME` | 100 | 请求 `{seasonId?:number, kind?:string, page?:number}`；缺省 seasonId=最近一个已结束赛季。响应：`{seasons:[{id,name,endedAt}], seasonId, kind, entries:[…], modelEntries:[…], total}` |
| `PUSH_SEASON` | 2023 | `{phase:'warning'|'resetting'|'started', seasonId, endsAt, remainingSec, stage?}` |
| 错误码 `MAINTENANCE` | — | 维护态拒绝游戏类请求，带 `retryAfterSec` |

同步要改的：`protocol.ts` 的 op/push 常量、`protocol-version.ts`（`PROTOCOL_VERSION`+头注释）、`protocol-changelog.ts` 追加 v65、`protocol-doc-ops.ts` 的 `OP_DOC`（类型检查强制每个 op 有文档）、`npm run gen:api-doc` 生成 `docs/agent-api.md/json`、`mcp/` 下 `npm run sync:manifest`。`frontend/src/api/protocol.ts` 手写镜像现在停在 59，本次一并对齐到 65 的所有项。

认证成功响应（密码/第三方/Agent 令牌）里**加**一个 `season:{id,endsAt}` 字段，方便 Agent 一连上就知道当前赛季（只加字段，不改旧字段）。

## 6. 运维脚本

`backend/scripts/season.ts`（参照 `set-time-scale.ts` 和 `announcement.ts` 的风格）：
- `status`：打印当前赛季、剩余时间、预告阶段；
- `set-end <ISO 时间>`：改当前赛季结束时间（用来定第 1 季的终点），同时清掉比新 `end_at` 更晚的 `notified_stages`；
- `end-now`：一键换季（把 `end_at` 设为现在，由 Worker 下个 tick 执行）；
- `set-next-scale <倍数>`：设定下一季倍速。

## 7. 前端

- **顶栏赛季胶囊**（`TopBar.tsx:58` 的 `AlertPills`）：常驻显示“S2 · 剩 18 天”，剩余 ≤ 3 天变醒目色并显示时分秒（用 `useNow`）；`role="导航-赛季倒计时"`。
- **换季弹窗**：收到 `PUSH_SEASON{phase:'warning'}` 的 T-1d 及以后阶段弹提示（参照 `StrongRemindModal`）；收到 `resetting` 显示“换季中，请稍候”全屏遮罩并在 `started` 后自动重连、刷新状态。
- **名人堂**：在 `LeaderboardModal`（`顶栏-排行榜按钮` 打开）增加“名人堂”入口：赛季下拉 + 榜种页签（力量/领土/掠夺/模型/竞技场/将星塔），分页，不出现垂直滚动。`role` 命名遵循“页面-区块-子项”，如 `排行榜-名人堂-赛季选择`。
- 中英文文案进 `copy-ui.ts` / `copy-ui-en.ts`；更新 `docs/frontend-nav-layout.md` 相关章节；`test/e2e/layout-fit.spec.ts` 的五个视口下都不溢出。

## 8. 任务拆分与依赖

| 任务 | 内容 | 依赖 |
|---|---|---|
| **A 协议与数据层** | 建表 + `season-db.ts` 读写、协议 65（含文档/changelog/manifest）、`GET_SEASON`/`GET_HALL_OF_FAME` 处理、维护态拦截、`PUSH_SEASON`、认证成功响应带 season、惰性加入逻辑（`joinCurrentSeason`）、表分类单测 | 无 |
| **B 换季引擎** | Worker 的预告 + 换季流程（§2.5、§3、§4）、种子参数化、运维脚本、用临时库做端到端换季验证 | A |
| **C 前端** | §7 全部 | A（协议常量） |

B 与 C 可并行。

## 9. 验收

1. 临时库里造 3 个账号（各有城、兵、武将、行军），把 `end_at` 设到过去：Worker 下个 tick 完成换季；旧数据清空，新地图（种子与上一季不同）生成，名城/野外名将/竞技场 NPC 重建。
2. 换季期间游戏类请求返回 `MAINTENANCE`；`GET_SEASON` 仍可用。
3. 换季后账号用密码/Agent 令牌登录，自动获得全新主城与新手保护；昵称、令牌、第三方绑定不变。
4. `GET_HALL_OF_FAME` 能查到刚结束赛季的各榜前列和模型榜；前 3 名获得称号。
5. 预告阶段每个只发一次（重启 Worker 不重发），在线 Agent 收到 `PUSH_SEASON`。
6. 事务中途故障注入：旧世界完整保留，维护态被清除。
7. `npm test`、`npm run check:api-doc`、typecheck、前端 build 通过；`layout-fit` 五视口通过。
