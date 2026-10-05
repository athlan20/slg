// 金矿地形（v19，AISLG-20）端到端冒烟：占领产金（territory.resource='gold'、
// 城池产金计入加成与采集）+ 掠夺金矿为空池（金币不可掠夺，只可占领生息）。
// 前置与 smoke-world 相同：API（建议 BUILD_SECONDS=2 RECRUIT_UNIT_SECONDS=1
// MARCH_SECONDS_PER_TILE=2）与 Worker 已启动；WS_URL 指向被测 API。
// 运行：WS_URL=ws://127.0.0.1:8080/ws npx tsx --env-file=.env scripts/smoke-gold-mine.ts

import { Op } from '../common/src/protocol';
import { PLUNDER_POOL_GOLD_PER_LEVEL, PLUNDER_POOL_RESOURCE_PER_LEVEL, TERRAIN_INFO, wildernessBonusRate } from '../common/src/world';
import { Client, check, dataOf, step, stepTotal } from './smoke-client';
import { fetchWindow, prepareMilitia, waitMarchOutcome, type TileLite } from './smoke-world-utils';

interface CityState {
  city: {
    x: number;
    y: number;
    production: Record<string, number>;
    territory: Array<{ x: number; y: number; resource: string; bonusRate: number; gatherRate: number; garrison: number }>;
  };
}

