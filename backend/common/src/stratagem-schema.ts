// 计谋（AISLG-211，v86）的表结构：与其他表一起由 db.ts 的 ensureSchema 幂等创建（不另起迁移工具）。
// account_stratagem_tokens：4 类计谋令的持有数（战场商店军功兑换，换季随军功一起清零）；
// city_stratagem_effects：城级持续效果（deception 欺敌 / loot_fire 趁火打劫 / ambush_all_sides 十面埋伏），
//   读取时判断 until > now()，过期行惰性忽略并定期清理；
// stratagem_immunity：成功中计后的免疫行（target_type = city / march / npc_attack / account）；
// account_heroes.stratagem_cooldown_until：施计武将冷却；marches.stratagem_used：金蝉脱壳每支只能用一次。

export const STRATAGEM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS account_stratagem_tokens (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, kind)
);

CREATE TABLE IF NOT EXISTS city_stratagem_effects (
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  kind text NOT NULL,
  param integer NOT NULL DEFAULT 0,
  until timestamptz NOT NULL,
  PRIMARY KEY (city_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_city_stratagem_effects_until ON city_stratagem_effects (until);

CREATE TABLE IF NOT EXISTS stratagem_immunity (
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  kind text NOT NULL,
  until timestamptz NOT NULL,
  PRIMARY KEY (target_type, target_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_stratagem_immunity_until ON stratagem_immunity (until);

ALTER TABLE account_heroes ADD COLUMN IF NOT EXISTS stratagem_cooldown_until timestamptz;
ALTER TABLE marches ADD COLUMN IF NOT EXISTS stratagem_used boolean NOT NULL DEFAULT false;
`;
