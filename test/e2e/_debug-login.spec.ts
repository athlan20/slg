import { expect, test } from '@playwright/test';
import { seedAccount } from '../account-seed';
import { E2E_PASSWORD, uniqueUsername } from './helpers';

test('debug login', async ({ page }) => {
  page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()));
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  page.on('requestfailed', (req) => console.log('[reqfail]', req.url(), req.failure()?.errorText));
  page.on('websocket', (ws) => {
    console.log('[ws]', ws.url());
    ws.on('framereceived', (f) => console.log('[ws<-]', String(f.payload).slice(0, 300)));
    ws.on('framesent', (f) => console.log('[ws->]', String(f.payload).slice(0, 300)));
    ws.on('socketerror', (e) => console.log('[wserr]', e));
    ws.on('close', () => console.log('[ws closed]'));
  });
  const username = uniqueUsername('debug_login');
  await seedAccount(username, E2E_PASSWORD);
  await page.goto('/');
  const form = page.locator('[role="账号面板-登录表单"]');
  await expect(form).toBeVisible();
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="password"]').fill(E2E_PASSWORD);
  const btn = page.locator('[role="账号面板-登录按钮"]');
  console.log('btn disabled:', await btn.isDisabled(), 'text:', await btn.textContent());
  console.log('values:', await form.locator('input[name="username"]').inputValue(), (await form.locator('input[name="password"]').inputValue()).length);
  await btn.click();
  await page.waitForTimeout(4000);
  console.log('online count:', await page.locator('[role="顶栏-本人在线状态"]').count());
  console.log('body text:', (await page.locator('body').innerText()).slice(0, 400));
  await page.screenshot({ path: '/tmp/debug-login.png', fullPage: true });
});