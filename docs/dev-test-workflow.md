# 开发 / 测试并行流程

开发和测试各用一个 git 工作目录，端口分开，互不影响。

| | 开发目录 | 测试目录 |
|---|---|---|
| 路径 | `slg/` | `slg-test/`（`git worktree`，同级目录） |
| 分支 | `feat/<编号>-<名称>`、`fix/...` | `develop`（只 pull，不改代码） |
| API / 前端端口 | 8080 / 8424 | 8081 / 8425 |
| 启动 | `./dev.sh` | `API_PORT=8081 WEB_PORT=8425 ./dev.sh` |

## 日常流程

1. 从 `develop` 拉 `feat/<编号>-<名称>`，在开发目录开发、自测。
2. 自测过了就合入 `develop`，云效单转“测试中”。
3. 测试目录 `git pull` 后重启，在 8425 上测。
4. 测出问题回开发目录修，合入 `develop`，测试目录再 pull。
5. 测试通过后 `develop` 合入 `main` 上线。

## 注意

- **同一时刻只跑一个 Worker。** 两套环境共用一个库，Worker 里排行榜、世界 tick 等没有行锁，跑两个会重复结算。
  - 测试目录跑完整三件套；开发目录用 `SERVICES="api web" ./dev.sh` 不起 Worker。
  - 开发中要验证 Worker 逻辑时，先 `./dev.sh stop` 测试目录的 Worker，再在开发目录起。
- **共用库的迁移会立刻对两边生效。** 改表结构的需求要向后兼容，或提前通知测试。
- `dev.sh` / `stop.sh` 只管本目录的进程（按工作目录识别），不会误杀另一个目录的实例。
- 测试目录的 `backend/.env` 和 `node_modules` 用软链指向开发目录，不要单独维护。

## 首次搭建测试目录

```bash
git worktree add ../slg-test develop
cd ../slg-test
ln -s ../../slg/backend/.env backend/.env
ln -s ../../slg/backend/node_modules backend/node_modules
ln -s ../../slg/frontend/node_modules frontend/node_modules
ln -s ../slg/node_modules node_modules
API_PORT=8081 WEB_PORT=8425 ./dev.sh
```

`develop` 被测试目录占用后，开发目录不能再 checkout `develop`，从它拉新分支用 `git checkout -b feat/xxx develop` 即可。