async function main(): Promise<void> {
  const account = `smoke_gold_${Date.now().toString().slice(-10)}`;
  console.log(`smoke target: ${process.env.WS_URL || 'ws://127.0.0.1:8080/ws'}, account: ${account}\n`);
  const player = await Client.connect();
  const login = await player.request(Op.LOGIN, { username: account, password: 'gold-mine-pass-123', asAgent: false });
  check(login.ok === true, '注册登录成功');

  step('v19 准备：军营 + 40 义兵（金矿与同级野地同一套原住守军）');
  await prepareMilitia(player, 50);

  step('v19 找金矿：主城默认窗口内存在 gold_mine 地块');
  const win = await fetchWindow(player);
  const mines = win.tiles.filter((tile) => tile.kind === 'wilderness' && tile.owner === null && tile.terrain === 'gold_mine');
  check(mines.length > 0, `窗口内找到无主金矿（${mines.length} 块）`);
  const target = mines.reduce((best, tile) => (tile.level < best.level ? tile : best), mines[0]) as TileLite;
  const tileRes = await player.request(Op.GET_TILE, { x: target.x, y: target.y });
  const tileDetail = (dataOf(tileRes).tile ?? {}) as { wilderness: { resource: string; bonusRate: number } | null };
  check(tileDetail.wilderness?.resource === 'gold', 'GET_TILE 收益预览 resource=gold');
  check(
    tileDetail.wilderness?.bonusRate === wildernessBonusRate('gold_mine', target.level),
    `金矿占领加成 = ${TERRAIN_INFO.gold_mine.bonusBase} + ${target.level} × ${TERRAIN_INFO.gold_mine.bonusPerLevel}/h（v21 基线 + 线性）`,
  );
  console.log(`  ✓ 目标金矿 (${target.x},${target.y}) Lv${target.level}`);

  step('v19 占领金矿：改归属、驻军、产金计入城池产量');
  const before = (dataOf(await player.request(Op.GET_STATE)) as unknown as CityState).city;
  const since = ((dataOf(await player.request(Op.GET_EVENTS, { limit: 5 })).events ?? []) as Array<{ id: number }>)
    .reduce((max, event) => Math.max(max, event.id), 0);
  const march = await player.request(Op.MARCH, { x: target.x, y: target.y, troops: { militia: 50 }, task: 'occupy' });
  check(march.ok === true, '占领金矿出征受理');
  const marchData = (dataOf(march).march ?? {}) as { arriveAt: string };
  const outcome = await waitMarchOutcome(player, since, Math.max(0, Date.parse(marchData.arriveAt) - Date.now()) + 30_000);
  check(outcome.outcome === 'battle_won' || outcome.outcome === 'plunder_won' || outcome.outcome === 'occupied', `行军结算 outcome=${outcome.outcome}`);
  const after = (dataOf(await player.request(Op.GET_STATE)) as unknown as CityState).city;
  const held = after.territory.find((tile) => tile.x === target.x && tile.y === target.y);
  check(held !== undefined && held.resource === 'gold', 'territory 记录金矿（resource=gold）');
  if (held) {
    check(held.bonusRate === wildernessBonusRate('gold_mine', target.level), `领地加成 ${held.bonusRate}/h（基线 ${TERRAIN_INFO.gold_mine.bonusBase} + 等级 × ${TERRAIN_INFO.gold_mine.bonusPerLevel}）`);
    check(held.gatherRate > 0, `驻军采集 ${held.gatherRate}/h 计入`);
    check(
      after.production.gold >= before.production.gold + held.bonusRate,
      `城池产金计入金矿（${before.production.gold} → ${after.production.gold}/h）`,
    );
  }

  step('v19 掠夺金矿为空池：战斗胜利但战利品为 0（金币只可占领生息）');
  {
    // 占领后城内无兵、人口也不够再征：召回金矿驻军（同时弃地），复用幸存部队
    // 掠夺同一块金矿（等级已知、原住守军刚被击败过一次，胜率最高）
    const recall = await player.request(Op.RECALL_GARRISON, { x: target.x, y: target.y });
    check(recall.ok === true, '召回金矿驻军（同时放弃占领）');
    await player.waitPush(Op.PUSH_MARCH_STATE, 60_000, (data) => data.reason === 'march_returned');
    console.log('  ✓ 驻军已撤回城内');
    let won = false;
    let loot: Record<string, number> = {};
    for (let attempt = 1; attempt <= 2 && !won; attempt += 1) {
      const armyNow = (dataOf(await player.request(Op.GET_STATE)) as unknown as { city: { army: { militia: number } } }).city.army.militia;
      check(armyNow > 0, `城内兵力恢复（义兵 ${armyNow}，第 ${attempt} 次出征）`);
      const plunder = await player.request(Op.MARCH, { x: target.x, y: target.y, troops: { militia: armyNow }, task: 'plunder' });
      check(plunder.ok === true, '掠夺金矿出征受理');
      const pm = (dataOf(plunder).march ?? {}) as { arriveAt: string };
      const sinceP = ((dataOf(await player.request(Op.GET_EVENTS, { limit: 5 })).events ?? []) as Array<{ id: number }>)
        .reduce((max, event) => Math.max(max, event.id), 0);
      const pOutcome = await waitMarchOutcome(player, sinceP, Math.max(0, Date.parse(pm.arriveAt) - Date.now()) + 30_000);
      won = pOutcome.outcome === 'plunder_won';
      loot = (pOutcome.detail.loot ?? {}) as Record<string, number>;
      if (!won) {
        console.log(`  - 第 ${attempt} 次掠夺战败（战斗随机性），战败方幸存者返程后重试`);
        await player.waitPush(Op.PUSH_MARCH_STATE, 60_000, (data) => data.reason === 'march_returned');
      }
    }
    check(won, '掠夺金矿最终胜利（plunder_won）');
    const total = Object.values(loot).reduce((sum, n) => sum + (Number(n) || 0), 0);
    check(
      total === 0 && (loot.gold ?? 0) === 0,
      `金矿掠夺战利品为 0（实际 ${JSON.stringify(loot)}；非金矿地形池为 ${PLUNDER_POOL_RESOURCE_PER_LEVEL}×等级地形资源 + ${PLUNDER_POOL_GOLD_PER_LEVEL}×等级金币，金矿保持空池）`,
    );
  }

  console.log(`\n全部 ${stepTotal()} 步通过：金矿（v19）验证成功`);
  await player.request(Op.RESET_ACCOUNT, { confirm: true });
  player.close();
}

main().catch((err) => {
  console.error('\n金矿冒烟失败：', err instanceof Error ? err.message : err);
  process.exit(1);
});
