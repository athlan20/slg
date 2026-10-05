# SLG Backend（第一期实现中）

对照 `docs/phase-1-mvp.md` 与 `docs/phase-1-launch-scope.md` 实现的后端：WebSocket
登录注册、Agent 信息与计划上报（下一步动作/整体计划）、九种建筑的建造/升级与排队取消
（一期不提供拆除）、军营征兵（一期七兵种 + 征兵队列取消）、城墙守城加成、城池改名、
一键重置账号数据、资源与人口懒结算（含官府产金与储量上限）、世界地图与野地占领
（v12：出征 / 战利品 / 驻军采集 / NPC 城池 / NPC 袭击；v16：出征任务 plunder / occupy、
负重温携、24 小时掠夺冷却、官府等级占领上限、NPC 城仅掠夺、仓库保护规则层）、
Worker 到期结算、跨进程状态通知、按需查询。
设计范围以文档为准，本文只补充实现层面的运行说明与决策记录。

### 2026-09-27 确认的城池经济规则（协议 v8 已实现）

| 事项 | 确认规则 | 实现位置 |
| --- | --- | --- |
| 建筑拆除 | 每种建筑同城限一座，不提供拆除。 | `DEMOLISH` 协议与 `building_demolished` 事件已在 v8 移除（v7 未对外发布）。 |
| 取消建造 | 取消时全额返还已扣资源；是否可取消正在施工的任务待定。 | `CANCEL_BUILD` 仅排队条目，按 `builds.cost` 快照全额返还。 |
| 资源储量与仓库 | 粮、木、石、铁各自的上限为 `10000 + 对应资源基础小时产量 × 100`，不加入储存科技；仓库按等级提供防掠夺保护（v16：总量 4000 × 等级、四资源固定均分各 1000 × 等级，可掠量 = max(0, 存量 − 保护额)），玩家城掠夺消费方随玩家对抗阶段接入。 | `production.ts` 的 `storageCaps`；保护规则 `plunder.ts` 的 `warehouseProtectionPerResource`。 |
| 超限 | 五种资源达到各自上限后停止对应生产；黄金上限固定为 100 万，已有超限存量不直接扣减。 | `accrueProduction` 钳制（含金币）。 |
| 人口 | 上限 = `50 + 100 × 民房等级 × (等级 + 1)`（无民房即基线 50）；增速 = `10 × 民房等级 × (等级 + 1)`/小时，无民房为 0（v19）。 | `rules.ts` 的 `popCap` 与 `populationGrowthPerHour`。 |
| 开局储备 | 首城五资源各 2000（金/木/粮/石/铁，v24 AISLG-48 由 800 上调）；四资源基础产量各 100/h，无建筑也产出（参照旧源码 `UserFunc.php:282` 与 `UtilsExtend.php` 产量公式，2026-09-27 决策）。 | `rules.ts` 的 `INITIAL_RESOURCES`、`production.ts` 的 `BASE_PRODUCTION_PER_HOUR`。 |

九种建筑的现有成本仅用于「初始资源可各自首建」的占位验证，仍需数值评审（见范围文档）。正式功能边界见 [`docs/phase-1-launch-scope.md`](../docs/phase-1-launch-scope.md)。

## 目录

| 目录 | 职责 |
| --- | --- |
| `common/src/` | 协议号与消息定义（protocol）、建筑规则（rules）、资源生产与懒结算（production）、世界与野地规则（world）、战斗占位结算（battle）、征兵规则（troops）、PostgreSQL 连接与建表（db）、事件存取（events）、Agent API 文档清单与渲染（protocol-doc*）。API 与 Worker 共用，不得各自另实现一套。 |
| `api/src/` | Fastify WebSocket 接入、登录注册与会话令牌（auth）、协议分发（handlers）、世界协议（handlers-world / views-world）、连接登记（connections）、完成通知（notify）。 |
| `worker/src/` | 独立进程：领取到期建造 / 征兵 / 行军，推进状态、写完成事件、pg_notify 通知 API；世界到期任务与 NPC 袭击在 `worker/src/world-tick.ts`。 |
| `scripts/smoke.ts` | 端到端冒烟，逐条验证第一期验收路径。 |
| `scripts/smoke-world.ts` | 世界玩法冒烟（v12）：出征占领、NPC 袭击、召回、NPC 城池战败与重置清理。 |
| `scripts/gen-agent-api.ts` | Agent API 文档一键生成与漂移检查（见「协议」一节）。 |
| `scripts/set-time-scale.ts` | 查看 / 设置全局时间缩放（AISLG-38，v20）：`set-time-scale.ts [n]`，缺省查看；改动存 settings 表，API 与 Worker 缓存 TTL 10s 内生效、无需重启。 |
| `scripts/repair-city-tiles.ts` | 一次性修复「坐标在而地块缺失」的城池（幂等，ensureWorld 启动时亦会自愈）。 |
| `api/src/wechat*.ts` · `wx-*.ts` | 微信扫码登录（v43）：微信接口封装（`wechat.ts`）、ticket 内存状态机与限频（`wx-tickets.ts`）、微信身份与建号 / 绑定（`wx-accounts.ts`）、WX_* 协议处理（`handlers-wechat.ts`）。设计见 `docs/wechat-qr-login.md`。 |
| `api/src/agent-token.ts` · `handlers-agent-token.ts` | 永久 Agent 令牌（v46，AISLG-129）：每账号一个 `sk_` 令牌（建号自动生成、永不过期、原文可反复查看；表存哈希 + 原文），GET_AGENT_TOKEN / RESET_AGENT_TOKEN 协议处理（仅玩家连接；重置换新并断开旧令牌的在线连接）。 |
| `api/src/google.ts` · `oauth-accounts.ts` · `handlers-google.ts` · `auth-config-routes.ts` | Google 一键登录（v44，AISLG-127）：ID Token 校验（`google.ts`，node:crypto 自实现 RS256 + JWKS 缓存）、第三方身份建号 / 绑定（`oauth-accounts.ts`，v45 起为 Google / GitHub 共用）、GOOGLE_LOGIN / GOOGLE_BIND 协议处理与限频（`handlers-google.ts`）、`GET /auth/config` 登录入口开关（`auth-config-routes.ts`）。 |
| `api/src/github.ts` · `oauth-store.ts` · `handlers-github.ts` · `github-callback.ts` | GitHub 一键登录（v45，AISLG-128，OAuth 授权码模式）：GitHub 接口封装（`github.ts`）、授权 state 与一次性登录码的内存存储（`oauth-store.ts`）、GITHUB_AUTH_START / OAUTH_REDEEM 处理与限频（`handlers-github.ts`）、`GET /auth/github/callback` 回跳路由（`github-callback.ts`，302 回前端）。 |
| `test/` | 规则、密码哈希、协议文档清单、微信扫码（假微信与桩连接池）、Google ID Token 校验（本地 RSA 自签）与 GitHub OAuth（state / 一次性码状态机、接口封装假 fetch）的单元测试。 |

