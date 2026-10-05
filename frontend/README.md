# frontend

首期前端。React + TypeScript + Tailwind CSS + Rsbuild，界面极简 DOM，不含 Canvas 或 2D 渲染引擎。状态管理选型 zustand（尚未引入：当前为 `useGameSession` 纯 hooks 实现，落地时机见根 README「已确定的基础架构」）。

## 命令

```bash
npm install
npm run dev        # 开发服务器，默认 http://localhost:8424
npm run build      # 产出 dist/
npm run preview    # 预览构建产物
npm run typecheck  # tsc --noEmit
```

包管理器当前用 npm（本机唯一已安装的）。此项在 `docs/phase-1-mvp.md` 里仍属未定，改用 pnpm 只需删掉 `package-lock.json` 后重新安装。

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/main.tsx` | 入口：先应用皮肤，再挂载 React |
| `src/App.tsx` | 首期单页：账号 / 资源建筑 / Agent / 事件 |
| `src/api/protocol.ts` | 协议镜像：op、帧与视图类型（同步自 backend/common/src/protocol.ts，对外文档 docs/agent-api.md） |
| `src/api/client.ts` | WebSocket 客户端：seq 关联、请求超时、推送分发；连接地址默认 `ws://127.0.0.1:8080/ws` |
| `src/api/mapping.ts` | 协议数据到界面文案的拼装规则（事件文字、错误码映射、产量摘要） |
| `src/copy.ts` | 界面文案唯一出处：面板标题 / 按钮 / 提示 / 说明 / 状态短语与建筑、资源、身份名称；组件只引用不硬编码 |
| `src/api/session-storage.ts` | 登录状态持久化：会话令牌与上次用户名（localStorage，不存密码） |
| `src/components/` | 顶栏、登录、主视图（城内 / 世界地图）、资源建筑、Agent、事件、皮肤切换 |
| `src/state/useGameSession.ts` | 真实会话：密码/令牌登录、自动登录、断线自动重连、按需查询与推送同步 |
| `src/types.ts` | 界面自己的视图模型（Identity、事件条目等） |
| `src/styles/themes.css` | 四套皮肤的全部颜色变量 |
| `src/styles/index.css` | Tailwind 引入、主题变量映射、面板等公共组件类 |
| `src/theme.ts` | 皮肤读写：`<html data-theme>` + localStorage |
| `tools/prototypes-preview.ts` | 仅开发时生效：把 `prototypes/` 挂到 dev server 的 `/prototypes/*` |
| `prototypes/` | 早期静态样稿，仅供视觉参考，不参与构建 |

## 现在能做什么

连接真实后端的第一期闭环界面。启动后端（PostgreSQL + `backend` 的 `npm run api` / `npm run worker`）后运行 `npm run dev`：

