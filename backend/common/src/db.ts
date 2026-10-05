// PostgreSQL 连接与表结构引导。
// 迁移工具尚未选定（见 docs/phase-1-mvp.md「尚未确定」），先用幂等 DDL + 咨询锁
// 保证 API / Worker 两进程并发启动时只建一次表；引入正式迁移工具时替换 ensureSchema。

import pg from 'pg';

/** Worker 完成建造后通知 API 的 PostgreSQL 通道名 */
export const NOTIFY_CHANNEL = 'slg_build_completed';

/** DDL 引导用的咨询锁 ID（任意固定值，两进程一致即可） */
const SCHEMA_LOCK_ID = 8721401;

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  /** libpq options（如 search_path）：需要用独立 schema 隔离验证环境时经 URL 参数透传 */
  options?: string;
}

/** 读取连接配置：DATABASE_URL 优先，其次 PG* 环境变量，最后本地默认值 */
export function readDbConfig(): DbConfig {
  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      host: url.hostname || '127.0.0.1',
      port: Number(url.port || 5432),
      user: decodeURIComponent(url.username || 'postgres'),
      password: decodeURIComponent(url.password) || undefined,
      database: url.pathname.replace(/^\//, '') || 'slg',
      options: url.searchParams.get('options') ?? undefined,
    };
  }
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || undefined,
    database: process.env.PGDATABASE || 'slg',
  };
}

export function createPool(applicationName: string, max = 5): pg.Pool {
  const config = readDbConfig();
  const pool = new pg.Pool({
    ...config,
    max,
    application_name: applicationName,
    // 只限制「从池里拿连接」（含新建 TCP 连接）的等待时长，不限制查询执行。
    // 数据库不可达（如 VPN 断开）时进程在启动阶段会卡在 ensureSchema 上：
    // 端口不监听、终端无任何输出，前端表现为 WebSocket 1006。加超时让它快速报错退出。
    connectionTimeoutMillis: 10_000,
  });
  // 空闲连接被网络中断（休眠唤醒、VPN/网络切换）时会触发池级 error；
  // 不挂处理器会让整个进程崩溃。打日志即可：死连接会被池丢弃并重建，
  // 进行中的查询按各自路径处理（Worker 下个 tick 重试、API 响应 INTERNAL）。
  pool.on('error', (err) => {
    console.error(`pg pool error (${applicationName}):`, err instanceof Error ? err.message : err);
  });
  // 检出中的连接同样可能因网络瞬断在两条查询之间抛 socket error；pg 对被检出的
  // client 错误不走池级 error，若无监听会以未捕获事件击穿进程（2026-09-27 实测：
  // 远端数据库瞬断导致 Worker 以 EADDRNOTAVAIL 崩溃）。挂监听记日志，死连接由池重建。
  pool.on('connect', (client) => {
    client.on('error', (err) => {
      console.error(`pg client error (${applicationName}):`, err instanceof Error ? err.message : err);
    });
  });
  return pool;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  signup_ip inet
);
-- 注册来源 IP（小号排查：按 IP 聚合注册数）。存量库补列，全新库由 CREATE 覆盖。
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS signup_ip inet;

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions (account_id);

-- v43 微信扫码登录（docs/wechat-qr-login.md）：纯微信账号没有密码，密码登录对其一律拒绝
ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL;
CREATE TABLE IF NOT EXISTS wechat_identities (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  app_id     text NOT NULL,          -- 以后换成小程序或网站应用时会有多个 AppID
  openid     text NOT NULL,
  unionid    text,                   -- 小游戏没绑开放平台时为空，留给以后迁移用
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, openid),
  UNIQUE (account_id, app_id)        -- 一个账号在同一个 AppID 下只绑一个微信
);
-- 区分浏览器会话和 Agent 令牌，方便列出和吊销
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'login';  -- login | agent_token
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS label text;

-- v44 Google 一键登录（AISLG-127）：一个 Google 账号（sub 唯一）只能绑一个游戏账号，
-- 一个游戏账号也只能绑一个 Google 账号。用户标识用 sub（永不变），email 仅展示存档（可变）
CREATE TABLE IF NOT EXISTS google_identities (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sub text NOT NULL UNIQUE,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id)
);