## 运行

前置：Node ≥ 20；PostgreSQL ≥ 13（`gen_random_uuid` 内置）；已创建数据库（如 `createdb slg`）。

```bash
npm install
npm run api      # 启动 API（默认 127.0.0.1:8080）
npm run worker   # 另一终端启动 Worker
npm run typecheck
npm test         # 单元测试（不需要数据库）
npm run smoke    # 端到端冒烟（需要 api/worker 已启动）
npx tsx --env-file=.env scripts/smoke-world.ts   # 世界玩法冒烟（同上；建议快时钟环境变量）
npm run gen:api-doc    # 生成 Agent API 文档（docs/agent-api.md / agent-api.json）
npm run check:api-doc  # 校验生成产物与协议清单一致（漂移检查）
```

连接地址：`ws://127.0.0.1:8080/ws`；健康检查：`GET /health`；
Agent API 文档：`GET /agent-api.md` 与 `GET /agent-api.json`（运行时从清单渲染，与所连服务同版本）。

### 环境变量

数据库连接优先放在 `backend/.env`（已被根 `.gitignore` 忽略，模板见 `.env.example`），
`npm run api / worker / smoke` 通过 `tsx --env-file=.env` 自动加载；也可直接在进程环境设置下表变量。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` 或 `PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE` | 本机 5432 / `postgres` / `slg` | PostgreSQL 连接。 |
| `PORT` / `HOST` | `8080` / `127.0.0.1` | API 监听地址。 |
| `BUILD_SECONDS` | 基准 `60` | 建筑建造时长，四种建筑相同。默认基准受全局时间缩放 ÷ time_scale（见下节）；显式设置优先于缩放（验证时调小用）。 |
| `WORKER_TICK_MS` | `1000` | Worker 领取周期。 |
| `RECRUIT_UNIT_SECONDS` | 不覆盖 | 覆盖全部兵种的单兵征募时长（秒）。默认基准受全局时间缩放 ÷ time_scale；显式设置优先（验证用；API 与 Worker 必须一致，同 BUILD_SECONDS）。 |
| `MARCH_SECONDS_PER_TILE` | 基准 `15` | 每格行军秒数（v12）。默认基准受全局时间缩放 ÷ time_scale；显式设置优先（验证时调小；API 与 Worker 必须一致）。 |
| `NPC_RAID_INTERVAL_MS` | 基准 `7200000` | NPC 袭击周期（v21 起 120 分钟基准）。默认基准受全局时间缩放 ÷ time_scale，Worker 每次袭击后按当前值重设；显式设置优先（世界冒烟里临时调小触发）；主城免战时长 = 2× 本基准 ÷ time_scale（v22）。 |
| `AUTH_TIMEOUT_MS` | `15000` | 连接建立后未登录的断开时限。 |
| `CORS_ORIGIN` | 默认白名单 | HTTP 路由跨域来源：未设置 = `https://slg.example.cn` + 本地开发（localhost/127.0.0.1 任意端口）；`*` = 任意来源；逗号分隔 = 精确白名单（`api/src/cors.ts`）。WebSocket `/ws` 不受同源策略约束。 |
| `LOG_LEVEL` | `info` | API 日志级别。 |
| `WX_APPID` / `WX_APPSECRET` | 不配置 | 微信小游戏凭证（v43 微信扫码登录）。不配置时扫码登录整体关闭，`WX_QR_CREATE` 返回 `WX_UNAVAILABLE`、`/auth/config` 的 `wechatEnabled=false`（登录页隐藏微信分页）；AppSecret 只放 `.env`，不要提交。 |
| `WX_CODE_ENV` | `release` | 二维码打开的小游戏版本：`release` / `trial` / `develop`；开发阶段用 `develop`，上线前改回 `release`。 |
| `WX_TICKET_TTL_SECONDS` | `180` | 微信二维码 ticket 有效期（秒）。ticket 只存 API 进程内存，**API 须单进程部署**；多实例需把 ticket 搬进 PostgreSQL、推送改走 `pg_notify`。 |
| `WX_API_BASE` | `https://api.weixin.qq.com` | 微信接口根地址，仅联调测试时指向假微信服务（`test/wechat/harness.ts`），线上不要配置。 |
| `GOOGLE_CLIENT_ID` | 不配置 | Google 一键登录的 OAuth Client ID（v44）。不配置时功能整体关闭：`GOOGLE_LOGIN` / `GOOGLE_BIND` 返回 `GOOGLE_UNAVAILABLE`、`/auth/config` 的 `googleClientId=null`（前端不显示 Google 入口）。 |
| `GOOGLE_CERTS_URL` | `https://www.googleapis.com/oauth2/v3/certs` | Google 公钥（JWKS）地址，仅联调测试时指向假 JWKS 服务（`test/google/harness.ts`），线上不要配置。 |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` / `GITHUB_REDIRECT_URI` / `FRONTEND_URL` | 不配置 | GitHub 一键登录（v45）：在 GitHub 上建一个 **OAuth App**（不是 GitHub App），回调地址填 `GITHUB_REDIRECT_URI`（如 `https://slgws.example.cn/auth/github/callback`）。四项缺一即整体关闭：`GITHUB_AUTH_START` 返回 `GITHUB_UNAVAILABLE`、`/auth/config` 的 `githubEnabled=false`。`FRONTEND_URL` 为授权完成 / 取消后 302 跳回的前端地址。Secret 只放 `.env`，不要提交。**v47 起改按站点分套**，这四个变量成为任何 Host 都能用的 `default` 套（既有部署不用改）。 |
| `GITHUB_SITES` | 不配置 | **v47 双站点**：GitHub OAuth App 按站点分开配置（一个 OAuth App 只能填一个回调地址），JSON 形如 `{"slg.example.cn":{...},"slg.yuntianyou.cc":{...}}`，键为站点 Host，值同上一栏四项（另可加 `apiBase`）；也接受 `"default"` 键作为兜底。某 Host 没配则回落到 `default` 套，两者都没有则该站 `githubEnabled=false`。授权 `state` 会记住发起站点，回调按它选配置套并 302 回该站前端。 |
| `PASSWORD_LOGIN_DISABLED_HOSTS` | 不配置 | **v47 双站点**：整站关闭账号密码登录的 Host 列表，逗号分隔（如 `slg.yuntianyou.cc`；带端口 / 大小写不影响匹配）。列出的站点上 `LOGIN` 的密码分支返回 `PASSWORD_LOGIN_CLOSED`（绕过界面直发也一样），`/auth/config` 下发 `passwordLogin=false`、`wechatEnabled=false`，前端隐藏密码表单与微信入口，只剩 Google / GitHub。Agent 用账号密码登录在任何站都会被拒（`AGENT_PASSWORD_FORBIDDEN`，与本站配置无关）。 |
| `GITHUB_API_BASE` | `https://github.com` | GitHub 接口根地址，仅联调测试时指向假 GitHub 服务（`test/github/harness.ts`），线上不要配置。 |
| `NODE_USE_ENV_PROXY` + `HTTPS_PROXY` | 不启用 | Node ≥ 24 的出站代理开关（v44）：设 `NODE_USE_ENV_PROXY=1` 并配 `HTTPS_PROXY=http://代理地址:端口`，API 校验 Google ID Token / 调 GitHub 接口的出站请求即走代理（代码无需改动；部署前再定要不要配，见下）。 |

