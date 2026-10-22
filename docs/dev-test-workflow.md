# 开发 / 测试并行流程

开发和测试各用一个 git 工作目录，端口分开，互不影响。

| | 开发目录 | 测试目录 |
|---|---|---|
| 路径 | `slg/` | `slg-test/`（`git worktree`，同级目录） |
| 分支 | `feat/<编号>-<名称>`、`fix/...` | `test`（只跟随 `develop`，ff-only 合入，不改代码） |
| API / 前端端口 | 8080 / 8424 | 8081 / 8425 |
| 启动 | `./dev.sh` | `API_PORT=8081 WEB_PORT=8425 ./dev.sh` |

## 日常流程

1. 从 `develop` 拉 `feat/<编号>-<名称>`，在开发目录开发、自测。
2. 自测过了就在开发目录合入 `develop`（`git switch develop && git merge feat/xxx`），云效单转“测试中”。
3. 测试目录同步 `develop`（见下节）后重启，在 8425 上测。
4. 测出问题回开发目录修，合入 `develop`，测试目录再同步一次。
5. 测试通过后 `develop` 合入 `main` 上线。

## 同步 develop 到测试目录

测试目录的 `test` 分支只在本地，没有上游，`git pull` 用不了。同步方式是快进合入：

```bash
cd ../slg-test
git merge --ff-only develop
```

- `--ff-only` 失败，说明 `test` 上有 `develop` 没有的提交，先查清楚再处理，不要强制覆盖。
- 不要在 `test` 上提交代码，测试目录里只做这一个合并动作。
- 同步后重启测试服务（`API_PORT=8081 WEB_PORT=8425 ./dev.sh`）再测。

## 赛季（AISLG-134）

- 赛季表在服务首次启动时建好并播种第 1 季：终点缺省是启动时刻 + 28 天，**不是**线上要用的 2026-10-25 04:00（北京时间）。
- 首次启动前设 `SEASON_1_END=2026-10-25T04:00:00+08:00`；已经启动过的库（环境变量不再生效）在 `backend/` 下执行：`npm run season -- set-end 2026-10-25T04:00:00+08:00`，再用 `npm run season -- status` 确认。
- **不要在共用库上执行 `npm run season -- end-now`，也不要把终点改到过去**：会触发真实换季，清空整个世界的所有玩家数据。测换季请另起临时库。
- 新库上 API 与 Worker 不要同时首次启动，先起一个等 `ensureSchema` / `ensureWorld` 跑完（见下方“注意”）。

## 注意

- **同一时刻只跑一个 Worker。** 两套环境共用一个库，Worker 里排行榜、世界 tick 等没有行锁，跑两个会重复结算。
  - 测试目录跑完整三件套；开发目录用 `SERVICES="api web" ./dev.sh` 不起 Worker。
  - 开发中要验证 Worker 逻辑时，先 `./dev.sh stop` 测试目录的 Worker，再在开发目录起。
- **共用库的迁移会立刻对两边生效。** 改表结构的需求要向后兼容，或提前通知测试。
- `dev.sh` / `stop.sh` 只管本目录的进程（按工作目录识别），不会误杀另一个目录的实例。
- 测试目录的 `backend/.env` 和 `node_modules` 用软链指向开发目录，不要单独维护。
- 开发目录在 `feat/...` 和 `develop` 之间切分支，会改变正在运行的开发服务读到的代码，切完按需重启（`SERVICES="api web" ./dev.sh`）。

## 首次搭建测试目录

```bash
git worktree add -b test ../slg-test develop
cd ../slg-test
ln -s ../../slg/backend/.env backend/.env
ln -s ../../slg/backend/node_modules backend/node_modules
ln -s ../../slg/frontend/node_modules frontend/node_modules
ln -s ../slg/node_modules node_modules
API_PORT=8081 WEB_PORT=8425 ./dev.sh
```

`develop` 在开发目录 `slg/` 上检出，测试目录固定在 `test`，两者不冲突。从 `develop` 拉需求分支用 `git switch -c feat/xxx develop`。
