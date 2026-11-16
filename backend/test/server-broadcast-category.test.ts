// 全服播报的分类（v112，AISLG-260）：聊天「活动」页签与「系统播报」页签靠 serverBroadcastCategory 分流，
// 唯一出处在 common/src/protocol-server.ts。这里只校验纯函数与清单本身，不连数据库。

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  SERVER_BROADCAST_CATEGORIES,
  SERVER_BROADCAST_EVENT_TYPES,
  SERVER_BROADCAST_TYPES,
  isServerBroadcastCategory,
  isServerBroadcastType,
  serverBroadcastCategory,
} from '../common/src/protocol-server';

describe('全服播报分类（纯函数）', () => {
  test('活动类清单里的每一项都是合法播报类型、没有重复、归类为 event', () => {
    assert.equal(new Set(SERVER_BROADCAST_EVENT_TYPES).size, SERVER_BROADCAST_EVENT_TYPES.length, '清单里不应有重复类型');
    for (const type of SERVER_BROADCAST_EVENT_TYPES) {
      assert.ok(isServerBroadcastType(type), `${type} 不是合法的播报类型`);
      assert.equal(serverBroadcastCategory(type), 'event', `${type} 应归到活动页签`);
    }
  });

  test('不在活动清单里的类型一律归 war（其余战况与大事）', () => {
    const eventTypes = new Set<string>(SERVER_BROADCAST_EVENT_TYPES);
    for (const type of SERVER_BROADCAST_TYPES) {
      const expected = eventTypes.has(type) ? 'event' : 'war';
      assert.equal(serverBroadcastCategory(type), expected, `${type} 的分类不对`);
    }
    // 需求点名的 war 类型（城被掠空 / 连胜 / 占领分城 / 名将获得 / 爵位晋升 / 竞技场第一 / 将星塔 / 公告类 / 迷雾类）
    for (const type of [
      'npc_city_emptied',
      'win_streak',
      'city_conquered',
      'hero_granted',
      'nobility_promoted',
      'arena_champion',
      'star_tower_cleared',
      'announcement',
      'famous_first_explored',
      'hero_site_first_explored',
      'legendary_relic_claimed',
    ]) {
      assert.equal(serverBroadcastCategory(type), 'war', `${type} 应留在系统播报`);
    }
    // 需求点名的活动类型（战场 / 洛阳 / 黄巾 / 势力 / 赛季）
    for (const type of [
      'battlefield_signup',
      'battlefield_start_soon',
      'battlefield_started',
      'battlefield_stronghold',
      'battlefield_wind',
      'battlefield_finished',
      'luoyang_window',
      'yt_started',
      'yt_grown',
      'yt_boss',
      'yt_boss_first_kill',
      'yt_finished',
      'faction_season_started',
      'faction_expanded',
      'faction_city_swallowed',
      'faction_lair_destroyed',
      'faction_suppressed',
      'season_ending',
    ]) {
      assert.equal(serverBroadcastCategory(type), 'event', `${type} 应进活动页签`);
    }
  });

  test('未知类型按 war 兜底，category 枚举与校验函数一致', () => {
    assert.equal(serverBroadcastCategory('not_a_broadcast'), 'war');
    assert.equal(serverBroadcastCategory(''), 'war');
    assert.deepEqual([...SERVER_BROADCAST_CATEGORIES], ['event', 'war']);
    assert.equal(isServerBroadcastCategory('event'), true);
    assert.equal(isServerBroadcastCategory('war'), true);
    assert.equal(isServerBroadcastCategory('EVENT'), false);
    assert.equal(isServerBroadcastCategory('battlefield_signup'), false);
    assert.equal(isServerBroadcastCategory(undefined), false);
    assert.equal(isServerBroadcastCategory(1), false);
  });
});