### Google 访问与代理（v44，部署前必须定的决策点）

Google 在国内不可直连，Google 登录涉及两段出站访问，**部署前要分别确认**：

1. **玩家浏览器 → Google**（加载 `accounts.google.com/gsi/client` 与弹出账号选择）：国内玩家不开代理时
   Google 按钮加载不出来，前端已按加载失败降级为「可改用账号密码登录」的提示，功能可用性不受影响，
   但 Google 登录实际只对能访问 Google 的玩家可用。
2. **API 服务器 → Google 公钥**（校验 ID Token 时拉 `googleapis.com/oauth2/v3/certs`）：服务器在国内
   需配代理——`NODE_USE_ENV_PROXY=1` 加 `HTTPS_PROXY`（见上表），Node ≥ 24 原生支持、代码无需改动；
   服务器本身在境外则不用配。连不上时 `GOOGLE_LOGIN` 返回 `GOOGLE_UNAVAILABLE`，其他登录方式不受影响。

公钥按 Google 返回的 Cache-Control 缓存（约数小时），不会每次登录都出站。本节先落能力，
**生产要不要开 Google 登录、走不走代理，部署时拍板**。

### GitHub 登录部署注意（v45）

- **GitHub 在国内大多能访问但时快时慢**：API 服务器要调 `github.com`（换令牌）与 `api.github.com`
  （取用户），访问不稳定时与 Google 同一套代理（`NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY`）。
- **`/auth/github/callback` 不能被又拍云 CDN 缓存**：该路由响应已带 `cache-control: no-store`，但 CDN
  可能按自身规则缓存 302——需在又拍云控制台对 `/auth/github/callback` 设置**不缓存 / 直接回源**，否则
  玩家可能拿到别人缓存的一次性码（会因一次性自然失效，但表现为「登录失败」）。
- 授权 `state` 与一次性登录码存 API 进程内存（与微信 ticket 同前提）：**API 须单进程部署**，重启只会让
  进行中的授权失败，玩家重新点一次即可；多实例需把 state / 码搬进共享存储。
- 只读最少信息：不申请任何 scope（公开资料），拿到用户数字 `id` 与用户名后访问令牌即丢弃，不落库。

### 双站点部署注意（v47，AISLG-130）

游戏有两个站，背后是**同一套服务、同一个数据库、账号通用**；站点按连接访问的 Host 区分
（握手 `Host` 头；开启 `TRUST_PROXY` 时优先取 `X-Forwarded-Host`——反向代理 / CDN 必须把原始
Host 传下来，否则两站会被当成同一个站）：

| 站点 | 面向 | API 地址 | 登录方式 |
| --- | --- | --- | --- |
| `slg.example.cn` | 国内 | `wss://slgws.example.cn/ws` | 账号密码（含注册）+ 已配置的第三方登录 |
| `slg.yuntianyou.cc` | 国际 | `wss://slg.yuntianyou.cc/ws`（与页面同域名） | **只有** Google / GitHub |

- **国际站关密码登录**：`PASSWORD_LOGIN_DISABLED_HOSTS=slg.yuntianyou.cc`。该站前端由 `/auth/config`
  拿到 `passwordLogin=false`，登录页只渲染 Google / GitHub 按钮；服务端在 `LOGIN` 的密码分支硬拦，
  绕过界面直发也是 `PASSWORD_LOGIN_DISABLED`。
- **GitHub 两个 OAuth App**：国际站回调填 `https://slg.yuntianyou.cc/auth/github/callback`、国内站照旧；
  两套凭证写进 `GITHUB_SITES`（见环境变量表）。`/auth/github/callback` 在**两个站**都不能被 CDN 缓存。
