# 根目录端到端测试

跨前后端的真实联调测试（见 AGENTS.md 的目录约定）：浏览器 E2E 放在 `test/e2e/`，
由 Playwright 驱动真实页面、真实 WebSocket 与真实后端进程；`test/` 其余子目录留给
WS 客户端联调场景。

## 前置条件

1. **Node ≥ 20**，根目录已 `npm install`（`@playwright/test`）。
2. **数据库连接已配置**：`backend/.env` 提供 `DATABASE_URL`（模板见
   `backend/.env.example`；`npm run api / worker / smoke` 会自动加载），
   目标库需已存在，表结构由 API 启动时的幂等 DDL 自动创建。
3. 首次运行需安装浏览器：`npx playwright install chromium`。
4. 端口要求：`8080`（API）、`5175`（前端 dev server）可用；`8424` 被常驻开发实例
   占用不影响（e2e 固定用 5175）。若 8080 上已运行自启动的 API 且未设置
   `BUILD_SECONDS=3`，建筑用例会因默认 60 秒建造时长超时——e2e 期望
   独占 8080，或该实例同样以压缩时长启动。

## 运行

```bash
npm run test:e2e          # 根目录执行
npx playwright test --list  # 只列出用例，不启动服务
```

`playwright.config.ts` 的 webServer 会自动拉起三个进程并在结束后回收
（已运行的进程会被复用）：

- `backend` 的 API（`GET /health` 就绪探测；`BUILD_SECONDS=3` 压缩建造时长）；
- `backend` 的 Worker（无 HTTP 端点，不做就绪探测，任务轮询周期 1s）；
- `frontend` 的 dev server（固定 5175 端口）。

## 用例覆盖

| 文件 | 覆盖 |
| --- | --- |
| `e2e/login-persistence.spec.ts` | 预建账号登录（v48 起密码通道不再自动注册，账号由 helpers 直插数据库）、令牌落盘、刷新自动登录、退出吊销并清除令牌、一账号多会话并存、错误密码提示 |
| `e2e/layout-fit.spec.ts` | 导航外壳单屏验收（docs/frontend-nav-layout.md 第 11 节）：1920×1080 / 1440×900 / 1280×720 / 1100×800 / 390×844 五种尺寸 × 七个页面（含地图页逐类选中目标并切操作页签、城池页选中建筑、排行榜弹窗），页面不滚动、无竖向滚动条、内容不被裁；`E2E_FIT_USER=已有账号名` 可改用内容密集的账号复查 |
| `e2e/building-loop.spec.ts` | 资源建筑建造闭环（农田/伐木场两种类型、资源扣减、Worker 到期结算推送、数量与产量生效、事件流）、刷新重连后令牌自动登录并按需对齐在建状态 |

| `e2e/wechat-login.spec.ts` | 微信扫码登录（页面显示码 → 手机扫码 / 确认 → 自动登录；再扫同一微信进同一账号）、手机取消后自动换码、账号设置里的 Agent 令牌签发（明文只显示一次）→ Agent 登录 → 吊销后被断开、老账号绑定微信。spec 自己起一个微信接口为假服务的 API 进程（`wechat/harness.ts`，端口 18091） |

## 微信扫码联调（`test/wechat/`）

不经浏览器的 WS 联调：`wechat/harness.ts` 起假微信服务 + 真实 API 进程（临时端口），测试用 WebSocket 客户端分别扮演网页 / 小游戏 / Agent。

```bash
DATABASE_URL=postgresql://slg@127.0.0.1:18999/slg npm run test:wechat   # 根目录执行
npm run test:minigame                                                      # 小游戏纯逻辑 / 渲染，不需要数据库
```

- `wechat-login.test.ts`：扫码自动建号、同一微信再扫同账号、纯微信账号拒绝密码登录、等扫码期间不被登录超时断开、取消 / 断线 / 到期 / 一次性 / 防冒用、绑定微信、Agent 令牌签发 / 登录 / 吊销 / 上限。
- `minigame-flow.test.ts`：用假 `wx` 驱动 `wechat-minigame/js/login-flow.js` 对真实 API 联调，保证小游戏发出的帧与服务端协议对得上。
- 需要可写的 PostgreSQL。**不要对共享开发库跑**：用 `initdb` 在临时目录起一个本机库（端口 18999、socket 用短路径），`DATABASE_URL` 指过去；没有 `DATABASE_URL` 时这两个文件整体跳过。

## Google 登录联调（`test/google/`）

形态同微信联调：`google/harness.ts` 起假 JWKS 服务（本地 RSA 公钥）+ 真实 API 进程（临时端口，经 `GOOGLE_CERTS_URL` 指向假公钥），测试用同一把私钥签 Google ID Token。

```bash
DATABASE_URL=postgresql://slg@127.0.0.1:18999/slg npm run test:google   # 根目录执行
```

- `google-login.test.ts`：首次登录自动建号（随机用户名 `g_xxxxxx`）、同一 Google 再登同一号、纯 Google 账号拒绝密码登录、伪造 / aud 错 / 过期凭证被拒、老账号绑定与冲突（GOOGLE_ALREADY_BOUND）、Agent 令牌接入纯 Google 账号、`/auth/config` 入口开关、未配置时 GOOGLE_UNAVAILABLE、登录尝试按 IP 限频。
- ID Token 校验的纯单元测试（不依赖数据库）在 `backend/test/google-token.test.ts`（`backend` 下 `npm test` 一起跑）。

## GitHub 登录联调（`test/github/`）

形态同上：`github/harness.ts` 起假 GitHub 服务（access_token + /user）+ 真实 API 进程（临时端口，经 `GITHUB_API_BASE` 指向假服务），测试用 WebSocket 扮演网页 / Agent、用 `fetch` 扮演「GitHub 跳回来的浏览器」打回调路由。

```bash
DATABASE_URL=postgresql://slg@127.0.0.1:18999/slg npm run test:github   # 根目录执行
```

- `github-login.test.ts`：授权自动建号（`gh_xxxxxx`）、同一 GitHub 再登同一号、纯 GitHub 账号拒绝密码登录、state / 一次性码的一次性与重放（error=expired / OAUTH_CODE_INVALID）、玩家取消（error=canceled）、老账号绑定与冲突（already_bound）、`githubBound` / `githubLogin` 下发、Agent 令牌接入、未配置整体关闭、回跳响应 no-store。
- state / 一次性码状态机与 GitHub 接口封装的纯单元测试在 `backend/test/oauth-store.test.ts`、`backend/test/github-client.test.ts`（`backend` 下 `npm test` 一起跑）。

选择器统一走前端组件的 `role` 命名约定（AGENTS.md 前端规范），界面调整时同步
`e2e/helpers.ts` 与各 spec。导航重构后：账号入口在侧栏账号菜单（`侧栏-账号按钮` → `账号菜单-切换账号`），建造在城池页（先 `gotoPage(page, '城池')`，右侧 `城池页-建筑详情` 系列），事件流在情报页。

联调别的 API 实例（如临时库上的 18080）：浏览器 localStorage 设 `slg.wsUrl=ws://127.0.0.1:18080/ws` 即可（仅非生产站点生效），例如用 Playwright `storageState` 预置。后端协议层面的断言（token 登录、SESSION_INVALID、
LOGOUT 吊销）另由 `backend` 的 `npm run smoke` 覆盖，两者互补不重复。
