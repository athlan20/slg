// 武将培养的表结构（v54，AISLG-144）：与其他表一起由 db.ts 的 ensureSchema 幂等创建（不另起迁移工具）。
// account_heroes 新增：base_* = 初始属性（洗点还原到它；存量武将回填为当前属性，即视为已分配、不回溯补点）；
// free_points = 未分配的自由点数；train_* = 历练中（到点由 Worker 结算经验）；gift_* / reset_* = 每游戏日次数。
// world_tiles 新增 wild_*：在野名将落位在该野地（开服分配后固定，见 wild-famous-db.ts）。
// hero_unlocks = 结交资格（打赢过该野地原住守军）；hero_friendship = 结交进度（好感 / 当日次数）。
// v94（AISLG-228 名将忠诚度与被俘）：account_heroes 新增 loyalty（只有在野名将非 NULL）、loyalty_at（自然下降
// 的结算锚点）、loyalty_warned（已发过 30 线提醒）、loyalty_arrears_at（欠饷每小时 −1 的锚点）、
// captured_by / captured_until（被俘的胜方账号与囚禁截止）。上线时已有的在野名将忠诚度 100，锚点为迁移时刻。
// hero_capture_limits = 每账号最近一次被俘时刻（7 天内最多被俘 1 名）。

import { WILD_FAMOUS_NAMES } from './hero-wild';

const WILD_NAMES_SQL = WILD_FAMOUS_NAMES.map((name) => `'${name}'`).join(', ');

export const HERO_SCHEMA_SQL = `
-- Specialties are assigned only to newly recruited ordinary heroes.
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS specialty text
  CHECK (specialty IS NULL OR (NOT famous AND specialty IN ('infantry', 'ranged', 'cavalry', 'siege', 'assault', 'defense')));
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS base_lead integer;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS base_force integer;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS base_wit integer;
UPDATE account_heroes SET base_lead = lead, base_force = force, base_wit = wit WHERE base_lead IS NULL;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS free_points integer NOT NULL DEFAULT 0;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS train_until timestamptz;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS train_tier integer;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS train_exp integer;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS gift_day bigint;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS gift_count integer NOT NULL DEFAULT 0;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS reset_day bigint;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS reset_count integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_account_heroes_training ON account_heroes (train_until) WHERE train_until IS NOT NULL;

ALTER TABLE world_tiles ADD COLUMN IF NOT EXISTS wild_hero text;
ALTER TABLE world_tiles ADD COLUMN IF NOT EXISTS wild_lead integer;
ALTER TABLE world_tiles ADD COLUMN IF NOT EXISTS wild_force integer;
ALTER TABLE world_tiles ADD COLUMN IF NOT EXISTS wild_wit integer;
CREATE UNIQUE INDEX IF NOT EXISTS uq_world_tiles_wild_hero ON world_tiles (wild_hero) WHERE wild_hero IS NOT NULL;

CREATE TABLE IF NOT EXISTS hero_unlocks (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  hero_name text NOT NULL,
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, hero_name)
);

ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS loyalty integer;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS loyalty_at timestamptz;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS loyalty_warned boolean NOT NULL DEFAULT false;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS loyalty_arrears_at timestamptz;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS captured_by uuid;
ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS captured_until timestamptz;
UPDATE account_heroes SET loyalty = 100, loyalty_at = now()
  WHERE famous AND loyalty IS NULL AND name IN (${WILD_NAMES_SQL});
CREATE INDEX IF NOT EXISTS idx_account_heroes_loyalty ON account_heroes (loyalty_at) WHERE loyalty IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_account_heroes_captive ON account_heroes (captured_until) WHERE captured_by IS NOT NULL;
CREATE TABLE IF NOT EXISTS hero_capture_limits (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  captured_at timestamptz NOT NULL DEFAULT to_timestamp(0)
);

CREATE TABLE IF NOT EXISTS hero_friendship (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  hero_name text NOT NULL,
  favor integer NOT NULL DEFAULT 0,
  day bigint,
  day_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, hero_name)
);
`;