- **Google 加两个站域名**：Google 控制台的「已获授权的 JavaScript 来源」里加上
  `https://slg.example.cn` 与 `https://slg.yuntianyou.cc`（部署操作，代码无感）。
- **老密码账号去国际站**：先在国内站用密码登录 → 账号设置里绑定 Google 或 GitHub → 去国际站用绑定的
  方式登录，进的是同一个号；绑定后密码在国内站照常可用（不作废）。
- **Agent 一律用令牌**：两个站都一样，`LOGIN` 带 `username/password` + `asAgent=true` 返回
  `AGENT_PASSWORD_LOGIN`；Agent 文档（`docs/agent-api.md`）已去掉「用账号密码登录」的说明。
- 前端按页面域名选连接地址（`frontend/src/api/client.ts` 的 `PRODUCTION_WS_BY_HOST`）：`.cn` → `slgws.example.cn`，
  `.cc` → 同域名 `slg.yuntianyou.cc`；「复制给 AI」的提示词里文档地址与服务器地址随之变成 `.cc` 的。

### 全局时间缩放 time_scale（v20，AISLG-38）——部署与运维须知

**部署本版本后游戏立即进入 50 倍速**（默认值，见下）；恢复正常节奏须显式设置
`time_scale = 1`。这不是环境变量，是数据库配置：`settings` 表（`key='time_scale'`，
由 ensureSchema 幂等建表），API 与 Worker 双进程共享一份，进程内缓存 TTL 10 秒
自动刷新——**改配置无需重启**。

```bash
# 查看（库中无记录 = 默认 50）
npx tsx --env-file=.env scripts/set-time-scale.ts
# 设为 10 倍速 / 恢复正常节奏（约 10 秒内生效）
npx tsx --env-file=.env scripts/set-time-scale.ts 10
npx tsx --env-file=.env scripts/set-time-scale.ts 1
```

| 项 | 语义 |
| --- | --- |
| 耗时类 | **总时长**基准 ÷ time_scale，钳 1 秒下限（行军按距离、升级按等级、征兵按数量先合成总时长再缩放）：建造/升级（基准 60s×等级）、征兵（基准各兵种单兵时长）、行军（基准 15s/格）、掠夺冷却（基准 24h）、NPC 袭击间隔（基准 120min，v21 AISLG-28 起）。 |
| 速率类 | 基准 × time_scale：城池产出（含基础产量 / 建筑 / 野地加成与采集）、人口增长、军队耗粮——同幅放大，经济关系不变。 |
| 生效范围 | **只作用于新发起的任务与下一次结算**（增量语义）：存量建造 / 征兵 / 行军的到期时间不重算。切换瞬间在途任务按原到期时间结算。 |
| 与环境变量的关系 | 显式设置的 `BUILD_SECONDS` 等验证变量**优先于**缩放（冒烟流程不受影响）；未设置时基准值才走缩放。 |
| 对外协议 | CityView 新增 `timeScale` 字段下发当前值（前端本地折算冷却剩余用）；agent-api 文档头部有全局说明，文档内数值为未加速基准（scale=1）。 |

前后端建议同批发布：旧前端不识别 `timeScale` 字段不会报错，但其掠夺冷却剩余提示按基准 24h 本地折算，与实际窗口不符。

实现位置：`common/src/time-scale.ts`（缓存与缩放函数）、各时长/速率出口
（rules / troops / world / plunder / production）、Worker 袭击调度（动态间隔）。
设计决策记录见 `docs/phase-1-mvp.md`「全局时间缩放」一节。

### v22（AISLG-40~43）要点速览

- **主城袭击**（`worker/src/city-raid.ts` + `battle.ts`）：强度改按守军战力推导
  （`cityRaidLevel`：clamp(ceil(守军战力/25), 官府/2, 官府)）；被攻破后写
  `cities.truce_until`（2× 袭击基准间隔 ÷ timeScale），免战内目标池排除该主城，
  `CityView.truceUntil` 下发。
- **储量上限随缩放**（`production.ts` 的 `storageCaps`）：上限 × timeScale（含金币），
  填满时长恢复基准（四资源 100h、金 2500h）；存量城池下个结算周期自动解封。
- **UPGRADE toLevel 连续升级**：整链按各级公式价预扣、占 1 个队列位，Worker 到一级
  推进一级（`builds.to_level`）；`BuildView.toLevel` 下发、响应附 `chain` 计划。
- **失败响应缺口**：BUILD / UPGRADE / RECRUIT / EXCHANGE 的 INSUFFICIENT_RESOURCES
  （与 INSUFFICIENT_POPULATION）附 `shortfall` + `retryAfterSeconds`（按当前净产量/
  增速推导）；MARCH 的 PLUNDER_COOLDOWN 附 `retryAfterSeconds`。
- **集市 EXCHANGE（op 37）**：四资源按 4:1（`rules.ts` 的 `EXCHANGE_INPUT_PER_GOLD`）
  换金币，事件 `resource_exchanged`——满级 / 满仓后的可持续资源出口。

## 协议（提案，尚未与前端联合评审）

协议对外文档由清单生成，本节不再维护协议表：

- 生成产物：`docs/agent-api.md`（人读 / LLM 读）与 `docs/agent-api.json`（机器可读），
  可直接交给玩家或其 Agent；API 同时在 `GET /agent-api.md` 与 `GET /agent-api.json` 提供同版本文档。
- 唯一事实来源：`common/src/protocol.ts`（协议号、帧、错误码、`PROTOCOL_VERSION`）+
  `common/src/protocol-doc*.ts`（字段说明、完整帧示例、连接规则、术语表、完整示例会话）。
  示例数值直接引用 `rules.ts` 常量；错误示例文案与 `api/src/frames.ts` 的实际文案一致（单元测试锁定）。
- 调整协议后运行 `npm run gen:api-doc` 重新生成；`npm run check:api-doc` 校验产物未漂移。
  新增协议号必须在 `protocol-doc-ops.ts` 补文档——`Record<Op, OpDoc>` 漏写时 typecheck 直接失败。
