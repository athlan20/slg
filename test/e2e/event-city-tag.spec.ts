// 动态流的城池名称标签（AISLG-213 / GitHub issue #31）：多城账号的「最近动态」与「Agent 操作记录」每行
// 在发起者标签与正文之间显示该事件的城池名称标签（最长 6 字、超出省略、悬停给全名、点标签切城）；
// 只有 1 座城时不显示标签；事件带 cityId 但城池已不在名下（已放弃 / 名城被占走）显示「原城池」且不可点。
// 事件直接落库（字段与 insertEvent 写入的一致），不依赖 Worker 计时，避免与建造结算竞态。
// 前置条件与其他 e2e 一致（playwright.config.ts 会拉起后端与前端）。

import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { databaseUrl, seedAccount } from '../account-seed';
import { E2E_PASSWORD, gotoPage, loginViaForm, uniqueUsername } from './helpers';

const requireFromBackend = createRequire(path.join(__dirname, '../../backend/package.json'));
const pg = requireFromBackend('pg') as typeof import('pg');

async function sql(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  try {
    const res = await pool.query(text, params);
    return res.rows as Record<string, unknown>[];
  } finally {
    await pool.end();
  }
}

/** 账号 id 与主城（建号时自动创建，名字固定「主城」） */
async function mainCity(username: string): Promise<{ accountId: string; cityId: string }> {
  const rows = await sql(
    `SELECT a.id AS account_id, c.id AS city_id
       FROM accounts a JOIN cities c ON c.account_id = a.id
      WHERE a.username = $1
      ORDER BY c.created_at LIMIT 1`,
    [username],
  );
  if (rows.length === 0) {
    throw new Error(`账号 ${username} 没有主城`);
  }
  return { accountId: rows[0].account_id as string, cityId: rows[0].city_id as string };
}

/** 给账号加一座分城：挑一块无主荒野格，改成该分城的城池格（字段与 npc-occupy 落库一致） */
async function addBranchCity(username: string, name: string): Promise<string> {
  const tiles = await sql(
    `SELECT x, y FROM world_tiles WHERE kind = 'wilderness' AND owner_city_id IS NULL AND npc IS NULL ORDER BY random() LIMIT 1`,
  );
  if (tiles.length === 0) {
    throw new Error('库里没有可用的无主荒野格');
  }
  const x = Number(tiles[0].x);
  const y = Number(tiles[0].y);
  const rows = await sql(
    `INSERT INTO cities (account_id, name, gold, wood, food, x, y, origin_level)
     SELECT id, $2::text, 0, 0, 0, $3::int, $4::int, 1 FROM accounts WHERE username = $1 RETURNING id`,
    [username, name, x, y],
  );
  const cityId = rows[0].id as string;
  await sql(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 1)`, [cityId]);
  await sql(`UPDATE world_tiles SET kind = 'city', level = 0, owner_city_id = $1, npc = NULL WHERE x = $2 AND y = $3`, [cityId, x, y]);
  return cityId;
}

/** 落一条事件（cityId 传 null 即账号级事件） */
async function addEvent(
  accountId: string,
  cityId: string | null,
  type: string,
  initiator: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await sql(
    `INSERT INTO events (account_id, city_id, type, initiator, detail) VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [accountId, cityId, type, initiator, JSON.stringify(detail)],
  );
}

test.describe('动态流城池名称标签（AISLG-213）', () => {
  test('多城账号：带 cityId 的事件显示城池标签（超长截断、悬停全名、点击切城），查不到的城显示原城池，账号级事件不显示', async ({ page }) => {
    const username = uniqueUsername('e2e_citytag');
    // 7 个字，验证「最长 6 字 + 省略号」
    const branchName = '长名分城测试城';
    await seedAccount(username, E2E_PASSWORD);
    const { accountId, cityId: mainCityId } = await mainCity(username);
    const branchCityId = await addBranchCity(username, branchName);
    // 两座城各完成一次官府升级（就是 issue 里「两行一模一样的文字」的场景）
    await addEvent(accountId, mainCityId, 'build_completed', 'player', { kind: 'government', level: 2 });
    await addEvent(accountId, branchCityId, 'build_completed', 'player', { kind: 'government', level: 2 });
    // Agent 在分城征募（Agent 页「Agent 操作记录」用）
    await addEvent(accountId, branchCityId, 'recruit_completed', 'agent', { troop: 'archer', count: 50 });
    // 城池已不在名下（随机 uuid 不在城池列表里）→ 「原城池」
    await addEvent(accountId, '00000000-0000-4000-8000-000000000213', 'build_completed', 'player', { kind: 'wall', level: 2 });
    // 账号级事件（无 cityId）→ 不显示标签
    await addEvent(accountId, null, 'agent_connected', 'agent', {});
    await loginViaForm(page, username);
    await gotoPage(page, '情报');

    const list = page.locator('[role="事件面板-列表"]');
    const tags = list.locator('[role="事件面板-城池标签"]');
    const clickableTags = list.locator('button[role="事件面板-城池标签"]');

    // 情报页不显示 Agent 条目（excludeActor）：带 cityId 的 3 条（主城 / 分城 / 查不到的城）都有标签，账号级那条没有
    await expect(tags.first()).toBeVisible();
    await expect(tags).toHaveCount(3);
    await expect(clickableTags).toHaveCount(2);

    // 主城标签：文字是「主城」，点它切城可用
    const mainTag = clickableTags.filter({ hasText: '主城' }).first();
    await expect(mainTag).toBeVisible();

    // 分城标签：7 字名截断到 6 字 + 省略号，title 给全名
    const branchTag = clickableTags.filter({ hasText: '长名分城测试…' }).first();
    await expect(branchTag).toBeVisible();
    await expect(branchTag).toHaveAttribute('title', `${branchName}（点击切换到该城）`);

    // 查不到的城：显示「原城池」，且不是按钮（不可点）
    const goneTag = list.locator('span[role="事件面板-城池标签"]').first();
    await expect(goneTag).toHaveText('原城池');
    await expect(goneTag).toHaveAttribute('title', '该城已不在名下');

    // 点分城标签 = 切换到该城（侧栏当前城池名跟着变）
    await branchTag.click();
    await expect(page.locator('[role="导航-城池名"]')).toHaveText(branchName);

    // Agent 页「Agent 操作记录」同样生效
    await gotoPage(page, 'Agent');
    const agentList = page.locator('[role="Agent页-操作记录-列表"]');
    await expect(agentList).toContainText('弓箭兵');
    await expect(agentList.locator('[role="事件面板-城池标签"]')).toHaveCount(1);
    await expect(agentList.locator('[role="事件面板-城池标签"]')).toHaveText('长名分城测试…');
  });

  test('单城账号：动态里不显示城池标签', async ({ page }) => {
    const username = uniqueUsername('e2e_citytag_solo');
    await seedAccount(username, E2E_PASSWORD);
    const { accountId, cityId } = await mainCity(username);
    await addEvent(accountId, cityId, 'build_completed', 'player', { kind: 'government', level: 2 });
    await loginViaForm(page, username);
    await gotoPage(page, '情报');

    const list = page.locator('[role="事件面板-列表"]');
    // 事件本身在（正文是官府升级），只是没有城池标签
    await expect(list).toContainText('官府');
    await expect(list.locator('[role="事件面板-城池标签"]')).toHaveCount(0);
  });
});
