# 2026-10-25 发布（v0.1.6：联盟系统）

代码已在 `develop`，合入 `main` 后打 tag `v0.1.6`，协议版本 v70（v66~v70）。同时发布 slg-mcp（见第 3 步）。

## 1. 上线前

- **数据库不用手工迁移**：重启后 `ensureSchema` 会自动建联盟相关表（`alliances`、`alliance_members`、`alliance_requests`、`alliance_invites`、`alliance_marks`、`alliance_leaderboard_snapshots`），并给 `accounts` 加 `last_active_at`，给 `chat_messages` 加 `alliance_id`、`system_event`，给 `season_archives` 加联盟列。
- **新增 Worker 任务**：`alliance-tick`（每分钟扫一次盟主不活跃自动转让）随 Worker 启动，不需要新增环境变量。
- 联盟数值（建盟 10 万金币、30 人上限、势力权重等）是占位常量，在 `backend/common/src/protocol-alliance.ts`。要在上线前调整，先改常量再发布，**公告正文里的数字要一起改**。
- 确认赛季状态：在 `backend/` 下执行 `npm run season -- status`。联盟与成员关系跨赛季保留，换季不影响这次部署；**不要执行 `end-now`**。

## 2. 部署

1. 拉取 `main`（tag `v0.1.6`），安装依赖、构建前端。
2. 重启 API 与 Worker。**同一时刻只能跑一个 Worker。** 建议先起一个，等日志里 `ensureSchema` 跑完，再起另一个。
3. 抽查：登录后打开联盟面板，确认能看到「创建联盟」；聊天里有「联盟」页签；排行榜有「联盟」一栏。
4. 刷新 CDN 上的 Agent 文档（`agent-api.md` 与 `agent-api/changes/*`，地址见内部手册）。

## 3. 发布 slg-mcp

协议有变更，`mcp/package.json` 版本号要与 tag 一致（现在是 `0.1.4`）。改成 `0.1.6` 后，在 `mcp/` 下执行：

```
npm publish
```

`prepublishOnly` 会自动同步清单、跑测试、构建。

## 4. 发布公告

重启成功、抽查无误后，在 `backend/` 下用**线上的 `.env`** 执行：

```
npx tsx --env-file=.env scripts/announcement.ts publish \
  --category system \
  --title-zh "联盟系统上线" \
  --body-zh-file ../deploy/2026-10-25/announcement-zh.md \
  --title-en "Alliances are live" \
  --body-en-file ../deploy/2026-10-25/announcement-en.md \
  --strong on --pinned on --chat
```

- `--strong on`：玩家进主界面会弹窗，点「知道了」才算已读。`--chat` 同时在全服播报发一句标题。
- 公告会立即推送给在线玩家与 Agent，发之前请再核对一遍正文里的数值。
- 发错了用 `announcement.ts list` 找到编号，再 `edit <编号> ...` 修改或 `withdraw <编号>` 撤回（修改与撤回不再推送）。
- 之前的赛季公告如果还置顶着，用 `list` 看一下，已过期的可以 `withdraw`。
