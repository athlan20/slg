# 开发 / 测试流程

一个需求或缺陷对应一个分支和一个 worktree。`test` 只用来集成测试，不往 `develop` 合。测试通过的是需求分支本身，由它合进 `develop`。

```text
develop ──start──▶ AISLG-229-短标题（worktree ../slg-AISLG-229）
                        │ to-test                 │ finish（测试通过后）
                        ▼                         ▼
                   test（worktree ../slg-test）   develop ──（发布时）──▶ main
```

| 目录 | 分支 | API / 前端端口 | 用途 |
|---|---|---|---|
| `slg/` | `develop` | 8080 / 8424 | 主目录，不在这里开发 |
| `slg-AISLG-229/` | `AISLG-229-短标题` | 见“隔离自测” | 开发和自测 |
| `slg-test/` | `test` | 9091 / 8425 | 集成测试，不改业务代码 |

## 四个步骤

| 步骤 | 做什么 | 命令 |
|---|---|---|
| 1. 开工 | 从 `develop` 拉分支，建同名 worktree，软链运行文件 | `scripts/req-start.sh AISLG-229 短标题` |
| 2. 开发 | 在 `../slg-AISLG-229` 开发、自测、提交 | |
| 3. 提测 | 需求分支先同步 `develop`，再合进 `test`，然后到 `slg-test/` 重启并测试 | `scripts/req-to-test.sh AISLG-229` |
| 4a. 不通过 | 回需求分支改，再重复第 3 步 | |
| 4b. 通过 | 需求分支合进 `develop`，删 worktree 和分支 | `scripts/req-finish.sh AISLG-229` |

脚本可以在任意 worktree 里运行，只做本地合并，不推送。`develop` 合 `main` 是发布动作，由人决定。

## 约定

- **分支名**：`需求号-短标题`。短标题只用汉字、字母、数字、`-`、`_`，不超过 20 字。
- **提交信息**：以需求号开头，如 `AISLG-229 feat: 行军上图`。
- **合并方式**：脚本一律用 `--no-ff`，合并提交写成 `AISLG-229-短标题：合入 test`，历史里能看出这批提交属于哪个需求。
- **冲突处理**：脚本遇到冲突就停下，退出码为 2。解决并 `git commit` 后重跑同一条命令。
- **自动校验**：提测和合入前，脚本会跑前后端类型检查、协议文档一致性、变更清单连续性和 MCP 清单副本比对，共十秒左右。这些不代替功能测试。
- **`test` 重置**：积累太乱时，用 `scripts/req-to-test.sh --reset AISLG-229` 把 `test` 重置成 `develop`。脚本会列出重置前还在 `test` 里的需求，仍要测试的逐个重新提测。
- **跳过测试**：`req-finish.sh` 默认要求需求分支最新提交已在 `test` 里。纯文档、脚本类改动可加 `--force`。只合并、不清理加 `--keep`。
- **`develop` 又前进了**：`req-finish.sh` 会自动同步。没有冲突就直接合入，不用重测。有冲突时，手工解决的结果也算改动，要重新提测。
- **没有需求号的小改动**：继续用 `chore/<名称>` 分支，手动 `git merge --no-ff` 进 `develop`。
- **`test` 这个名字**：根目录有 `test/` 目录，`git log test` 会报歧义，要写 `refs/heads/test`。

## 固定冲突文件

并行开发时，协议号几乎每次都撞，下面这些文件是固定的冲突点。

| 文件 | 解法 |
|---|---|
| `backend/common/src/protocol-version.ts` | 版本注释取并集，`PROTOCOL_VERSION` 取解决后的最大号 |
| `backend/common/src/protocol-changelog.ts` | 条目取并集，版本号重排成连续（单元测试校验 `1..PROTOCOL_VERSION`） |
| 新增的 op、推送号、错误码（`backend/common/src/protocol*.ts`、`frontend/src/api/protocol.ts`） | 取并集，撞号的往后排，前后端两边一起改 |
| `docs/agent-api.json`、`docs/agent-api.md` | 不手工合并。代码解决后在 `backend/` 下跑 `npm run gen:api-doc` |
| `mcp/manifest/agent-api.*` | 不手工合并。文档生成后在 `mcp/` 下跑 `npm run sync:manifest` |

**协议号以 `develop` 为准。** 需求分支用 `develop` 当前号加 1，这个号在合入 `develop` 前都是暂定的：

1. 合进 `test` 时撞号：只在 `test` 的合并提交里把后来者往后排，不回写需求分支。
2. 先通过的需求占住这个号。
3. 后通过的需求同步 `develop` 时会冲突，在需求分支上改成下一个号，代码注释和文档里的号一起改，再重新提测。
4. 重新提测时 `test` 上还会冲突一次：`develop` 已定的号以需求分支为准，其余还在测试的需求往后排。

