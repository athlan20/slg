// 账号昵称端到端（v52，AISLG-142）：账号设置改昵称 → 侧栏与「当前昵称」即时更新；
// 撞别人昵称返回 NICKNAME_TAKEN 人读错误；另一会话改名后本会话经 PUSH_ACCOUNT_STATE 同步。
// 账号由 helpers 的 seedAccount 直插数据库（v48 起密码通道不再自动注册）。

import { expect, test } from '@playwright/test';
import { seedAccount } from '../account-seed';
import { E2E_PASSWORD, loginViaForm, uniqueUsername } from './helpers';

/** 打开侧栏账号菜单里的账号设置弹窗 */
async function openSettings(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('[role="侧栏-账号按钮"]').click();
  await page.locator('[role="账号菜单-账号设置"]').click();
  await expect(page.locator('[role="账号设置弹窗"]')).toBeVisible();
}

test('账号设置改昵称：保存后侧栏与当前昵称即时更新', async ({ page }) => {
  const username = uniqueUsername('e2e-nick');
  const nickname = uniqueUsername('卧龙');

  await loginViaForm(page, username);
  await openSettings(page);

  const input = page.locator('[role="账号设置-昵称-输入框"]');
  await expect(input).toHaveValue(username);
  await input.fill(nickname);
  await page.locator('[role="账号设置-昵称-保存按钮"]').click();

  await expect(page.locator('[role="账号设置-昵称-保存结果"]')).toContainText(nickname);
  // 本连接按响应更新：弹窗里的「当前昵称」与侧栏账号名都换成新昵称
  await expect(page.locator('[role="账号设置-昵称"]')).toContainText(`当前昵称：${nickname}`);
  await expect(page.locator('[role="侧栏-账号"]')).toContainText(nickname);
});

test('改成别人的昵称被拒：NICKNAME_TAKEN 人读错误，昵称不变', async ({ page }) => {
  const username = uniqueUsername('e2e-nick-taken');
  // 占位名要短于 32 字符：输入框 maxLength=32 会截断过长的名字，截断后与占位名不一致就测不出冲突
  const holder = uniqueUsername('占位');
  await loginViaForm(page, username);

  // holder 是另一个真实账号占用的昵称
  await seedAccount(holder, E2E_PASSWORD);

  await openSettings(page);
  await page.locator('[role="账号设置-昵称-输入框"]').fill(holder);
  await page.locator('[role="账号设置-昵称-保存按钮"]').click();

  await expect(page.locator('[role="账号设置-昵称-错误"]')).toContainText('已经被别人用');
  await expect(page.locator('[role="侧栏-账号"]')).toContainText(username);
});

test('另一会话改名，本会话经推送同步新昵称', async ({ browser }) => {
  const username = uniqueUsername('e2e-nick-push');
  const nickname = uniqueUsername('凤雏');

  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await loginViaForm(firstPage, username);

  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await loginViaForm(secondPage, username);

  await openSettings(secondPage);
  await secondPage.locator('[role="账号设置-昵称-输入框"]').fill(nickname);
  await secondPage.locator('[role="账号设置-昵称-保存按钮"]').click();
  await expect(secondPage.locator('[role="账号设置-昵称-保存结果"]')).toContainText(nickname);

  // 第一个会话没有发起改名：靠 PUSH_ACCOUNT_STATE 把侧栏账号名同步成新昵称
  await expect(firstPage.locator('[role="侧栏-账号"]')).toContainText(nickname);

  await first.close();
  await second.close();
});
