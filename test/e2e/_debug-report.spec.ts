import { expect, test } from '@playwright/test';
import { seedAccount } from '../account-seed';
import { E2E_PASSWORD, uniqueUsername } from './helpers';
import { databaseUrl } from '../account-seed';
import { createRequire } from 'node:module';
import path from 'node:path';

const requireFromBackend = createRequire(path.join(__dirname, '../../backend/package.json'));
const pg = requireFromBackend('pg') as typeof import('pg');

async function sql(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const pool = new pg.Pool({ connectionString: databaseUrl() });
  try { return (await pool.query(text, params)).rows as Record<string, unknown>[]; } finally { await pool.end(); }
}

test('debug login with reports', async ({ page }) => {
  page.on('console', (msg) => console.log('[console]', msg.type(), msg.text().slice(0, 300)));
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  page.on('websocket', (ws) => {
    console.log('[ws]', ws.url());
    ws.on('framereceived', (f) => console.log('[ws<-]', String(f.payload).slice(0, 200)));
    ws.on('socketerror', (e) => console.log('[wserr]', e));
    ws.on('close', () => console.log('[ws closed]'));
  });
  const username = uniqueUsername('debug_report');
  await seedAccount(username, E2E_PASSWORD);
  const troops = { militia: 10, swordsman: 0, archer: 0, cavalry: 0, scout: 0, porter: 0 };
  const detail = { kind: 'wilderness', x: 123, y: 45, role: 'attacker', won: true, rounds: 1, endReason: 'defender_wiped', wallDefensePercent: 0,
    attacker: { name: '测试攻方', troops, losses: troops, survivors: troops, damage: 120 },
    defender: { name: '测试守方', troops, losses: troops, survivors: troops, damage: 60 },
    roundLog: [{ round: 1, attackerDamage: 120, defenderDamage: 60, attackerKilled: 8, defenderKilled: 8 }] };
  await sql(`INSERT INTO battle_reports (account_id, x, y, kind, detail) SELECT id, $2, $3, $4, $5::jsonb FROM accounts WHERE username = $1`,
    [username, 15, 10, 'battlefield', JSON.stringify({ ...detail, kind: 'battlefield', x: 15, y: 10 })]);
  await sql(`INSERT INTO battle_reports (account_id, x, y, kind, detail) SELECT id, $2, $3, $4, $5::jsonb FROM accounts WHERE username = $1`,
    [username, 123, 45, 'wilderness', JSON.stringify(detail)]);
  await page.goto('/');
  const form = page.locator('[role="账号面板-登录表单"]');
  await expect(form).toBeVisible();
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(E2E_PASSWORD);
  await page.locator('[role="账号面板-登录按钮"]').click();
  await page.waitForTimeout(4000);
  console.log('page text after login:', (await page.locator('body').innerText()).slice(0, 200));
  console.log('online count:', await page.locator('[role="顶栏-本人在线状态"]').count());
  console.log('body:', (await page.locator('body').innerText()).slice(0, 300));
});