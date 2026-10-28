import { test } from '@playwright/test';
import { seedAccount } from '../account-seed';
import { E2E_PASSWORD, loginViaForm, uniqueUsername } from './helpers';

test('debug loginViaForm double seed', async ({ page }) => {
  page.on('console', (msg) => console.log('[console]', msg.type(), msg.text().slice(0, 200)));
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  page.on('websocket', (ws) => {
    if (ws.url().includes('/ws')) {
      console.log('[ws]', ws.url());
      ws.on('framereceived', (f) => console.log('[ws<-]', String(f.payload).slice(0, 160)));
      ws.on('socketerror', (e) => console.log('[wserr]', e));
      ws.on('close', () => console.log('[ws closed]'));
    }
  });
  const username = uniqueUsername('debug_helper');
  await seedAccount(username, E2E_PASSWORD);
  console.log('first seed done');
  try {
    await loginViaForm(page, username);
    console.log('loginViaForm ok');
  } catch (err) {
    console.log('loginViaForm failed:', (err as Error).message.slice(0, 200));
    console.log('body:', (await page.locator('body').innerText()).slice(0, 300));
  }
});