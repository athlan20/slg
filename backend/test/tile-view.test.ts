// tileView 的 NPC 城驻军掩蔽规则单元测试（v17：总数由侦察快照解锁，未侦察为 0）。
// SQL 联表与各协议路径（GET_WORLD_MAP / GET_TILE / PUSH_TILE_STATE）由 scripts/smoke.ts 端到端覆盖。

import test from 'node:test';
import assert from 'node:assert/strict';
import { tileView } from '../api/src/views-world';

type TileQueryRowLike = Parameters<typeof tileView>[0];

function row(overrides: Partial<TileQueryRowLike>): TileQueryRowLike {
  return {
    x: 1,
    y: 2,
    terrain: 'plain',
    kind: 'wilderness',
    level: 1,
    owner_city_id: null,
    npc: null,
    plundered_at: null,
    owner_account_id: null,
    owner_username: null,
    owner_city_name: null,
    garrison: 0,
    intel_garrison: null,
    intel_stock: null,
    intel_at: null,
    ...overrides,
  };
}

test('NPC 城未侦察：garrison 为 0（即使联表驻军列有值也不暴露）', () => {
  const view = tileView(
    row({
      kind: 'npc_city',
      level: 2,
      garrison: 104,
      npc: {
        level: 2,
        garrison: { militia: 60, pikeman: 20, archer: 24 },
        stock: { gold: 0, wood: 500, food: 0, stone: 0, iron: 0 },
        buildings: {},
      },
    }),
  );
  assert.equal(view.garrison, 0);
});

test('NPC 城已侦察：garrison 为侦察快照的合计', () => {
  const view = tileView(
    row({
      kind: 'npc_city',
      level: 2,
      garrison: 104,
      intel_garrison: { militia: 60, pikeman: 20, archer: 24 } as TileQueryRowLike['intel_garrison'],
      intel_at: new Date('2026-09-28T09:20:16.205Z'),
    }),
  );
  assert.equal(view.garrison, 104);
});

test('野地与玩家城：驻军总数保持实时透传（负值与 null 按 0）', () => {
  assert.equal(tileView(row({ kind: 'wilderness', garrison: 38 })).garrison, 38);
  assert.equal(tileView(row({ kind: 'wilderness', garrison: null })).garrison, 0);
  assert.equal(tileView(row({ kind: 'city', garrison: -5 })).garrison, 0);
  // 野地不受侦察快照影响：有 intel 也按实时驻军列返回
  assert.equal(
    tileView(
      row({
        kind: 'wilderness',
        garrison: 9,
        intel_garrison: { militia: 1 } as TileQueryRowLike['intel_garrison'],
      }),
    ).garrison,
    9,
  );
});

// ---- v23（AISLG-55）：NPC 城池库存档位 ----

test('tileView：npcStockTier 按初始库存比例分档，非 NPC 城为 null', () => {
  // Lv2 初始库存合计 18000（4000+4000+4000+3000+3000）
  const npcRow = (stock: Record<string, number>) =>
    row({
      kind: 'npc_city',
      level: 2,
      npc: {
        level: 2,
        garrison: { militia: 60, pikeman: 20, archer: 24 },
        stock: { gold: 0, wood: 0, food: 0, stone: 0, iron: 0, ...stock },
        buildings: {},
      },
    });
  // >60%：丰厚
  assert.equal(tileView(npcRow({ gold: 10801 })).npcStockTier, 'rich');
  // 20%–60%：一般（60% 边界归一般）
  assert.equal(tileView(npcRow({ gold: 3600, wood: 3600, food: 3600 })).npcStockTier, 'normal');
  // <20%：见底
  assert.equal(tileView(npcRow({ wood: 3599 })).npcStockTier, 'low');
  // 0：已空
  assert.equal(tileView(npcRow({})).npcStockTier, 'empty');
  // 非 NPC 城：null
  assert.equal(tileView(row({ kind: 'wilderness', npc: null })).npcStockTier, null);
  assert.equal(tileView(row({ kind: 'city', owner_city_id: 'c1' })).npcStockTier, null);
});