-- v45（AISLG-128）：第三方 OAuth 身份的共用表（Google 迁入 provider='google'，GitHub 用 provider='github'）。
-- 每个提供商内 subject 唯一（Google sub / GitHub 数字 id），一个账号每个提供商最多绑一个。
-- display_name 为展示名（Google email / GitHub login），可变、仅存档，不作绑定键
CREATE TABLE IF NOT EXISTS oauth_identities (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider text NOT NULL,
  subject text NOT NULL,
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject),
  UNIQUE (account_id, provider)
);
-- google_identities（v44）已有数据幂等迁入；此后全部读写走 oauth_identities
INSERT INTO oauth_identities (account_id, provider, subject, display_name, created_at)
SELECT account_id, 'google', sub, email, created_at FROM google_identities
ON CONFLICT DO NOTHING;

-- v46（AISLG-129）：每账号一个永久 Agent 令牌（sk_ 前缀）。原文入库是取舍——「随时可再显示」
-- 是本需求前提（复制给 AI 的提示词里自动带上）；登录按 token_hash（SHA-256）查。
-- id 是连接绑定的会话标识：LOGOUT 对它 DELETE sessions 是 0 行（不吊销永久令牌，只断连接），
-- RESET_AGENT_TOKEN 按 id 找到旧令牌的在线连接并断开
CREATE TABLE IF NOT EXISTS agent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
-- 上线清理：v43 的多令牌体系（sessions.kind='agent_token'，30 天过期）废弃，旧行删除（幂等）
DELETE FROM sessions WHERE kind = 'agent_token';

CREATE TABLE IF NOT EXISTS cities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  gold integer NOT NULL,
  wood integer NOT NULL,
  food integer NOT NULL,
  stone integer NOT NULL DEFAULT 0,
  iron integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cities_account ON cities (account_id);

-- 资源生产懒结算的锚点与微单位余数（见 common/src/production.ts）
ALTER TABLE cities ADD COLUMN IF NOT EXISTS stone integer NOT NULL DEFAULT 0;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS iron integer NOT NULL DEFAULT 0;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS settled_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cities ADD COLUMN IF NOT EXISTS food_rem integer NOT NULL DEFAULT 0;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS wood_rem integer NOT NULL DEFAULT 0;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS stone_rem integer NOT NULL DEFAULT 0;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS iron_rem integer NOT NULL DEFAULT 0;

-- v7：官府产金的余数、人口（当前值与增长余数）、城池数字等级（提升条件待设计，恒为 1）
ALTER TABLE cities ADD COLUMN IF NOT EXISTS gold_rem integer NOT NULL DEFAULT 0;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS population integer NOT NULL DEFAULT 0;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS population_rem integer NOT NULL DEFAULT 0;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 1;
-- v22（AISLG-40 方案 A）：主城被 NPC 攻破后的免战截止（免战期内不再入袭击目标池）
ALTER TABLE cities ADD COLUMN IF NOT EXISTS truce_until timestamptz;

CREATE TABLE IF NOT EXISTS builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  initiator text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
-- 到期时间在「立即开工」时写入；排队中（status='queued'）为 NULL（v4 建造队列）。
-- ADD COLUMN 保证全新库可引导（此前 CREATE TABLE 未含 due_at、仅存量库可用）
ALTER TABLE builds ADD COLUMN IF NOT EXISTS due_at timestamptz;
-- v22（AISLG-43）：连续升级的目标等级（UPGRADE toLevel 整链占一个队列位、逐级推进）
ALTER TABLE builds ADD COLUMN IF NOT EXISTS to_level integer;
ALTER TABLE builds ALTER COLUMN due_at DROP NOT NULL;
-- v7：发起时扣减的成本快照；取消排队条目时按它全额返还（占位规则）。
-- 旧数据无快照（'{}'），取消时按零返还
ALTER TABLE builds ADD COLUMN IF NOT EXISTS cost jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_builds_city_status ON builds (city_id, status);
CREATE INDEX IF NOT EXISTS idx_builds_due ON builds (due_at) WHERE status = 'building';
CREATE INDEX IF NOT EXISTS idx_builds_completed_at ON builds (completed_at) WHERE status = 'completed';

