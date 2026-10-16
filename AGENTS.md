# 项目协作约定

本文件适用于整个仓库，指导参与设计和开发的 AI Agent。它只约定工作方式；具体架构与业务范围以项目文档为准。

## 开始工作前

- 阅读 `README.md` 了解已确定的技术选型与目录职责。
- 开发第一期功能前阅读 `docs/phase-1-mvp.md`；其中的“尚未确定”不是默认授权自行选型。
- 如果请求只是讨论或评审，先回答问题，不擅自创建项目文件、安装依赖或实现功能；有明确实现任务时才修改相应文件。

## 目录边界

- `frontend/`：React + TypeScript + Tailwind CSS + Rsbuild，首期使用极简 DOM 界面。
- `backend/api/`：Fastify + `@fastify/websocket` 的标准 WebSocket 接入；连接处理与游戏业务规则分离。
- `backend/worker/`：独立的 Node.js 后台进程；不要为它引入不必要的 Web 框架。
- `backend/common/`：API 与 Worker 共用的规则、类型和协议约定；不要在两个进程中重复实现同一规则。
- `wechat-minigame/`：微信小游戏，网页微信扫码登录的“扫码器”，附单机翻牌配对过审内容；canvas 绘制、纯 JS，只通过标准 WebSocket 与 `backend/api/` 通信，设计见 `docs/wechat-qr-login.md`。
- `mcp/`：独立 npm 包 `slg-mcp`——运行在玩家本机的 MCP 服务（stdio，Node + TypeScript，官方 `@modelcontextprotocol/sdk`）；工具由捆绑的 `manifest/agent-api.json` 副本在启动时生成，协议变更后需在 `mcp/` 下跑 `npm run sync:manifest` 同步，不手写工具。
- `test/`：根目录的跨前后端端到端测试，覆盖真实联调流程；不要把单个模块的单元测试混放于此。
- PostgreSQL 是初期权威状态和到期任务的存储；未经明确决定，不增加 Redis、Socket.IO、Canvas 或 2D 游戏引擎。

## 代码规范

- 单个手写代码文件达到 300 行时，检查是否存在可独立拆分的职责；300 行是评审提醒，不是强制拆分线。
- 单个手写代码文件不得超过 500 行；按职责拆分模块，避免通过压缩格式、挪动空行或无意义拆分来满足行数限制。
- 自动生成的文件不受上述行数限制；不要手工修改生成文件以规避限制。

## 前端规范
- 严格执行每个功能组件,或者div功能块,使用与功能差不多的含义命名写进role属性里,用role属性来给该功能块命名,方便之后定位查找修改

## 开发与测试流程

开发和测试各用一个 git 工作目录，端口分开，可以同时进行。完整说明见 `docs/dev-test-workflow.md`。

- 开发目录 `slg/`：在 `feat/<编号>-<名称>` 或 `fix/...` 分支上开发，端口 API 8080 / 前端 8424，用 `./dev.sh` 启动。
- 测试目录 `slg-test/`（`test` 分支的 git worktree，与 `slg/` 同级）：**只 `git merge --ff-only develop`，不改代码**，端口 API 8081 / 前端 8425，用 `API_PORT=8081 WEB_PORT=8425 ./dev.sh` 启动。
- 流程：feat 分支自测通过 → 在开发目录合入 `develop` → 测试目录 `merge --ff-only develop` 后重启并测试 → 缺陷回开发目录修、再合入 `develop` 并同步测试目录 → 测试通过后 `develop` 合入 `main`。不要直接在 `develop` 上开发。
- `develop` 在开发目录检出，测试目录固定在 `test`，不占用 `develop`；拉需求分支用 `git switch -c feat/xxx develop`。
- 两个目录共用一个数据库，**同一时刻只能跑一个 Worker**：另一边用 `SERVICES="api web" ./dev.sh` 不起 Worker。需要换边验证 Worker 时，先停掉对方的 Worker。
- 共用库意味着表结构迁移对两边立即生效：改表结构要向后兼容，或提前告知测试。
- `dev.sh` / `stop.sh` 只管本目录的进程，不要用 `pkill`、`kill` 按进程名清理，以免误杀另一个目录的实例。
- 提交和推送仍遵循下文：不自行提交或推送，除非任务明确要求。
- 如果有云效权限，当开始测试某个需求的时候，把需求改成”测试中“，测试通过，改成”已完成“，测试不通过，改成”未通过“

## 跨团队协作

- 改动协议、共享类型或状态流转前，先确认前端、API 与 Worker 的交接契约；不要各自发明不兼容的协议号或数据结构。
- 不把客户端声明的 Agent 登录类型当成可独立验证的身份；具体边界见第一期设计文档。
- 任务需要尚未确定的数值、数据库迁移工具、失败重试规则或部署细节时，明确指出决策点，不将临时假设写成既定方案。
- 只修改当前任务需要的文件；保留其他人已有的修改和未跟踪文件。不要自行提交或推送，除非任务明确要求。
- 完成实现任务时说明改动范围，并运行与改动相关的构建或测试；若无法验证，说明原因。