`PROTOCOL_VERSION` 那一行两边改成同一个号时，git 不报冲突，只有变更清单报。解决时要两处一起看。

## 隔离自测

需求目录的 `backend/.env` 软链到共用开发库。API 启动时会跑 `ensureSchema`，所以**不要在需求目录直接 `./dev.sh`**，否则未提测的迁移会立刻改共用库。自测用临时库，端口按需求号算，多个 worktree 可以同时跑：

```bash
N=229 PG=$((17000+N)) PGDIR="$(mktemp -d)/pg"
initdb -D "$PGDIR" -U slg --auth=trust
pg_ctl -D "$PGDIR" -o "-p $PG -k ''" -l "$PGDIR.log" -w start
createdb -h 127.0.0.1 -p $PG -U slg slg

export DATABASE_URL=postgresql://slg@127.0.0.1:$PG/slg API_PORT=$((18000+N)) WEB_PORT=$((19000+N))
SERVICES=api ./dev.sh   # 新库先单独起 API，等建表和建世界跑完
./dev.sh                # 再起全套

./dev.sh stop
pg_ctl -D "$PGDIR" -m fast -w stop
```

- 临时库的 `time_scale` 默认是 50，要按真实时长验证时，在 `backend/` 下跑 `npx tsx --env-file=.env scripts/set-time-scale.ts 1`（已导出的 `DATABASE_URL` 优先于 `.env`）。
- `dev.sh` 的“数据库预检”读的是 `backend/.env`，看到的不是临时库，以 `/health` 和日志为准。
- `npm run test:e2e` 的 webServer 会复用 8080 上已有的 API，跑之前先看 8080 被谁占着。

## 共用资源

- **同一时刻只跑一个 Worker。** `slg/` 和 `slg-test/` 共用一个库，Worker 里排行榜、世界 tick 等没有行锁，跑两个会重复结算。`./dev.sh` 默认会起 Worker，切换前先在另一边跑 `SERVICES=worker ./dev.sh stop`。
- **`test` 上的需求可能被退回，但迁移退不回。** 重启 `slg-test/` 时迁移立刻作用到共用库，`slg/` 上的 `develop` 代码也要面对新表结构。改表结构要向后兼容；删数据、改数据的迁移先在临时库验证，提测前说明。
- **`dev.sh` / `stop.sh` 只管本目录的进程**（按工作目录识别）。不要用 `pkill`、`kill` 按进程名清理。
- **运行文件是软链。** `backend/.env`、`frontend/.env.local`、`CLAUDE.local.md`、屏蔽词表和各处 `node_modules` 都指向 `slg/`，不要单独维护。
- **改依赖要先断开软链。** 改 `package.json` 的需求，先删掉 worktree 里对应的 `node_modules` 软链再 `npm install`，否则会写到 `slg/`。合进 `test` 后，`slg-test/` 也要同样处理。
- **`slg/` 合入后要重启。** `req-finish.sh` 会改动 `slg/` 的文件，正在运行的服务按需重启。
- 测试环境 API 固定用 **9091**（8081 留给其他项目，不要再用）。

## 完成定义

1. 代码已提交，提交信息以需求号开头。
2. 测试按改动范围跑，比如 `cd backend && npx tsx --test test/<相关>.test.ts`。全量 `npm test` 只在改了公共代码或交付前跑一次。
3. 相关文档已同步。改协议先改文档和用例。
4. 工作项状态已更新，改完回查确认。脚本不会改状态，要等合并成功后再改。
5. 需要别人验收的，把验收要点写进工作项评论。

## 赛季（AISLG-134）

- 赛季表在服务首次启动时建好并播种第 1 季：终点缺省是启动时刻 + 28 天，**不是**线上要用的 2026-10-25 04:00（北京时间）。
- 首次启动前设 `SEASON_1_END=2026-10-25T04:00:00+08:00`；已经启动过的库（环境变量不再生效）在 `backend/` 下执行：`npm run season -- set-end 2026-10-25T04:00:00+08:00`，再用 `npm run season -- status` 确认。
- **不要在共用库上执行 `npm run season -- end-now`，也不要把终点改到过去**：会触发真实换季，清空整个世界的所有玩家数据。测换季请另起临时库。
- 新库上 API 与 Worker 不要同时首次启动，先起一个等 `ensureSchema` / `ensureWorld` 跑完（见上方“隔离自测”）。

## 搭建测试目录

第一次运行 `req-to-test.sh` 时，如果 `test` 或 `slg-test/` 不存在，脚本会自动建好并软链运行文件。`develop` 固定在 `slg/` 检出，`test` 固定在 `slg-test/` 检出。