-- 城内建筑权威状态（v5 单实例 + 等级）：builds 表只作队列与历史，
-- 完成时由 Worker 把目标等级 upsert 进本表
CREATE TABLE IF NOT EXISTS city_buildings (
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  kind text NOT NULL,
  level integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, kind)
);
-- 旧数据回填：v5 之前完成的建造按各类型最高完成等级补入（幂等，只补缺失行）
INSERT INTO city_buildings (city_id, kind, level)
SELECT b.city_id, b.kind, max(b.level)
FROM builds b
WHERE b.status = 'completed'
  AND NOT EXISTS (SELECT 1 FROM city_buildings cb WHERE cb.city_id = b.city_id AND cb.kind = b.kind)
GROUP BY b.city_id, b.kind;

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  city_id uuid,
  build_id uuid,
  type text NOT NULL,
  initiator text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_events_account_id ON events (account_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_events_account_initiator ON events (account_id, initiator, id DESC);

-- v11：城内驻军（按兵种统计；征兵完成时由 Worker 累加，RESET_ACCOUNT 清空）
CREATE TABLE IF NOT EXISTS city_army (
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  troop text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (city_id, troop)
);

-- v11：征兵队列与历史（形态对齐 builds；cost/population/unit_seconds 为取消返还与
-- 队首激活重算的快照）。due_at 在立即征募时写入；排队中为 NULL
CREATE TABLE IF NOT EXISTS recruits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  troop text NOT NULL,
  count integer NOT NULL,
  status text NOT NULL,
  initiator text NOT NULL,
  cost jsonb NOT NULL DEFAULT '{}'::jsonb,
  population integer NOT NULL DEFAULT 0,
  unit_seconds integer NOT NULL DEFAULT 1,
  started_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_recruits_city_status ON recruits (city_id, status);
CREATE INDEX IF NOT EXISTS idx_recruits_due ON recruits (due_at) WHERE status = 'recruiting';
CREATE INDEX IF NOT EXISTS idx_recruits_completed_at ON recruits (completed_at) WHERE status = 'completed';

-- v10：Agent 自报计划的账号级最新快照（展示信息，非游戏状态；RESET_ACCOUNT 时清空）
CREATE TABLE IF NOT EXISTS agent_plans (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  next_action text,
  overall_plan text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- v23（AISLG-52）：玩家给 Agent 的作战方针（账号级最新快照；Agent 连接可查询、
-- 变更时推送给账号全部在线连接；服务端不校验执行，仅存储与转发）
-- 上线清理（v49）：作战方针模块整体移除（玩家改与自己的 Agent 直接讨论），表一并删掉（幂等）
DROP TABLE IF EXISTS agent_directives;

-- v23（AISLG-54）：玩家（非 Agent 连接）最近一次转为离线的时刻。玩家连接全部断开时
-- 写入（有多条玩家连接时不断开不算）；上线后由 GET_OFFLINE_REPORT 据此计算离线时长
-- 与离线期间的收获 / 损失汇总；此前从未离线（新号 / 未断开过）为 NULL
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_online_at timestamptz;

-- v23（AISLG-54）：Agent 定期写好的离线日报（账号级最新一份，重写覆盖；玩家上线
-- 经 GET_OFFLINE_REPORT 直接读最近一份，不现写）
CREATE TABLE IF NOT EXISTS agent_daily_reports (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  content text NOT NULL,
  written_at timestamptz NOT NULL DEFAULT now()
);

-- v23（AISLG-61）：累计掠夺量台账（掠夺入账时累加，四资源合计；排行榜用）。
-- 记在账号上：玩家与 Agent 打出的成绩算同一账号
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plunder_total bigint NOT NULL DEFAULT 0;

-- v23（AISLG-61）：排行榜快照（Worker 每 10 分钟整榜重算一次，查询读快照不实时全表统计）。
-- 每行一个名次：kind = power 综合战力 / territory 领地数量 / plunder 累计掠夺量
CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  rank integer NOT NULL,
  account_id uuid NOT NULL,
  username text NOT NULL,
  city_name text NOT NULL,
  value bigint NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leaderboard_kind_rank ON leaderboard_snapshots (kind, computed_at DESC, rank);
-- v50（AISLG-133）：玩家三榜条目带 Agent 自报模型（与 username 一样是展示快照；Worker 重算时回填）
ALTER TABLE leaderboard_snapshots ADD COLUMN IF NOT EXISTS agent_model text;

-- v50（AISLG-133）：Agent 自报模型（原文，限长 64，LOGIN asAgent=true 时以最近一次声明为准；
-- 自报不验证，排行榜标注「自报」）与最近一次 Agent 登录时刻（模型榜只统计最近 7 天上线过的账号）
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_model text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_last_seen_at timestamptz;

-- v50（AISLG-133）：模型榜快照（与 leaderboard_snapshots 同一批重算，每行一个模型的聚合）：
-- model_id 为归类标识（undeclared / other / 名单内模型 id，见 common/src/agent-models.ts），
-- value = 该模型实力前 10 名的平均战力（排名依据）
CREATE TABLE IF NOT EXISTS leaderboard_model_snapshots (
  id bigserial PRIMARY KEY,
  rank integer NOT NULL,
  model_id text NOT NULL,
  model_label text NOT NULL,
  players integer NOT NULL,
  top_avg_value bigint NOT NULL,
  top_player_username text,
  top_player_value bigint,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leaderboard_model_rank ON leaderboard_model_snapshots (computed_at DESC, rank);

-- v23（AISLG-57）：NPC 袭击预警与到达结算。袭击改为两阶段：Worker 按袭击间隔发起
-- （选定目标并固定编成，写入本表 + 预警事件 / 推送），到达时刻（预警提前量 =
-- 袭击基准间隔的 1/8，随 timeScale 缩放）由 Worker 结算战斗；预警期间玩家可增援
-- 或撤回驻军（到达时按最新驻军结算）。目标失效（召回 / 易主 / 免战）不战斗
-- v23（AISLG-60）：全服战况播报（只写大事，限频；断线重连可查最近 20 条）。
-- detail 按类型解释（username / cityName / x / y / level / streak），前端拼人话
CREATE TABLE IF NOT EXISTS server_broadcasts (
  id bigserial PRIMARY KEY,
  type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_server_broadcasts_recent ON server_broadcasts (id DESC);

-- v23（AISLG-60）：连胜计数（「1 小时内连胜 5 场」的判定状态；输一场即清零）
CREATE TABLE IF NOT EXISTS win_streaks (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  count integer NOT NULL DEFAULT 0,
  last_win_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS npc_attacks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  target_city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  x integer NOT NULL,
  y integer NOT NULL,
  target text NOT NULL,
  level integer NOT NULL,
  army jsonb NOT NULL,
  arrive_at timestamptz NOT NULL,
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_npc_attacks_due ON npc_attacks (arrive_at) WHERE resolved_at IS NULL;

-- v12：世界地块（权威地图状态）。kind：wilderness 野地 / npc_city NPC 城池 / city 玩家城池；
-- owner_city_id：占领野地或城池地块归属的城；npc 为 NPC 城池快照（被占领后清除）
CREATE TABLE IF NOT EXISTS world_tiles (
  x integer NOT NULL,
  y integer NOT NULL,
  terrain text NOT NULL,
  kind text NOT NULL,
  level integer NOT NULL DEFAULT 0,
  owner_city_id uuid REFERENCES cities(id) ON DELETE SET NULL,
  npc jsonb,
  PRIMARY KEY (x, y)
);
CREATE INDEX IF NOT EXISTS idx_world_tiles_owner ON world_tiles (owner_city_id) WHERE owner_city_id IS NOT NULL;
-- v16：最近一次成功掠夺（攻方胜利）的时间；按目标地块统一记录（野地 / NPC 城），
-- 24 小时冷却判定见 common/src/plunder.ts（inPlunderCooldown）。玩家城的冷却列留待 PvP 阶段
ALTER TABLE world_tiles ADD COLUMN IF NOT EXISTS plundered_at timestamptz;
-- v39（AISLG-123 玩家对抗二）：野地换主保护截止——被玩家抢占后 1 小时基准（随缩放）内
-- 谁都不能再抢这块地（玩家抢占与 NPC 袭击目标池都跳过）；无主化不设保护
ALTER TABLE world_tiles ADD COLUMN IF NOT EXISTS owner_changed_until timestamptz;

-- v24（AISLG-48）：未占领野地原住守军的战后存量。无行 = 满编；有行 = 战后幸存守军，
-- 按每小时恢复基准 25% 惰性回补（读取时按 updated_at 现算，见 common/src/native-garrison.ts）
CREATE TABLE IF NOT EXISTS native_garrison_state (
  x integer NOT NULL,
  y integer NOT NULL,
  remaining jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (x, y)
);

-- v24（AISLG-56）：名城登记（升格为名城的 NPC 城；被占领后地块转为玩家城，登记仍保留以防重复升格）
-- 与占领后的独占加成标记：cities.famous_name 非空 = 该城是名城分城，产量 +20%
CREATE TABLE IF NOT EXISTS famous_cities (
  name text PRIMARY KEY,
  x integer NOT NULL,
  y integer NOT NULL
);
ALTER TABLE cities ADD COLUMN IF NOT EXISTS famous_name text;

-- v12：地块驻军（占领野地的部队按兵种统计；未占领野地的原住守军不落库，战力按等级推导）
CREATE TABLE IF NOT EXISTS tile_army (
  x integer NOT NULL,
  y integer NOT NULL,
  troop text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (x, y, troop)
);

-- v12：行军。到达由 Worker 结算并写 resolved_at。purpose：v16 起 plunder=掠夺出征 /
-- occupy=占领出征 / scout=侦察 / transfer=调兵 / reinforce=增援自有野地 / return=召回
-- 与失效返程；attack 仅存量在途行军（升级前发起，走 legacy 结算路径）
CREATE TABLE IF NOT EXISTS marches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  from_city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  x integer NOT NULL,
  y integer NOT NULL,
  troops jsonb NOT NULL,
  purpose text NOT NULL,
  status text NOT NULL,
  initiator text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  arrive_at timestamptz NOT NULL,
  resolved_at timestamptz
);
-- v26（AISLG-79）：运输行军随行货物（Resources 形 jsonb；运输行军与其撤回 / 失效返程携带，其余为空）
ALTER TABLE marches ADD COLUMN IF NOT EXISTS cargo jsonb;
-- v35（AISLG-112）：截击埋伏——部队提前到达、开始原地埋伏的时刻；此时 arrive_at 顺延为预计
-- 接战时刻（= max(到达时刻, 目标进入相邻范围的时刻)）。非埋伏行军（含到达即接战与太晚扑空的
-- 截击）为 NULL。
ALTER TABLE marches ADD COLUMN IF NOT EXISTS ambush_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_marches_due ON marches (arrive_at) WHERE status = 'marching';
CREATE INDEX IF NOT EXISTS idx_marches_resolved ON marches (resolved_at) WHERE resolved_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marches_city ON marches (from_city_id, status);

-- v12：城池在世界中的坐标（主城注册 / 存量回填时分配；NPC 城池占领后的分城在原地）
ALTER TABLE cities ADD COLUMN IF NOT EXISTS x integer;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS y integer;

-- v13：战斗战报（每账号一行/场；攻方与被袭击的守方各得一份，双方可查询）。
-- detail 为完整战报视图载荷（双方编成 / 损失 / 逐回合统计）；id 自增作查询游标
CREATE TABLE IF NOT EXISTS battle_reports (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  x integer NOT NULL,
  y integer NOT NULL,
  kind text NOT NULL,
  detail jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_battle_reports_account ON battle_reports (account_id, id DESC);

-- v23（AISLG-53）：Agent 写回的战报点评（每份战报只保留最新一条，重写覆盖；独立列
-- 避免与 detail jsonb 的并发重写）。Agent 可经 AGENT_COMMENT_REPORT 覆盖更新
ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS agent_comment text;
ALTER TABLE battle_reports ADD COLUMN IF NOT EXISTS agent_commented_at timestamptz;

-- v13：侦察情报快照（账号 × 地块，最近一次侦察的守军 / 城墙 / 库存；GET_TILE 按此
-- 提供 NPC 城池详情——未侦察返回 null）
CREATE TABLE IF NOT EXISTS scout_intel (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  x integer NOT NULL,
  y integer NOT NULL,
  detail jsonb NOT NULL,
  scouted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, x, y)
);

-- v34（AISLG-107）：断粮哗变。mutiny_next_at = 已断粮（粮食 0 且净产量为负）时下一次哗变的时刻
-- （断粮起算 + 1 小时，随全局倍速缩放；恢复即清空）；starve_warned_at = 本轮断粮已发过预警的时刻（恢复 / 远离断粮即清空）
ALTER TABLE cities ADD COLUMN IF NOT EXISTS mutiny_next_at timestamptz;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS starve_warned_at timestamptz;

-- v29（AISLG-76）：黄巾之乱。yt_events = 周期性全服事件（同一时间至多一条 active）；yt_camps = 事件的营地与
-- 老巢（tier=boss；active 营地占用所在野地格，同格至多一个 active）；remaining / remaining_at = 战后守军存量
-- （按野地同口径每小时恢复 25%）；outer_cleared_at = 老巢外围清空时刻（限时内可攻城守）；
-- yt_contrib = 每人歼灭黄巾兵力累计（结束按名次发奖）
CREATE TABLE IF NOT EXISTS yt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  total_camps integer NOT NULL,
  cleared_camps integer NOT NULL DEFAULT 0,
  boss_appeared_at timestamptz,
  boss_cleared_at timestamptz,
  boss_cleared_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  finished_at timestamptz,
  finish_reason text,
  scattered_camps integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_yt_events_one_active ON yt_events (status) WHERE status = 'active';
CREATE TABLE IF NOT EXISTS yt_camps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES yt_events(id) ON DELETE CASCADE,
  x integer NOT NULL,
  y integer NOT NULL,
  tier text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  next_grow_at timestamptz,
  next_raid_at timestamptz,
  outer_cleared_at timestamptz,
  remaining jsonb,
  remaining_at timestamptz,
  cleared_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_yt_camps_tile_active ON yt_camps (x, y) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_yt_camps_event ON yt_camps (event_id, status);
CREATE TABLE IF NOT EXISTS yt_contrib (
  event_id uuid NOT NULL REFERENCES yt_events(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  killed integer NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, account_id)
);

-- v28（AISLG-78）：移动目标（运粮商队 / 流寇）。route = 路线 [[x,y]×24]，第 i 格从 started_at + i×步长起
-- 占据；步长 = (ends_at − started_at) ÷ 24（公开时刻表由此推出）；garrison / stock 为生成时的守军编成与
-- 携带资源（流寇路过玩家野地掠夺会增加 stock）；passed_index = 流寇已处理过掠夺的路线下标（防重复）。
-- marches.target_id = 截击行军指向的目标
CREATE TABLE IF NOT EXISTS moving_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  level integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  route jsonb NOT NULL,
  started_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  garrison jsonb NOT NULL,
  stock jsonb NOT NULL,
  passed_index integer NOT NULL DEFAULT -1,
  defeated_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_moving_targets_active ON moving_targets (ends_at) WHERE status = 'active';
ALTER TABLE marches ADD COLUMN IF NOT EXISTS target_id uuid;

-- v27（AISLG-77）：科技。account_techs = 账号级科技等级（全账号所有城共享，缺行 = 0 级）；
-- tech_research = 研究记录（同一账号同一时间只有一条 researching；cost 为发起时的成本快照，
-- 取消时据此全额返还；city_id 为发起研究 / 扣资源的城，也是返还的城）
CREATE TABLE IF NOT EXISTS account_techs (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tech text NOT NULL,
  level integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, tech)
);
CREATE TABLE IF NOT EXISTS tech_research (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  tech text NOT NULL,
  level integer NOT NULL,
  status text NOT NULL,
  initiator text NOT NULL,
  cost jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  due_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_tech_research_account ON tech_research (account_id, status);
CREATE INDEX IF NOT EXISTS idx_tech_research_due ON tech_research (due_at) WHERE status = 'researching';
CREATE UNIQUE INDEX IF NOT EXISTS idx_tech_research_one_active ON tech_research (account_id) WHERE status = 'researching';

-- v36（AISLG-114/115/116）：武将。account_heroes = 账号级武将（普通将从酒馆招募、名将从 PvE 获得）；
-- tavern_candidates = 每城酒馆的候选武将（读取时按 refreshed_at 惰性刷新，每 4 小时基准一批）；
-- famous_heroes = 名将全服归属（name 即名将主键；解雇武将级联删除归属行 → 名将回到可获得状态）。
-- cities.guard_hero_id = 城守；marches.hero_id = 随队武将（返程行军沿用，回城后自然释放）
CREATE TABLE IF NOT EXISTS account_heroes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  famous boolean NOT NULL DEFAULT false,
  lead integer NOT NULL,
  force integer NOT NULL,
  wit integer NOT NULL,
  level integer NOT NULL DEFAULT 1,
  exp integer NOT NULL DEFAULT 0,
  arrears boolean NOT NULL DEFAULT false,
  salary_at timestamptz NOT NULL DEFAULT now(),
  wounded_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_heroes_account ON account_heroes (account_id);
CREATE INDEX IF NOT EXISTS idx_account_heroes_salary ON account_heroes (salary_at);
CREATE TABLE IF NOT EXISTS tavern_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  name text NOT NULL,
  lead integer NOT NULL,
  force integer NOT NULL,
  wit integer NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tavern_candidates_city ON tavern_candidates (city_id);
CREATE TABLE IF NOT EXISTS famous_heroes (
  name text PRIMARY KEY,
  source text NOT NULL,
  hero_id uuid NOT NULL REFERENCES account_heroes(id) ON DELETE CASCADE,
  owner_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  granted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE cities ADD COLUMN IF NOT EXISTS guard_hero_id uuid;
ALTER TABLE marches ADD COLUMN IF NOT EXISTS hero_id uuid;
CREATE INDEX IF NOT EXISTS idx_marches_hero ON marches (hero_id) WHERE status = 'marching' AND hero_id IS NOT NULL;

-- v38（AISLG-122 玩家对抗一）：账号级保护状态。newbie_until = 新手保护截止（注册后 3 天随缩放，
-- 任一城官府升到 5 级或自己侦察 / 攻击其他玩家即失效）；self_truce_until = 主动免战截止（每周一次、
-- 12 小时）；self_truce_used_at = 上次开启时刻（周窗口判定）。城级被动免战沿用 cities.truce_until。
-- 存量账号不回填：保持 NULL = 已出保（老玩家不因上线本功能获得新手保护）
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS newbie_until timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS self_truce_until timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS self_truce_used_at timestamptz;

-- v40（AISLG-124 玩家对抗三）：分城城防值。durability = 当前值（NULL = 满值：主城永不落值、
-- 从未被打过的分城；守城战打赢一次降一截，降到 0 当场换主）；durability_settled_at = 上次结算时刻
--（回涨惰性结算：免战截止前不累计，之后每小时回涨 10，见 common/src/protection.ts settleDurability）
ALTER TABLE cities ADD COLUMN IF NOT EXISTS durability integer;
ALTER TABLE cities ADD COLUMN IF NOT EXISTS durability_settled_at timestamptz;

-- v20：运行时配置（key-value）。time_scale = 全局时间缩放（AISLG-38，加速验证节奏）：
-- 耗时类 ÷ scale、速率类 × scale；进程内缓存 TTL 刷新，切换无需重启
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

/**
 * 幂等地创建表结构；并发调用由咨询锁串行化。要求 PostgreSQL 13+（gen_random_uuid）。
 * 另一个进程（如已在跑的 Worker）正持有表行锁时，ALTER TABLE 的 ACCESS EXCLUSIVE 锁可能与其互等
 * 而被 PostgreSQL 判为死锁（40P01，本进程为牺牲者）——DDL 整体是幂等的，回滚后短暂退避重试即可。
 */
export async function ensureSchema(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${SCHEMA_LOCK_ID})`);
    for (let attempt = 1; ; attempt += 1) {
      try {
        await client.query(SCHEMA_SQL);
        return;
      } catch (err) {
        if ((err as { code?: string }).code !== '40P01' || attempt >= 5) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
      }
    }
  } finally {
    try {
      await client.query(`SELECT pg_advisory_unlock(${SCHEMA_LOCK_ID})`);
    } catch {
      // 连接已异常时放弃解锁；会话结束会自动释放咨询锁
    }
    client.release();
  }
}
