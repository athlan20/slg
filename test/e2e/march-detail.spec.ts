// AISLG-215（GitHub #33）：行军列表看详情——运输显示物资、行军详情弹窗。
// 覆盖验收 1（运输行内物资摘要与 3 项上限）、2（弹窗物资完整数量与兵种合计）、4（返程标题「随队带回」）。
// 前置：playwright.config.ts 会拉起后端与前端；行军行直接落库（字段与真实运输开局一致：
// purpose='transport'/'return' + cargo jsonb + supply_wagon 辎重车），arrive_at 放 1 小时后，
// 保证看的过程中不会被 Worker 结算掉。
// 未覆盖：ESC / 到达后「该行军已结束」（需要真实结算时序，容易 flaky，靠组件逻辑保证）。

import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { E2E_PASSWORD, gotoPage, loginViaForm, uniqueUsername } from './helpers';
import { databaseUrl, seedAccount } from '../account-seed';

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

/** 主城 id 与坐标 */
async function mainCity(username: string): Promise<{ cityId: string; x: number; y: number }> {
  const rows = await sql(`SELECT id, x, y FROM cities WHERE account_id = (SELECT id FROM accounts WHERE username = $1) ORDER BY created_at LIMIT 1`, [username]);
  if (rows.length === 0) throw new Error('账号没有主城');
  return { cityId: rows[0].id as string, x: Number(rows[0].x), y: Number(rows[0].y) };
}

/** 落一条在外行军（默认 3 个辎重车、1 小时后到达） */
async function seedMarch(
  username: string,
  target: { x: number; y: number },
  opts: { purpose?: 'transport' | 'return'; cargo: Record<string, number>; troops?: Record<string, number> },
): Promise<void> {
  const city = await mainCity(username);
  const troops = opts.troops ?? { supply_wagon: 3 };
  await sql(
    `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, started_at, arrive_at, cargo)
     VALUES ((SELECT id FROM accounts WHERE username = $1), $2, $3, $4, $5::jsonb, $6, 'marching', 'player', now(), now() + interval '1 hour', $7::jsonb)`,
    [username, city.cityId, target.x, target.y, JSON.stringify(troops), opts.purpose ?? 'transport', JSON.stringify(opts.cargo)],
  );
}

test.describe('行军详情（AISLG-215）', () => {
  test('运输行军的行内物资摘要与详情弹窗（兵种 / 物资完整数量）', async ({ page }) => {
    const username = uniqueUsername('e2e_march_detail');
    await seedAccount(username, E2E_PASSWORD);
    const city = await mainCity(username);
    // 三支运输队：粮 5200 / 木 2000 + 铁 800 / 四项各 100（验证 3 项上限与顺序）
    await seedMarch(username, { x: city.x + 1, y: city.y }, { cargo: { food: 5200 } });
    await seedMarch(username, { x: city.x + 2, y: city.y }, { cargo: { wood: 2000, iron: 800 } });
    await seedMarch(username, { x: city.x + 3, y: city.y }, { cargo: { gold: 100, wood: 100, food: 100, stone: 100 } });
    await loginViaForm(page, username);
    await gotoPage(page, '军队');

    const rows = page.locator('[role="军队页-行军-列表"] [role="行军条目"]');
    await expect(rows).toHaveCount(3);

    // 1) 行内第二行：兵种摘要 · 物资摘要 · 状态；按金木粮石铁顺序，最多 3 项，多出来的折成 …
    await expect(rows.filter({ hasText: `(${city.x + 1},${city.y})` }).locator('[role="行军-详情摘要"]')).toHaveText('辎3 · 粮5.2k · 行军');
    await expect(rows.filter({ hasText: `(${city.x + 2},${city.y})` }).locator('[role="行军-详情摘要"]')).toHaveText('辎3 · 木2k 铁800 · 行军');
    const manyRow = rows.filter({ hasText: `(${city.x + 3},${city.y})` });
    await expect(manyRow.locator('[role="行军-详情摘要"]')).toHaveText('辎3 · 金100 木100 粮100… · 行军');

    // 2) 点「详情」：弹窗里物资逐项完整数量（不缩写），兵种明细与合计对得上
    await manyRow.locator('[role="行军-详情按钮"]').click();
    const modal = page.locator('[role="行军详情弹窗"]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[role="行军详情弹窗-任务"]')).toContainText('运输');
    await expect(modal.locator('[role="行军详情弹窗-路线行"]')).toContainText(`(${city.x + 3},${city.y})`);
    await expect(modal.locator('[role="行军详情弹窗-兵种"]')).toContainText('辎重车');
    await expect(modal.locator('[role="行军详情弹窗-兵种合计"]')).toHaveText('合计 3');
    await expect(modal.locator('[role="行军详情弹窗-将领行"]')).toHaveText('无');
    const cargo = modal.locator('[role="行军详情弹窗-物资"]');
    await expect(cargo).toContainText('运送物资');
    await expect(cargo.locator('[role="行军详情弹窗-物资行"]').filter({ hasText: '金' })).toContainText('100');
    await expect(cargo.locator('[role="行军详情弹窗-物资行"]').filter({ hasText: '石' })).toContainText('100');

    // 3) 弹窗里点「撤回」：弹窗关闭（行军变成返程，行为与行内撤回一致）
    const recall = modal.locator('[role="行军详情弹窗-撤回按钮"]');
    await expect(recall).toBeVisible();
    await recall.click();
    await expect(modal).toBeHidden();
  });

  test('运输返程：行内仍显示物资摘要，弹窗标题变「随队带回」', async ({ page }) => {
    const username = uniqueUsername('e2e_march_back');
    await seedAccount(username, E2E_PASSWORD);
    const city = await mainCity(username);
    await seedMarch(username, { x: city.x + 1, y: city.y }, { purpose: 'return', cargo: { food: 5200 } });
    await loginViaForm(page, username);
    await gotoPage(page, '军队');

    const row = page.locator('[role="军队页-行军-列表"] [role="行军条目"]').filter({ hasText: `(${city.x + 1},${city.y})` });
    await expect(row.locator('[role="行军-详情摘要"]')).toHaveText('辎3 · 粮5.2k · 返程');
    await row.locator('[role="行军-详情按钮"]').click();
    const modal = page.locator('[role="行军详情弹窗"]');
    await expect(modal).toBeVisible();
    await expect(modal.locator('[role="行军详情弹窗-物资"]')).toContainText('随队带回');
    await expect(modal.locator('[role="行军详情弹窗-物资行"]').filter({ hasText: '粮' })).toContainText('5,200');
    // 返程行军没有「撤回」，只有金蝉脱壳计谋入口
    await expect(modal.locator('[role="行军详情弹窗-撤回按钮"]')).toHaveCount(0);
    await expect(modal.locator('[role="行军详情弹窗-金蝉脱壳按钮"]')).toBeVisible();
  });
});