- 版本与兼容：`PROTOCOL_VERSION` 随对外协议内容每次变化递增，承诺「只加不改」，详见生成文档的「版本与兼容」一节。

前端联评的评审载体即 `docs/agent-api.md`。`scripts/smoke.ts` 按生成文档编写。

## 关键机制

- **跨进程通知**：Worker 提交完成后 `pg_notify('slg_build_completed')`；API 用专用连接 LISTEN，
  收到通知即按 `completed_at` 水位线轮询新增完成并推送给账号在线连接；另有 5 秒兜底轮询，
  覆盖 API 监听重连期间漏收的通知。启动前的历史完成不补推（按需查询）。**水位线必须保存为
  timestamptz 的文本形式（微秒精度）**：JS Date 只有毫秒精度，`completed_at >` 严格比较会因
  微秒尾数被截断而永远重新命中最新一行，导致完成推送每个兜底周期重复一次（2026-09-27
  实测缺陷，修复见 `api/src/notify.ts`）。
- **防重复完成**：领取用 `FOR UPDATE SKIP LOCKED`（兼容将来多 Worker 实例），
  完成写入用 `UPDATE ... WHERE status = 'building'` 条件守卫，重启或并发领取都只会完成一次；
  完成事件与状态同事务落库，通知在提交后发出。
- **并发操作**：发起建造/取消/改名在事务内对城池行加锁后按最新状态校验，玩家与 Agent
  同时提交按先后生效，后提交方拿到基于最新状态的错误码（附当前状态）。
- **产量与人口懒结算（v8）**：五种产出（农田/伐木场/采石场/铁矿各产一种资源，官府产金）
  按「等级 × 每级速率」产出，生产不占用人口（范围文档明确）。`cities` 行记录上次结算时间
  `settled_at`、各资源（含金）与人口的微单位余数（1/10⁶ 单位）；读取城池（GET_STATE）或
  扣减资源前在事务内推进到当前时刻，离线期间照常累积，不依赖 Worker 定时任务。整数微单位
  数学保证任意结算频率下进度无损（每次结算截断误差 < 1 微单位）。人口增速 = `10 × 民房等级 ×
  (等级 + 1)`/小时（v19，无民房为 0），增长到上限 `50 + 100 × 民房等级 × (等级 + 1)`
  （v19：无民房即基线 50）为止。产量/人口变化不推送，客户端按需查询
  或按 `city.production` / `city.population` 本地推算。
- **储量上限钳制（v8 确认规则）**：粮/木/石/铁各自上限 = `10000 + 对应资源基础小时产量 × 100`
  （基础产量不含科技加成，随生产建筑等级变化），金币固定 100 万。五种资源达到上限后停止
  对应生产（增量截断到剩余空间、余数冻结），已有超限存量不直接扣减；取消返还可能使存量
  暂超上限，直到被消耗。仓库不改变储量上限——按等级提供防掠夺保护（v16 规则落地
  `plunder.ts`：4000 × 等级、固定均分；掠夺入账不做储量钳制）。
- **一键重置（v9）**：`RESET_ACCOUNT` 把账号全部游戏数据回到开号初始状态（城池名称/
  等级、资源、建筑、建造队列与历史、人口、事件流；会话凭证保留，连接不掉线），不可逆，
  须显式 `confirm=true`，且**仅限玩家连接**（Agent 连接返回 `AGENT_FORBIDDEN`——基于自报
  role 的协议级限制，拦住诚实声明的 Agent，不构成可验证的安全边界，见「身份边界」）。事务锁序与 Worker / 取消一致（builds → cities → city_buildings），
  重置后写入一条 `account_reset` 审计事件并推送 `PUSH_CITY_STATE`（account_reset）。
- **征兵（v11）**：`RECRUIT` 按兵种征募（军营等级解锁、发起时扣资源与人口）、
  `CANCEL_RECRUIT` 取消排队条目并按快照全额返还（征募中能否取消待定）。征兵队列独立
  于建造队列（1 征募中 + 2 排队，占位）；Worker 到期把兵力累加进 `city_army` 并做队首
  激活（时长按条目的单兵时长快照 × 数量重算）；完成走独立水位线轮询推送
  `PUSH_RECRUIT_STATE`，激活单条直推（锁序 recruits → cities，与建造一致）。
  军队耗粮已随 v14 接入：单兵小时耗粮（`troops.ts` 的 foodUse，占位）计入粮的净产量
  结算（城内驻军 ×1、行军与野地驻军 ×2，断粮钳 0 不记负债，读取时现查现算），出征与
  战斗见下文「世界与行军」。
- **守城加成（v11）**：`WALL_DEFENSE_PER_LEVEL`（每级 +5，占位）随 `city.defenseBonus`
  下发；消费方是 v13 守城战斗结算（`battle.ts` 的 wallDefensePercent，按等级整体减伤）。
