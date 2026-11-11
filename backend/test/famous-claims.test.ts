// 名将归属视图（AISLG-223；v104 AISLG-245 在野名将按人数展示）：
// 在野名将不再显示单一持有人（ownerUsername 恒为 null，改给 ownerCount = 全服拥有人数），还没人获得时
// wildAt 为 null、有人获得后才给落位坐标；名城 / 黄巾 / 势力首领 16 名仍显示持有人且 wildAt 恒为 null。
// 纯组装见 buildFamousClaims，loadFamousClaims 只负责查库后交给它。

import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_FAMOUS_HEROES } from '../common/src/hero';
import { buildFamousClaims, loadFamousClaims, type FamousClaimRow, type WildTileRow } from '../common/src/hero-db';
import { WILD_FAMOUS_NAMES } from '../common/src/hero-wild';

const GRANTED_AT = new Date('2026-11-04T01:02:03.000Z');

function wildTileOf(name: string, x: number, y: number, level: number): WildTileRow {
  return { wild_hero: name, x, y, level };
}

function viewOf(views: ReturnType<typeof buildFamousClaims>, name: string) {
  const view = views.find((v) => v.name === name);
  assert.ok(view, `${name} 应在名将列表中`);
  return view;
}

test('在野名将还没人获得：ownerCount 为 0、wildAt 为 null（即使地块上已落位）', () => {
  const views = buildFamousClaims([], [wildTileOf('关羽', 3, 4, 3)]);
  const guan = viewOf(views, '关羽');
  assert.equal(guan.ownerUsername, null);
  assert.equal(guan.ownerCount, 0);
  assert.equal(guan.grantedAt, null);
  assert.equal(guan.wildAt, null, '还没人获得时不泄露藏身位置');
});

test('在野名将有 1 人拥有：仍不显示持有人，给人数与落位坐标', () => {
  const claims: FamousClaimRow[] = [{ name: '关羽', owner_count: 1, granted_at: GRANTED_AT, username: 'alice' }];
  const views = buildFamousClaims(claims, [wildTileOf('关羽', 3, 4, 3)]);
  const guan = viewOf(views, '关羽');
  assert.equal(guan.ownerUsername, null, '在野名将不再显示单一持有人');
  assert.equal(guan.ownerCount, 1);
  assert.equal(guan.grantedAt, GRANTED_AT.toISOString());
  assert.deepEqual(guan.wildAt, { x: 3, y: 4, level: 3 });
});

test('在野名将有 N 人拥有（同名多行）：人数照实给，落位不变', () => {
  const claims: FamousClaimRow[] = [{ name: '关羽', owner_count: 37, granted_at: GRANTED_AT, username: 'alice' }];
  const views = buildFamousClaims(claims, [wildTileOf('关羽', 3, 4, 3)]);
  assert.equal(viewOf(views, '关羽').ownerCount, 37);
  assert.equal(viewOf(views, '关羽').ownerUsername, null);
});

test('名城 / 黄巾 / 首领仍显示持有人（ownerCount = 1），wildAt 恒为 null（即使地块上误带同名 wild_hero）', () => {
  const claims: FamousClaimRow[] = [
    { name: '吕布', owner_count: 1, granted_at: GRANTED_AT, username: 'bob' },
    { name: '张宝', owner_count: 1, granted_at: GRANTED_AT, username: 'carol' },
  ];
  const views = buildFamousClaims(claims, [wildTileOf('吕布', 1, 1, 5), wildTileOf('张宝', 2, 2, 5)]);
  assert.equal(viewOf(views, '吕布').ownerUsername, 'bob', '归属照常');
  assert.equal(viewOf(views, '吕布').ownerCount, 1);
  assert.equal(viewOf(views, '吕布').wildAt, null);
  assert.equal(viewOf(views, '张宝').ownerUsername, 'carol');
  assert.equal(viewOf(views, '张宝').wildAt, null);
  assert.equal(viewOf(views, '张角').ownerCount, 0, '未获得的黄巾名将');
  assert.equal(viewOf(views, '张角').wildAt, null);
});

test('全 45 名都列出；只有有人获得的在野名将带坐标，其余在野名将全部为 null', () => {
  const tiles = WILD_FAMOUS_NAMES.map((name, i) => wildTileOf(name, 10 + i, 20, 3));
  const claims: FamousClaimRow[] = [
    { name: '赵云', owner_count: 2, granted_at: GRANTED_AT, username: 'dave' },
    { name: '诸葛亮', owner_count: 1, granted_at: GRANTED_AT, username: 'erin' },
  ];
  const views = buildFamousClaims(claims, tiles);
  assert.equal(views.length, ALL_FAMOUS_HEROES.length);
  const withCoords = views.filter((v) => v.wildAt !== null).map((v) => v.name);
  assert.deepEqual(withCoords.sort(), ['赵云', '诸葛亮'].sort());
  assert.equal(views.filter((v) => v.ownerCount === 0 && v.wildAt !== null).length, 0, '没人获得就不给坐标');
  assert.equal(views.filter((v) => v.ownerUsername !== null && v.wildAt !== null).length, 0, '在野名将的坐标行不带持有人');
});

test('loadFamousClaims 查库后按同样规则组装（按名将聚合人数，未获得 → null）', async () => {
  const fakeDb = {
    query: async (sql: string) => {
      if (sql.includes('FROM famous_heroes')) {
        return { rows: [{ name: '关羽', owner_count: 3, granted_at: GRANTED_AT, username: 'frank' }] };
      }
      return { rows: [wildTileOf('关羽', 5, 6, 4), wildTileOf('赵云', 7, 8, 4)] };
    },
  };
  const views = await loadFamousClaims(fakeDb as unknown as Parameters<typeof loadFamousClaims>[0]);
  assert.deepEqual(viewOf(views, '关羽').wildAt, { x: 5, y: 6, level: 4 });
  assert.equal(viewOf(views, '关羽').ownerCount, 3);
  assert.equal(viewOf(views, '关羽').ownerUsername, null);
  assert.equal(viewOf(views, '赵云').ownerCount, 0);
  assert.equal(viewOf(views, '赵云').wildAt, null, '赵云还没人获得');
  assert.equal(viewOf(views, '吕布').wildAt, null);
});
