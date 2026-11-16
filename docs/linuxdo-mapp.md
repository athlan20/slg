# Linux.do 微应用（AISLG-261）

把 slg 作为 Linux.do「微应用」上架：论坛用户在论坛页面里点开就能玩，用论坛身份直接登录，不用另外注册。
平台文档：<https://github.com/linux-do/mapp-developer-guide>。上架流程：社区个人资料「应用」页创建应用 → 上传 `app.zip` 到沙箱 → 新建发布 → 管理员审核。

> **状态：开发完成，等审核。** 本功能全部隔离在独立文件和构建开关后面，审核不通过时可整体丢弃（见「整体移除」）。

## 提审材料

| 项 | 内容 |
|---|---|
| 应用名称 | SLG |
| 用途 | 多人在线的三国策略游戏：建城、征兵、出征、结盟。玩家用论坛身份进入，进度保存在游戏账号里 |
| 版本 | 1.0.0 |
| 权限（共 5 项） | 见下表 |
| 网络端点 | 仅 1 个 WebSocket：`game` → `wss://<网关域名>/ws`，`auth: "platform"`；不声明 HTTP 端点、不申请 `network.request` |
| 源码 | GitHub 公开仓库 `athlan20/slg`（`frontend/`、`backend/`），可按下文步骤复现构建 |
| 包大小 | `app.zip` 约 349 KiB；解压 5 个文件、约 1.17 MiB（限额 128 MiB / 单文件 32 MiB / 1024 个） |

### 权限与用途

| 权限 | 用途 | 对应代码 |
|---|---|---|
| `user.read` | 读取论坛登录状态：未登录论坛时只显示提示页、不连接后端 | `frontend/src/mapp/index.tsx` |
| `theme.read` | 皮肤默认值跟随平台深浅主题 | `frontend/src/mapp/theme.ts` |
| `network.websocket` | 连接游戏服务器（唯一端点 `game`） | `frontend/src/mapp/transport.ts` |
| `storage.read` / `storage.write` | 保存主题皮肤、语言、地图缩放、聊天已读位置等本机偏好；**不保存会话令牌** | `frontend/src/mapp/storage.ts` |

没有申请：`network.request`、`assets.remote`、`links.open`、设备类权限。应用内没有任何整页跳转、`window.open`、外链。

### WebSocket 端点说明

- 运营方：本游戏运营方；用途：游戏消息收发（与官网网页版同一套 JSON 协议，微应用版只多一个登录消息 `MAPP_LOGIN`）。
- 握手：平台把令牌放在 query `mini_app_token`，后端在 upgrade 前验签，失败返回 HTTP 401。
- 消息示例：
  - 请求 `{"op":158,"seq":1,"data":{}}`（不带任何身份参数）
  - 响应 `{"op":158,"seq":1,"ok":true,"data":{"sessionToken":"…","username":"ld_xxxxxx","created":true}}`
  - 随后 `{"op":1,"seq":2,"data":{"token":"<sessionToken>"}}` 完成登录。
  - 其余消息与网页版相同，不新增游戏协议。

### JWT 验证与业务授权

- 后端用 `node:crypto` 自行实现 ES256 验签（`backend/api/src/mapp/jwt.ts`），不依赖平台 SDK。固定校验：算法、`iss`、`aud`、应用 ID、`channel`、`exp/nbf`、端点 `htu` 与 query 键等，按 `docs/server-auth.md` 的规则。
- 公钥从固定的 `<社区地址>/mini-app-api/jwks` 获取并缓存，定期刷新；`kid` 不匹配时限频强刷一次；只接受一把 EC P-256 公钥且不含私钥分量。
- 令牌仅在握手时校验，已建连接不因令牌到期断开；每次重连重新验签。
- 业务授权：令牌只证明“这是哪位论坛用户”。服务端据此查号或首次建号，签发游戏自己的会话令牌；所有数值与奖励仍以服务端为准，不信任客户端。
- 信任等级门槛：沿用 `LINUXDO_MIN_TRUST_LEVEL`（默认 1）；令牌缺 `trust_level` 按 0 处理，被拒绝并提示。

### 沙箱与正式分开

- 后端 `MAPP_CHANNEL`（`sandbox` | `production`，必须显式配置）与令牌里的 `channel` 不一致一律 401；支持逗号分隔多个渠道。
- **部署**：沙箱联调连独立测试站（`slgtest.<域名>`，后端 `MAPP_CHANNEL=sandbox`，使用测试库）；正式连线上网关（`MAPP_CHANNEL=production`），两者不共用数据库，也不共用令牌。
- `MAPP_CHANNEL` 也支持逗号分隔多个渠道（如 `production,sandbox`），仅在确需同一网关同时接受两种令牌时使用，默认不用。