- **世界与行军（v12 起；v13 战斗结构接入）**：世界为 1000×1000 方格（首次启动幂等生成，
  `world_tiles` 为权威状态；存量城池启动时回填地块）。主城**分散落位**：注册时在「中心 +
  随机采样点」里挑与既有城池 Chebyshev 距离最远的空闲野地（采样最远点，首座在地图中心
  附近，城市随注册数摊开全图）。存量世界与 `WORLD_SIZE` 不一致时启动即重建：行军与地块
  驻军的部队并回城内驻军，行军 / 占领 / 地图清零重生成，全部城池按创建顺序分散重排
  （开发期占位路径）。`MARCH` 从主城扣兵出征（行军时长 = Chebyshev 距离 × 每格秒数 ÷
  编队最慢兵种速度系数），Worker 到期按 purpose 分发结算。**出征任务（v16，`MARCH.task`，
  缺省 plunder——对 v15 旧请求是已确认的破坏性变更）**：`plunder` 掠夺——战斗胜利后从
  奖励池按**幸存部队负重**（Σ 数量 × 单兵 carry，粮→木→石→铁装填，`plunder-tick.ts`）
  携回并立即入账出发城（不钳储量上限），不改归属、幸存部队返程；野地池 = 地形资源
  1500 × 等级（v19；无金币，金矿为空池——金币只可占领金矿生息），NPC 城池 = 持久化库存四资源（金币不可掠夺、库存不再生、掠空无
  收益；task=occupy 返回 TASK_INVALID_FOR_TARGET）；成功掠夺的地块进入 24 小时冷却
  （`world_tiles.plundered_at`，GET_TILE 下发 plunderedAt；发起校验 PLUNDER_COOLDOWN、
  在途到达仍战斗但资源为零、胜利即刷新）。`occupy` 占领——无一次性战利品，该城占领野地
  数低于官府等级（上限 = 官府等级）时改归属、幸存驻守；发起初核（TERRITORY_LIMIT）与
  到达复核（超限则胜利后返程，事件 occupied=false / denial=TERRITORY_LIMIT）。升级前
  已发出的在途 `purpose='attack'` 行军走 v15 legacy 结算路径（金币战利品、NPC 全额库存
  并占领为分城，`battle-tick.ts` 保留）。**运输（v26，AISLG-79，`MARCH task=transport`）**：
  目标限本账号另一座城，必带 `cargo`（五项非负整数，总量 ≤ 编队负重，否则
  CARGO_OVER_CAPACITY）；发起即扣出发城资源，货物存 `marches.cargo`，到达（`world-tick.ts`
  settleTransportArrival）即时入账目标城并让部队返程；撤回 / 目标失效货物随部队带回出发城
  （共用规则 `common/src/transport.ts`）。**科技（v27，AISLG-77）**：新建筑书院 `academy`；
  6 项账号共享科技（农耕 / 负重 / 行军 / 储存 / 侦察 / 城防，规则与数值 `common/src/tech.ts`），
  `GET_TECHS` / `RESEARCH_TECH` / `CANCEL_RESEARCH` + `PUSH_TECH_STATE`，研究记录 `tech_research`、
  等级 `account_techs`；Worker `tech-tick.ts` 到期结算并按旧等级切分各城产量；效果出口：产量 /
  储量（`production.ts`）、负重（`armyCarryCapacity`）、行军（`marchTravelSeconds`）、守城
  （`wallDefensePercent`）、侦察降级（`scout-detail.ts`）。**移动目标（v28，AISLG-78）**：流寇 / 运粮商队
  沿 24 格公开路线移动、基准 6 小时过时消失（规则 `common/src/moving-target.ts`，表 `moving_targets`）；
  Worker `moving-tick.ts` 过期清理 + 流寇路过玩家野地掠夺 + 按活跃玩家数补刷，`GET_MOVING_TARGETS` /
  `PUSH_MOVING_TARGET_STATE`；`MARCH targetId` 截击，到达结算在 `intercept-tick.ts`（目标在选定格或相邻格
  才接战，否则扑空 / 目标消失，三种结果都有战报）。**黄巾之乱（v29，AISLG-76）**：全服共同清剿的周期事件
  （规则 `common/src/yellow-turban.ts`，表 `yt_events` / `yt_camps` / `yt_contrib`）：Worker `yt-tick.ts` 起事 /
  坐大 / 大营发兵（复用 NPC 来袭预警）/ 到时限收场，`yt-camp.ts` 营地与老巢出征结算（MARCH 掠夺任务，地块
  `TileView.camp`），`yt-event.ts` 起事 / 老巢出现 / 收场（按歼敌贡献发奖、残营散成流寇）；`GET_YELLOW_TURBAN`
  / `PUSH_YELLOW_TURBAN_STATE`，关键节点全服播报不受限频。**二期建筑（v30，AISLG-80~83，效果出口
  `common/src/building-effects.ts`）**：校场（`city.deploy`、MARCH / SCOUT 超限 DEPLOY_LIMIT）、烽火台（`npc-attack.ts`
  的预警提前量与敌情分档）、驿站（调兵 / 运输行军加成）、箭塔（`battle-engine.ts` 的 `tower` 选项，仅守城战，
  校准 `npm run calibrate:tower`）。**战斗（v13 落地、v15 定稿）**
  为多回合推进结构（引擎 `battle-engine.ts` + 规则层 `battle.ts`：一维战场 120、全体兵堆
  按速度降序分档行动且同速档同时结算、进射程攻击、互斥判定链闪避/格挡/破击/暴击、伤害
  = ATK×(1−DEF/(DEF+2000))（兵堆保留余伤血池）；野地遭遇战守方迎击、攻城战守方据墙
  待敌（城墙位受击减免、够不到驻足之敌时出城迎击、离墙失减伤）；回合上限内未歼灭判攻方
  败、幸存部队撤回出发城）——数值经 AISLG-2 批量模拟评审定稿（记录
  `docs/battle-calibration.md`，复现 `npm run calibrate:battle`）。野地原住守军与
  NPC 袭击部队为真实编成（参考战力 30/40 × 等级）。每场战斗生成战报
  （`battle_reports`，攻方或被袭击守方账号持有，GET_BATTLE_REPORTS 查询 / 推送）。
  **侦察（v13）**：`SCOUT` 派斥候（×2 行军速度）到达产出情报快照（`scout_intel` +
  march_completed 事件）并返程；GET_TILE 对 NPC 城池的驻防 / 库存详情需侦察（快照语义，
  未侦察为 null）。**行军撤回 / 调兵（v13）**：`RECALL_MARCH` 把在途行军翻转为返程
  （arrive_at = now + 已走时长）；MARCH 目标为本账号分城时为调兵（不战斗，到达并入该分
  城地块驻军）。`RECALL_GARRISON` 撤回即放弃占领，部队返程回城。占领野地给城池加持续
  产量（等级 × 地形速率）+ 驻军采集（等级 × 兵力 × 0.1/h），都走 `production.ts` 的
  extra 参数。
  **锁序（全栈统一 cities → world_tiles）**：API 出征/召回与 Worker 行军结算、NPC 袭击
  都先锁城池行再锁地块行；违反该顺序会产生死锁（2026-09-27 实测缺陷，修复见
  `worker/src/world-tick.ts`）。`RECALL_MARCH` 只锁 marches 行（与 Worker 的领取锁序一致）。
  NPC 袭击周期性随机攻击玩家占领野地（编成按等级推导，占位），不攻击玩家城池与行军
  部队；结算推送 `PUSH_MARCH_STATE` / `PUSH_TILE_STATE` / `PUSH_BATTLE_REPORT`
  （行军结算有独立水位线兜底轮询，地块与战报单条直推、漏推由按需查询覆盖）。
  `RESET_ACCOUNT` 一并清理行军、领地、战报与侦察情报（分城删除、地块回无主野地，
  NPC 城不复活）。
