# 2026-10-22 发布（v0.1.4：赛季系统、名城加强）

代码已合入 `main`，tag `v0.1.4`，协议版本 v65。slg-mcp 0.1.4 的 npm 发布另行处理。

## 1. 上线前：赛季终点（最重要）

首次启动时会自动建赛季表并把当前世界认作第 1 季。**终点缺省是启动时刻 + 28 天，不是我们要的时间**，所以在 API、Worker 的环境变量里加：

```
SEASON_1_END=2026-10-25T04:00:00+08:00
```

已经启动过的库（环境变量不再生效），在 `backend/` 下执行：

```
npm run season -- set-end 2026-10-25T04:00:00+08:00
npm run season -- status        # 确认终点是 2026-10-25 04:00（北京时间）
```

注意：**不要执行 `npm run season -- end-now`，也不要把终点改到过去**，会立刻触发真实换季，清空整个世界。

## 2. 部署

1. 拉取 `main`（tag `v0.1.4`），安装依赖、构建前端。
2. 重启 API 与 Worker。**同一时刻只能跑一个 Worker。** 建议先起一个，等日志里 `ensureSchema` 与世界初始化跑完，再起另一个。
3. 确认 `season.ts status` 输出正常。
4. 刷新 CDN 上的 Agent 文档（`agent-api.md` 与 `agent-api/changes/*`，地址见内部手册）。

## 3. 发布公告

重启成功、赛季终点确认无误后，在 `backend/` 下用**线上的 `.env`** 执行：

```
npx tsx --env-file=.env scripts/announcement.ts publish \
  --category system \
  --title-zh "第 1 赛季将于 10 月 25 日凌晨 4 点结束" \
  --body-zh-file ../deploy/2026-10-22/announcement-zh.md \
  --title-en "Season 1 ends Oct 25 at 04:00" \
  --body-en-file ../deploy/2026-10-22/announcement-en.md \
  --strong on --pinned on --chat
```

- `--strong on`：玩家进主界面会弹窗，点「知道了」才算已读。`--chat` 同时在全服播报发一句标题。
- 公告会立即推送给在线玩家与 Agent，发之前请再核对一遍正文里的日期。
- 发错了用 `announcement.ts list` 找到编号，再 `edit <编号> ...` 修改或 `withdraw <编号>` 撤回（修改与撤回不再推送）。
- 之后赛季系统会在结束前 3 天、1 天、1 小时、10 分钟自动再发预告，不用手动发。