## 构建与打包（可复现）

平台 SDK 没有公开许可证，**不入库**：用环境变量指向本机克隆。

```bash
git clone https://github.com/linux-do/mapp-developer-guide.git
cd slg/frontend
export MAPP_SDK_DIR=/path/to/mapp-developer-guide/sdk
export MAPP_APP_ID=<社区「应用」页分配的应用 ID>
export MAPP_WSS_URL=wss://<网关域名>/ws     # 沙箱用测试域名，正式用线上域名
export MAPP_VERSION=1.0.0
npm run build:mapp     # 产出 dist-mapp/web/{app.js,app.css,index.html,manifest.json,strings.json}
npm run pack:mapp      # 产出 dist-mapp/package/app.zip
```

普通网站构建（`npm run build`）不受影响，产物里没有微应用代码与 SDK 引用。

## 后端环境变量

| 变量 | 说明 |
|---|---|
| `MAPP_ENABLED` | 总开关，默认关闭；关闭时带 `mini_app_token` 的请求一律 401，其他连接路径不变 |
| `MAPP_ISSUER` | 社区地址（可带子目录，不以 `/` 结尾） |
| `MAPP_APP_ID` | 平台分配的应用 ID |
| `MAPP_CHANNEL` | `production` 或 `sandbox`，必须显式指定；可逗号分隔多个（`production,sandbox`） |
| `MAPP_AUDIENCE` | 本服务对外的 WSS/HTTPS origin，用于 `aud` / `htu` 校验 |
| `MAPP_ORIGINS` | 允许建立微应用连接的浏览器 Origin，逗号分隔 |
| `MAPP_IDENTITY_PROVIDER` | 默认 `linuxdo`：沙箱实测令牌 `sub` 就是 Linux.do Connect 的数字用户 id（同一用户 `sub` 与 Connect 登录绑定的 subject 一致），微应用与跳转登录是同一个游戏账号；可选 `linuxdo_mapp`（两边分开） |
| `LINUXDO_MIN_TRUST_LEVEL` | 信任等级门槛，默认 1 |

部署要求：反向代理必须原样传递 `/ws` 路径与 query，否则令牌里的 `htu` 对不上。

## 验收与待实测

已自动验证：后端 / 前端类型检查、后端 mapp 单测（JWT、JWKS、握手、`MAPP_LOGIN`）、协议文档一致性、普通构建基线对比（主包 +1 KiB）、微应用产物检查（无 `new WebSocket(`、无整页跳转、`index.html` 无脚本与内联样式）。

**需要在沙箱里实测（尚未做）：**
1. `app.zip` 上传沙箱后能进入游戏；首屏渲染后 `lifecycle.ready()` 生效；首次进入自动建号，第二次进入是同一账号。
2. 未登录论坛时看到提示页，后端没有收到连接。
3. 信任等级 0 被拒绝并提示「论坛信任等级不足」；≥1 可玩。
4. 390px 手机与 ≥1024px 桌面、深浅主题可读；离开再打开后偏好还在。
5. **沙箱 CSP 对内联样式的限制**：既有代码里有 51 处 React `style=`（地图坐标、进度条宽度等）；如被拦，进度条和地图出征箭头会错位，需要改为 CSS 类。
6. `app.js` 里残留 react-dom 自带的一处 `contentWindow.location.href` 只读判断，不是业务跳转；若机械扫描报警，需向审核说明。
7. ~~平台 JWT 的 `sub` 是否等于 Connect 数字 id~~：已实测一致（同一用户两边都是同一个数字 id），默认账号体系已改为与跳转登录共用。

## 整体移除（审核不通过时）

删除新增的：`backend/api/src/mapp/`、`backend/common/src/protocol-doc-ops-mapp.ts`、`backend/test/mapp-*.test.ts`、`frontend/src/mapp/`、`frontend/mapp/`、`frontend/rsbuild.mapp.config.ts`、`frontend/src/storage.ts`、`frontend/.gitignore`、本文档；其余既有文件改动用 `git revert` 本需求的合入提交（或直接丢弃分支 `AISLG-261-linuxdo-mapp`）。协议号 113 与 `MAPP_LOGIN`（op 158）随之回退，`mcp/manifest` 重新同步即可。
