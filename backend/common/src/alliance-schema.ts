// 联盟的表结构（v66，AISLG-181）：与其他表一起由 db.ts 的 ensureSchema 幂等创建。
// 一个账号最多在一个联盟里（alliance_members.account_id 主键）；申请一人一条（alliance_requests.account_id 主键）。
// 换季：alliances / alliance_members 保留（社交关系跨季），alliance_requests / alliance_invites / alliance_marks 清空（见 season-tables.ts）。

export const ALLIANCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS alliances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  leader_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  notice text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 联盟名全服唯一，忽略大小写
CREATE UNIQUE INDEX IF NOT EXISTS idx_alliances_name ON alliances (lower(name));

CREATE TABLE IF NOT EXISTS alliance_members (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  alliance_id uuid NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  role text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alliance_members_alliance ON alliance_members (alliance_id);

-- 入盟申请：一个账号同一时间只有一条
CREATE TABLE IF NOT EXISTS alliance_requests (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  alliance_id uuid NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alliance_requests_alliance ON alliance_requests (alliance_id);

-- 邀请：同一联盟对同一账号只有一条（重复邀请覆盖）
CREATE TABLE IF NOT EXISTS alliance_invites (
  alliance_id uuid NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (alliance_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_alliance_invites_account ON alliance_invites (account_id);

-- 地图标记（v69，AISLG-184）：同一联盟同一格子只有一个标记（重复标记返回 ALLIANCE_MARK_EXISTS）。
-- 过期时刻到了不再返回，Worker 的 purgeExpired 定时回收；联盟解散随外键级联删除；换季清空（season-tables.ts）。
CREATE TABLE IF NOT EXISTS alliance_marks (
  id bigserial PRIMARY KEY,
  alliance_id uuid NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  x integer NOT NULL,
  y integer NOT NULL,
  kind text NOT NULL,
  text text NOT NULL DEFAULT '',
  creator_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT alliance_marks_cell_key UNIQUE (alliance_id, x, y)
);
CREATE INDEX IF NOT EXISTS idx_alliance_marks_expires ON alliance_marks (expires_at);

-- 联盟榜快照（v70，AISLG-185）：与 leaderboard_snapshots 同一批重算（Worker 整榜替换），每行一个名次。
-- 不挂外键：快照允许比联盟本身滞后一个刷新周期（解散后最多留到下次刷新）；换季清空（season-tables.ts）。
-- 名称与盟主名是快照时的展示口径；势力 value 为排名依据。
CREATE TABLE IF NOT EXISTS alliance_leaderboard_snapshots (
  id bigserial PRIMARY KEY,
  rank integer NOT NULL,
  alliance_id uuid NOT NULL,
  name text NOT NULL,
  leader_id uuid NOT NULL,
  leader_name text NOT NULL,
  member_count integer NOT NULL,
  value bigint NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alliance_leaderboard_rank ON alliance_leaderboard_snapshots (computed_at DESC, rank);

-- 联盟外交（v77，AISLG-195）：一对联盟一行，规范化 a_id < b_id。relation = friendly / hostile / neutral；
-- neutral 行只用于「解除友好后的 24 小时不可攻击 + 72 小时不可再结好」冷却（no_attack_until / refriend_after）。
-- 关系跨季保留（alliance_relations 在 season-tables 的 KEEP 里），邀请换季清空。
CREATE TABLE IF NOT EXISTS alliance_relations (
  a_id uuid NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  b_id uuid NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  relation text NOT NULL,
  established_at timestamptz NOT NULL DEFAULT now(),
  no_attack_until timestamptz,
  refriend_after timestamptz,
  PRIMARY KEY (a_id, b_id),
  CHECK (a_id < b_id)
);
CREATE INDEX IF NOT EXISTS idx_alliance_relations_b ON alliance_relations (b_id, relation);

-- 友好邀请：一方发出、另一方同意；48 小时过期。同一对联盟同一时间只有一条（反向重复邀请会覆盖）。
CREATE TABLE IF NOT EXISTS alliance_friend_invites (
  id bigserial PRIMARY KEY,
  from_alliance_id uuid NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  to_alliance_id uuid NOT NULL REFERENCES alliances(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT alliance_friend_invites_pair_key UNIQUE (from_alliance_id, to_alliance_id),
  CHECK (from_alliance_id <> to_alliance_id)
);
CREATE INDEX IF NOT EXISTS idx_alliance_friend_invites_to ON alliance_friend_invites (to_alliance_id);

-- 最近活跃时刻（登录、断线、在线期间每小时心跳刷新）：盟主长期不活跃自动转让的依据。
-- 不用 last_online_at：它只在玩家全部断线时才写，盟主一直在线时是旧值
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_active_at timestamptz;
-- 退出 / 被踢 / 解散后的冷却截止：期间不能创建也不能加入联盟
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS alliance_cooldown_until timestamptz;
`;