- **登录与自动登录**：用户名 + 密码走 WebSocket LOGIN（不存在的用户名以玩家身份首登即注册）。登录成功后浏览器只保存服务端签发的会话令牌（localStorage），下次打开页面自动用它免密登录；令牌过期时自动回落登录表单。登录后账号面板不再显示，账号信息与「切换账号」入口在顶栏：点用户名旁的切换图标 → 确认弹框 → 确认后调用服务端 LOGOUT 吊销令牌并回到登录页。弹框里另有「重置」入口（v9）：点击进入二次确认，确认后调用 RESET_ACCOUNT 把账号全部游戏数据重置为开号初始状态（建筑、队列、资源、人口与事件记录全部复原，城名回「主城」，会话保持在线）；其他在线连接通过 PUSH_CITY_STATE（account_reset）收到通知并全量重拉。
- **微信扫码登录与账号设置（v43）**：登录面板有「用户名密码」「微信扫码登录」两个分页（`账号面板-分页-*`）。进入微信分页就发 `WX_QR_CREATE` 显示码和倒计时，收到 `scanned` 提示在手机上确认，`confirmed` 带回会话令牌后走原有令牌登录；`canceled` / `expired` 自动换码，连续自动重试 3 次后显示「刷新二维码」。码的状态机在 `state/useWechatQr.ts`（登录与绑定共用），展示在 `components/wechat/`。侧栏账号菜单的「账号设置」弹窗（`账号设置弹窗`）有两块：**绑定微信**（未绑定时点按钮弹出 bind 码，扫码确认后状态变「已绑定」）与 **Agent 令牌**（生成令牌——明文只在弹窗里显示一次并带复制按钮、令牌列表、吊销），令牌清单与绑定状态随 `GET_AGENT_INFO` 下发，动作在 `state/useAccountSecurity.ts`。需要服务端配置了微信小游戏凭证，否则提示「微信扫码登录暂不可用」。
- **城池与改名**：顶栏账号区显示城名与城池等级，点旁边的 ✎ 打开改名弹窗（RENAME_CITY，trim 后 1..24 字符）；其他连接的改名通过 PUSH_CITY_STATE 同步过来。
- **九种建筑与建造队列**：城内视图九格建筑（农田 / 伐木场 / 采石场 / 铁矿 / 民房 / 官府 / 军营 / 仓库 / 城墙，每种同城唯一，等级上限 10）。建造与升级入口在建筑格的详情弹窗里：点击建筑格弹出该建筑的说明 / 等级 / 效果（生产建筑为小时产量，民房为人口，其余为后续玩法占位）/ 下一步动作消耗（服务端随 GET_STATE 下发，资源不足的项标「缺」）/ 队列状态；未建时弹窗提供「建造」，已建提供「升级至下一等级」——无在建立即开工，有在建立即入队，队满（1 在建 + 2 排队）或已达等级上限时按钮禁用。格子按 Lv 展示等级；非生产建筑格的第三行显示功能标签（人口 / 征兵 / 保护 / 守城）。
- **建造队列**：面板只显示进行中的队列（第 1 条在建带倒计时与进度，其余为排队位次），队列为空显示「空闲」；排队条目带取消按钮（CANCEL_BUILD，全额返还成本；在建条目不可取消）；失败原因（资源不足 / 队满 / 不可取消等）显示在面板底部。发起建造成功后立即按需对齐一次，其余每 10 秒对齐。
- **资源 / 产量 / 人口 / 储量**：五项资源与当前小时产量（含官府产金）显示在顶栏（`顶栏-资源` / `顶栏-产量`），资源条目悬浮可见对应储量上限，人口与上限同行展示（`顶栏-人口`）。
- **Agent**：显示 Agent 连接在线状态与近期动作（GET_AGENT_INFO / PUSH_AGENT_STATUS），以及 Agent 自报的托管计划（v10：GET_AGENT_INFO 的 `plan` 字段初始拉取 + PUSH_AGENT_PLAN 推送实时刷新；计划是自报展示信息，不参与游戏逻辑，RESET_ACCOUNT 会清空）。面板底部的「复制接入文档」按钮会 fetch 运行时的 `GET /agent-api.md`（只读、已放开 CORS），连同服务器地址一起写入剪贴板——整篇贴给 AI 即可让它按协议接入；仓库内的 `docs/agent-api.md` 与机器可读的 `/agent-api.json`（带 `version` 字段）是同版本的其他形态。
- **事件**：登录、建造、取消、改名、Agent 上下线等事件流（GET_EVENTS 拉取 + 推送触发增量同步），断线后按需查询。首屏显示最近 10 条，列表滚动到底部自动按 `beforeId` 游标加载更早的一页（每页 10 条），没有更多历史时显示「已加载全部事件」。
- **断线重连**：连接断开后自动用保存的令牌重连并重新对齐状态；顶栏显示连接状态。
- **主视图：城内 + 世界地图（v12 起接真实协议）**：两块共用主体中列同一位置，点标题标签切换，右侧摘要跟着换。世界地图走 `GET_WORLD_MAP` 窗口查询（缺省以主城为中心 10×10，可回主城 / 方向键平移），DOM 网格渲染：地块按地形着色（主题变量 `--t-*`，换皮肤跟着变）并标注等级数字；本方城池高亮描边、他人城池金点、NPC 城池标 N。点击地块用 `GET_TILE` 拉详情（守军战力 / 占领者 / 收益预览 / NPC 库存）：可出征地块（无主或本账号占领的野地、未占领的 NPC 城池）显示派兵表单（按城内驻军逐兵种填数，含编队战力预览，`MARCH`），本账号占领的野地显示召回按钮（`RECALL_GARRISON`，撤回即放弃占领）；下方列进行中行军（倒计时）与本城占领野地（加成 / 驻军，可点击定位）。地块归属与行军状态经 `PUSH_TILE_STATE` / `PUSH_MARCH_STATE` 实时刷新；战斗为占位的总战力对比（数值待评审），玩家城池与他人占领的地块当前不可出征（随玩家对抗阶段开放）。主体在宽屏下分左（建造队列）/ 中（主视图）/ 右（Agent、事件）三列，窄屏堆成一列。

前端固定以玩家（player）身份登录；Agent 由玩家用同一账号另行走协议接入，不经本界面。协议细节以 `docs/agent-api.md` 为准（含示例帧与错误处置建议）。

**后端未启动时**：登录表单提交会提示连接失败；保存过令牌的话会先尝试自动登录再提示失败，令牌保留，后端恢复后刷新页面即可。

## 样稿预览

`prototypes/` 是静态 HTML 样稿，不参与构建；`npm run dev` 会把它们挂在同一端口下，改完保存刷新浏览器即可，不需要另起静态服务器：

| 路径 | 内容 |
| --- | --- |
| http://localhost:8424/prototypes/index.html | 单页界面样稿（账号 / 农场 / Agent / 事件） |
| http://localhost:8424/prototypes/city-dark.html | 深色极简主界面稿 |
| http://localhost:8424/prototypes/city-main.html | 城池主界面探索稿 |

`/prototypes/` 之外的路径仍由应用接管，样稿也不会进入 `dist/`。实现见 `tools/prototypes-preview.ts`：用 `server.setup` 注册一层只读中间件，只在 dev 下生效。没有直接用 `server.publicDir`，因为它会把目录内容平铺到 dev 根路径，样稿的 `index.html` 会和应用入口页撞名（`/index.html` 只会返回应用页面）。

## 皮肤

底栏可切四套皮肤（暗夜 / 赤霄 / 鎏金 / 宣纸），选择存 localStorage。`themes.css` 里每套皮肤就是一个 `[data-theme]` 变量块，`styles/index.css` 用 `@theme inline` 把变量映射成 Tailwind 工具类（`bg-panel`、`text-accent` 等），所以新增皮肤只需加一个变量块和一个按钮，组件不用改。

视觉基准是 `prototypes/city-dark.html`（完整主界面稿）；正式接入城池、地图、名将与战斗等完整玩法界面在后续阶段。