- **Agent 计划（v10）**：`AGENT_REPORT_PLAN`（仅 Agent 连接）上报 `nextAction`（≤200 字）
  与 `overallPlan`（≤500 字）两段自报文本——缺省保持、空串清除、后写覆盖；账号最新快照存
  `agent_plans` 表（展示信息，非游戏状态，不写事件流），`GET_AGENT_INFO` 的 `plan` 字段带出，
  变更经 `PUSH_AGENT_PLAN` 推送账号其他在线连接；`RESET_ACCOUNT` 一并清空。计划是未验证的
  自报信息，只用于托管监控展示，不参与任何游戏逻辑（与 role 同属信任边界）。
- **取消排队（v7 起，返还规则 2026-09-27 确认）**：`CANCEL_BUILD` 只对 `status='queued'`
  条目生效（在建条目能否取消待定）。实现上先用条件翻转 `UPDATE builds ... WHERE status='queued'`
  守卫（锁序 builds → cities，与 Worker 一致，避免死锁），成功后在同一事务内按条目的成本快照
  （`builds.cost`）全额返还（旧数据无快照按零返还）。取消条目保留为历史（status='cancelled'），
  不再出现在队列。
- **建造队列（协议 v4，v5 起建造与升级共用）**：BUILD / UPGRADE 排队制——无在建立即开工（API 写 `due_at`），有在建且未满入队
  （`status='queued'`，`due_at=NULL`），队满返回 `QUEUE_FULL`。Worker 在完成事务内做队首激活：
  按城把最早的 queued 转 building 并重算 `started_at/due_at`，随后 `pg_notify` 两类通知——
  完成走既有水位线轮询批量推送，激活单条直推（漏发时客户端也会在完成推送触发的按需查询里
  拿到最新队列，不依赖兜底）。**注意**：开工时长由 API 与 Worker 各算一次（`BUILD_SECONDS`），
  两进程该值必须一致，否则队列条目时长不一致。
- **身份边界**：`role` 是登录方自行声明并绑定到连接的来源标记（`builds.initiator`、`events.initiator`
  记录的就是它），不是可独立验证的身份，不用于差异化访问控制。

## 当前实现的占位决策

以下记录实现时选取的占位方案；已被 2026-09-27 确认规则取代的部分不再列出（见上方表格）：

1. 协议号、字段名、错误码、`seq` 关联方式 — `common/src/protocol.ts` 与
   `common/src/protocol-doc*.ts`，需前端评审（评审载体：生成的 `docs/agent-api.md`）。
2. 建筑与经济数值（协议 v3~v7）— `common/src/rules.ts` 与 `common/src/production.ts`：
   - 九种建筑（v7，每种同城限一座）：四种资源生产建筑——农田（产粮）金 100/木 50、
     伐木场（产木）金 120/木 40、采石场（产石）金 150/木 60、铁矿（产铁）金 200/木 80/石 60；
     五种功能建筑——民房 金 80/木 60、官府（自动产金）金 200/木 100/石 50、军营 金 150/木 120/石 30、
     仓库 金 120/木 100/石 30、城墙 金 200/木 80/石 50（军营征兵与城墙守城加成随后续玩法接入）；
   - 初始资源五项各 5000（参照旧源码首城初始化）、初始人口 50、开号自带 1 级官府
     （开局即产金 100/小时，v19；2026-09-27 决策，注册与 RESET_ACCOUNT 共用 `INITIAL_*` 常量）；
     建造时长 60s（四种相同）；同城同时在建数 1；
   - 建造排队上限 2 条（队列总长 = 1 在建 + 2 排队，建造与升级共用）。旧游戏升级走
     `mem_city_schedule` 排程表 + 元宝加速（见逆向参考文档），容量数值未查到明确配置、
     加速体系第一期不做，均为占位决策；
   - v5 单实例 + 等级（与旧游戏格位制多实例的简化差异）：每种建筑同城唯一，
     重复建造返回 BUILDING_EXISTS；等级上限 10（占位）；升级成本 = 建造成本 × 当前等级、
     升级时长 = 建造时长 × 当前等级（均为占位公式）；权威等级存 `city_buildings` 表
     （Worker 完成时 upsert，旧数据按各类型最高完成等级回填），`builds` 表退化为队列与历史；
   - 产量 = 四资源基础产量（各 100/h，无建筑也产出，参照旧源码产量公式）+ 等级 × 每级速率
     （v7 起不再借用「工作人口」概念，人口属民房体系、只参与征兵）：每级每小时
     粮 120/木 100/石 80/铁 60/金 100（官府，v19），即一座 1 级农田 220 粮/小时、1 级官府 100 金/小时；
   - 城池改名（v7）：trim 后 1..24 字符（占位）；一键重置（v9）：confirm 防误触、
     名称回默认「主城」、事件清空后留一条审计事件、会话保留（实现决策，边界如需调整再评审）；
   - 城池数字等级（v7）：`cities.level` 恒为 1，提升条件与作用待设计；
   - 科技/野地/道具加成保留乘数位（`PRODUCTION_BONUS_MULTIPLIER`，当前恒为 1），相关系统上线前不生效。
3. 表结构与索引 — `common/src/db.ts` 的幂等 DDL；正式迁移工具选定后替换 `ensureSchema`。
4. 跨进程通知实现（LISTEN/NOTIFY + 5s 兜底轮询）、Worker 领取周期 1s、
   失败重试 = 下个周期重试 — `api/src/notify.ts`、`worker/src/index.ts`。
