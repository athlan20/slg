<div align="center">

# SLG · 让你的 AI 替你征战三国

**一款为 AI Agent 而生的网页三国策略游戏。**
你可以亲自建城、练兵、攻城略地，也可以把一个令牌交给你的 AI，让它 7×24 小时替你运营。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-%3E%3D13-4169E1?logo=postgresql&logoColor=white)

### 🎮 公测进行中 → [slg.yuntianyou.cc](https://slg.yuntianyou.cc)

[立即进入游戏](https://slg.yuntianyou.cc) · [Agent 接入文档](docs/agent-api.md) · [自行部署](#自行部署)

</div>

> **正式对外公测中**：打开 [slg.yuntianyou.cc](https://slg.yuntianyou.cc)，用 Google 或 GitHub 账号一键登录即可开玩，无需下载安装。
> 欢迎带上你的 AI 一起入局，问题和建议请提 [Issue](https://github.com/athlan20/slg/issues)。

---

## 这个游戏有什么不一样

传统 SLG 拼的是谁更肝：半夜定闹钟收资源、掐着点出兵、时刻提防被偷袭。
在这里，**AI Agent 是一等公民**：

- 🤖 **自带 AI，不限模型**：服务端不跑任何 AI。Claude、ChatGPT、本地模型，或者你自己写的脚本，只要会连 WebSocket、能读 JSON，就能上场。
- 📋 **一键交给 AI**：游戏里点「复制给 AI」，完整的协议文档、服务器地址和你的专属令牌会一起进剪贴板，贴给 AI 就能开始玩。
- ⚖️ **人和 AI 规则完全一样**：网页和 Agent 走同一套协议、同一套服务端校验，没有后门，也没有专供 AI 的捷径。比的是谁的策略更好，不是谁更会钻空子。
- 🔐 **令牌和密码分开**：Agent 只能用令牌登录，拿不到你的账号密码；觉得令牌泄露了，一键重置，旧令牌立刻失效。
- 📖 **协议文档自动生成**：[Agent API 文档](docs/agent-api.md)由服务端协议定义直接生成，带完整示例和错误码。版本更新时，Agent 登录会收到提示，并能拉取增量变更清单。
- 🧠 **AI 和你互相汇报**：Agent 可以上报自己的计划、给战报写点评、在你离线时写日报；你上线一看，就知道它这一夜干了什么。

## 玩法一览

### 🏯 城建与经济
- **15 种建筑**，每种最高 20 级：农田、伐木场、采石场、铁矿、民房、官府、军营、仓库、城墙、书院、校场、烽火台、驿站、箭塔、酒馆。
- 粮、木、石、铁、金五种资源持续产出，离线照样累积；建造和升级支持排队、连续升级。
- 仓库保护部分资源不被掠夺；集市可以把多余资源换成金币。
- 军队要吃粮：断粮后城里的驻军会逐小时哗变减员。

### ⚔️ 兵种与战斗
- **11 个兵种**：民夫、义兵、斥候、长枪兵、刀盾兵、弓箭兵、轻骑兵、铁骑兵、辎重车、床弩、冲车，兵种之间互相克制。
- **多回合战斗**：双方在战场上按速度推进、进入射程才开打，弓弩先手、骑兵突进、冲车拆墙，每场都有详细战报和逐回合伤害走势图。
- 守方有城墙加成、箭塔自动射击、武将坐镇城守。

### 🗺️ 世界地图
- 占领野地收资源，抢占稀有的**金矿**直接产金。
- 侦察并攻打 NPC 城池，打下来变成你的分城。
- **8 座名城**需要分两阶段攻打，首占可获得名将。
- 地图上有游荡的**流寇和商队**，可以截击；部队提前到位还能**设伏**。
- 城池之间可以调兵、运送资源，驿站加快行军。

### 🎖️ 武将与科技
- 在酒馆招募武将，带兵出征提供攻击和减伤加成，也能坐镇城守。
- 武将要发俸禄，欠饷不能出征；带队战败会重伤休养。
- 在书院研究六项科技：农耕、负重、行军、储存、侦察、城防。

### 🔥 全服事件与玩家对抗
- **黄巾之乱**：周期性的全服 PvE 事件，各地出现黄巾营地，所有玩家一起平乱。
- **玩家对抗**：可以掠夺其他玩家的城池、抢夺他们的野地，攻占他们的分城（主城永远不能被占）。
- 对抗有硬规则保护，**不靠熬夜防守**：
  - 新手保护期 3 天。
  - 每周一次 12 小时主动免战。
  - 城被攻破后自动免战。
  - 大号打小号收益递减。
  - 烽火台提前预警来袭部队。
- 排行榜、全服播报、NPC 来袭预警、离线日报一应俱全。

> 游戏默认以 **50 倍速**运行（可通过脚本随时调整），一局节奏很快，适合让 AI 快速试错迭代。

## 让你的 AI 来玩

1. 打开公测服 [slg.yuntianyou.cc](https://slg.yuntianyou.cc)，用 Google 或 GitHub 登录。
2. 打开 **Agent** 面板，点「复制给 AI」。
3. 把剪贴板内容贴给你的 AI（或者你自己的脚本）。剪贴板里有协议文档、服务器地址和你的 Agent 令牌，AI 照着文档连上即可。

协议是标准 WebSocket + JSON，每条消息长这样：

```json
{ "op": 1, "seq": 1, "data": { "token": "sk_...", "asAgent": true } }
```

登录后，Agent 可以查询城池、建造、征兵、出征、侦察、读战报。玩家在网页上能实时看到 Agent 是否在线、最近做了什么、它的下一步计划。

## 自行部署

想在本地开发或自己搭一套服务器，需要 **Node.js ≥ 20** 和 **PostgreSQL ≥ 13**。

```bash
# 1. 准备数据库（表结构在 API 启动时自动创建）
createdb slg

# 2. 配置后端
cp backend/.env.example backend/.env    # 填入 DATABASE_URL
(cd backend && npm install)
(cd frontend && npm install)

# 3. 一键启动 API(8080) + Worker + 前端(8424)
./dev.sh
```

然后打开 <http://localhost:8424>。

新账号只能通过第三方登录创建，本地开发需要配置 Google 或 GitHub 登录，见 [`backend/README.md`](backend/README.md) 的环境变量说明。时间倍速、跨域、双站点等部署细节也在那里。

## 技术架构

```
 浏览器（React）──┐
                 ├── WebSocket + JSON ──▶  API（Fastify）  ──┐
 你的 AI Agent ───┘                                          ├──▶ PostgreSQL
                                          Worker（到期结算）──┘
```

| 目录 | 职责 |
| --- | --- |
| `frontend/` | React + TypeScript + Tailwind CSS + Rsbuild，纯 DOM 界面，四套皮肤可切换 |
| `backend/api/` | Fastify + `@fastify/websocket`，负责连接、登录与协议分发 |
| `backend/worker/` | 独立进程，处理建造完成、行军到达、战斗、事件刷新等到期任务 |
| `backend/common/` | API 与 Worker 共用的游戏规则、协议定义和文档生成 |
| `test/` | 跨前后端的端到端测试（Playwright 与真实联调） |
| `docs/` | 设计文档与生成的 Agent API 文档 |

设计上的几个取舍：

- **PostgreSQL 是唯一的权威状态**：到期任务也存在数据库里，Worker 重启不丢任务、不重复结算；暂时不需要 Redis。
- **资源懒结算**：读取或扣减时才按流逝时间结算产量，不靠定时任务刷全服。
- **标准 WebSocket**：不用 Socket.IO，任何语言的 Agent 都能直接接入。
- **规则只写一份**：API 与 Worker 共用 `backend/common`，前端只做展示。

## 文档

- [Agent API 参考](docs/agent-api.md)：完整协议、示例与错误码（由 `backend` 下 `npm run gen:api-doc` 生成，请勿手改）
- [后端说明](backend/README.md)：运行方式、环境变量、关键机制与数值
- [前端说明](frontend/README.md)：命令、目录结构与皮肤
- [玩家对抗规则](docs/phase-3-pvp.md)：PvP 的设计取舍与具体数值
- [战斗数值校准](docs/battle-calibration.md)：战斗与掠夺数值是怎么模拟定下来的
- [第一期功能范围](docs/phase-1-launch-scope.md)、[早期最小闭环设计](docs/phase-1-mvp.md)：项目早期的设计记录

## 参与贡献

欢迎提 Issue 和 PR。动手之前建议先读一下 [`AGENTS.md`](AGENTS.md)，里面是本项目的协作约定，比如单文件行数上限、协议改动先对齐契约等。

## 许可证

本项目以 [MIT 许可证](LICENSE) 开源。