5. 密码哈希（Node 内置 scrypt，N=16384）与用户名/密码长度限制 — `api/src/password.ts`、`handlers.ts`。
6. 包管理器（npm）、直接以 tsx 运行 TS（未做构建产物）、PM2 托管细节未配置 — `package.json`。
7. Agent 信息页字段：Agent 在线状态 + 当前 Agent 连接 + 近 10 条 Agent 事件 + 最新计划
   快照（v10）— `GET_AGENT_INFO`；计划两段文本的长度上限（200/500 字符）为占位决策
   （`api/src/handlers.ts` 的 `PLAN_*_MAX`）。
9. 征兵（v11）：七兵种成本/人口/时长/军营等级门槛、单批上限 100、队列容量
   1+2 — `common/src/troops.ts`（量级随 v15 AISLG-2 评审通过）；守城加成每级 +5 —
   `common/src/rules.ts` 的 `WALL_DEFENSE_PER_LEVEL`（定稿）。
 10. 世界（v12，占位）与战斗（v13 落地、v15 定稿）— `common/src/world.ts`（数据库读写为
    `common/src/world-db.ts`）、`common/src/battle.ts`（规则层，数据库读写 `battle-db.ts`）
    与引擎 `common/src/battle-engine.ts`（数值定稿记录 `docs/battle-calibration.md`）：
    - 世界 1000×1000、生成种子 20260927（可复现）、地图窗口单边上限 20（缺省 10×10 一屏）；
      NPC 城池 15000 座（随世界面积同比例放缩保持密度）；主城分散落位（采样最远点）；
    - 战斗（v15 定稿）：七兵种属性表 `TROOP_STATS`（hp/atk/def/speed/range/marchSpeed）、
      战场长度 120、回合上限 100、判定链概率 `JUDGMENT_RATES`（闪避 5% / 格挡 10% /
      破击 5% / 暴击 10%）、伤害公式 ATK×(1−DEF/(DEF+2000))、余伤血池、城墙减伤每级 5%
      （封顶 90%、仅城墙位守方）；原住守军 / NPC 袭击编成常量（参考战力 30 / 40 × 等级）；
    - 地形八种（平原/草原/森林/丘陵/荒漠/沼泽/湖泊/金矿，v19 新增金矿：占领产金 100×等级/小时、
      掠夺池为空）与权重分布、野地等级 1..10 权重分布；
   - 占领加成每级（v19 ×10）：森林/草原 100、平原/丘陵/荒漠 80、沼泽 60、湖泊 120、金矿 100
     产金（/小时，按地形资源）；驻军采集 = 等级 × 兵力 × 1/小时（v19 ×10，不落背包物品）；
   - 未占领野地原住守军战力 = 等级 × 30（不落库）；NPC 袭击战力 = 等级 × 40；
     单兵参考战力（展示用）：民夫 1 / 义兵·斥候 2 / 长枪兵 4 / 刀盾兵·弓箭兵 5 / 轻骑兵 8；
   - 野地战利品（legacy attack 路径）：金 = 等级 × 150、地形资源 = 等级 × 250；NPC 城池
     库存（等级 1..3 的驻防/库存/继承建筑见 `NPC_CITY_PROFILE`）；legacy 占领 NPC 城池 =
     掠夺全部库存 + 转分城（新账号 50 人口最多 100 战力，恰好打不过 1 级 NPC 城池驻防
     100——中期目标的数值节奏，待评审确认）；
   - v16 掠夺（v19 池 ×6）：野地掠夺池 = 地形资源 1500 × 等级（无金币，金矿为空池）；单兵负重 carry =
     民夫 500 / 斥候·刀盾兵 80 / 轻骑兵 100 / 弓箭兵 50 / 义兵·长枪兵 60；掠夺冷却
     24 小时（`plundered_at` 按地块记录）；占领上限 = 官府等级；仓库保护 4000 × 等级、
     固定均分（校准记录与曲线见 `docs/battle-calibration.md` v16 一节，复现
     `npm run calibrate:plunder`）；
   - 行军每格 15s、不分兵种速度；NPC 袭击周期默认 30 分钟（v19，环境变量可调），每次随机一块占领野地。
11. 世界表结构（`world_tiles` / `tile_army` / `marches` / `cities.x/y`）与生成落库方式
   （`ensureWorld` 幂等 + 咨询锁）— `common/src/db.ts`、`common/src/world.ts`。
8. 会话令牌（长期登录，协议 v2）：有效期 30 天滑动续期、令牌形态（256 位随机 base64url，
   库内只存 SHA-256 哈希）、过期清理（每次签发时全局清理已过期行）— `api/src/auth.ts`；
   sessions 表结构 — `common/src/db.ts`。

## 已知边界

- 单 Worker 假设下完成时间戳单调；多 Worker 并发时极端情况下 `completed_at` 与提交顺序可能颠倒，
  兜底轮询可能漏推个别完成（客户端按需查询仍可拿到最新状态）。
- 产量结算按「结算时刻的建筑数量 × 全部流逝时间」计算：建筑建成落在两次结算之间时，
  该区间按新数量整段计产（最多多算一个结算间隔的产量）；结算频率越高误差越小。
  升级改变产量时同理。
- 存量资源以 32 位整数存储；储量上限只钳制产出增量，超过上限的存量（如取消返还）
  允许存在，直到被消耗到上限以下。
- 存量库表的旧账号（v3 之前注册）没有初始石/铁（列为 0）：采石场成本不含石可以先行，
  铁矿需要先建采石场积累石料，或重新注册新账号；旧城池的人口列默认 0、城池等级默认 1。
- 每账号连接数未设上限；无心跳（Ping/Pong）。重连可凭会话令牌免密登录，但令牌无设备绑定
  或来源校验，任何持有者都能使用；令牌与自报 role 同属信任边界，不可用于差异化访问控制。
- 生产环境需启用 TLS（wss）后再对外。
