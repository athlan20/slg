// 第一期建筑队列与升级端到端：登录 → 城池页选中建筑、右侧详情就地发起建造/升级（开工 + 排队）→
// Worker 依次结算与队首激活 → 界面、等级、资源、产量与事件流同步。
// 建造时长由 playwright.config.ts 的 BUILD_SECONDS=3 压缩，真实走 Worker 结算；
// 升级时长 = 建造时长 × 当前等级（Lv1→2 为 6 秒）。

import { expect, test, type Page } from '@playwright/test';
import { gotoPage, loginViaForm, uniqueUsername } from './helpers';

/** 城池页：点建筑格选中，右侧详情确认内容后点动作按钮发起（建造或升级）；详情就地保留，不再弹窗 */
async function buildViaDetail(page: Page, cellShort: string, expectText: string): Promise<void> {
  await page.locator(`[role="城内视图-建筑-${cellShort}"]`).click();
  const detail = page.locator('[role="城池页-建筑详情"]');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText(expectText);
  await page.locator('[role="城池页-建筑详情-建造按钮"]').click();
}

test('城池页详情就地发起建造进入队列，队首完成后自动激活下一条直至清空', async ({ page }) => {
  const username = uniqueUsername('e2e-queue');

  await loginViaForm(page, username);
  await gotoPage(page, '城池');

  // 初始状态：队列空闲、建筑均未建；产量含 v8 基础产量（四资源各 100/h）与官府产金
  // （v19 起官府产金 = 100 × 等级，新号官府 Lv1 → 金 +100/h）
  await expect(page.locator('[role="建造队列面板-空闲"]')).toBeVisible();
  await expect(page.locator('[role="城内视图-建筑-田"]')).toContainText('未建');
  await expect(page.locator('[role="顶栏-资源-金-产量"]')).toContainText('+100/h');
  await expect(page.locator('[role="顶栏-资源-粮-产量"]')).toContainText('+100/h');

  // 农田立即开工
  await buildViaDetail(page, '田', '农田');
  await expect(page.locator('[role="建造队列面板-条目-田"]')).toContainText('在建');

  // 单实例（AISLG-50）：农田在建中，详情里的动作按钮禁用并提示在建——
  // 不再对在队建筑发起注定被拒（BUILDING_EXISTS）的请求
  await page.locator('[role="城内视图-建筑-田"]').click();
  const inQueueDetail = page.locator('[role="城池页-建筑详情"]');
  await expect(inQueueDetail).toContainText('在建');
  await expect(inQueueDetail).toContainText('正在建造/升级中，完成后可再发起');
  await expect(page.locator('[role="城池页-建筑详情-建造按钮"]')).toBeDisabled();

  // 伐木场、采石场依次入队（1 在建 + 2 排队 = 队列满）
  await buildViaDetail(page, '木', '伐木场');
  await expect(page.locator('[role="建造队列面板-条目-木"]')).toContainText('排队 1');
  await buildViaDetail(page, '石', '采石场');
  await expect(page.locator('[role="建造队列面板-条目-石"]')).toContainText('排队 2');

  // 队列已满：铁矿详情里展示消耗（v8 初始资源 5000 后金充足，不再触发「缺」标记——
  // 资源不足的标记路径自此场景移除）、建造按钮禁用，关闭详情不发起
  await page.locator('[role="城内视图-建筑-铁"]').click();
  const detail = page.locator('[role="城池页-建筑详情"]');
  await expect(detail).toContainText('铁矿');
  await expect(page.locator('[role="城池页-建筑详情-消耗"]')).toContainText('金 200');
  await expect(page.locator('[role="城池页-建筑详情-消耗"]')).toContainText('石 60');
  await expect(detail).toContainText('队列已满');
  await expect(page.locator('[role="城池页-建筑详情-建造按钮"]')).toBeDisabled();
  await page.locator('[role="城池页-建筑详情-关闭按钮"]').click();
  await expect(page.locator('[role="城池页-建筑详情"]')).toHaveCount(0);

  // 资源即时扣减三次（开局资源 2000×5：农田 100 + 伐木场 120 + 采石场 150 → 金 1,630 起；顶栏数字带千分位，
  // 官府同时产金持续回升，断言只验证「已从 2000 扣减」避免与结算节奏竞态）
  await expect(page.locator('[role="顶栏-资源-金-存量"]')).toContainText(/1,[6-9]\d\d/);

  // 农田到期结算：队首完成、伐木场自动激活为在建，农田 Lv1 与产量生效（基础 100 + Lv1 × 120）
  await expect(page.locator('[role="城内视图-建筑-田"]')).toContainText('Lv 1', { timeout: 30_000 });
  await expect(page.locator('[role="城内视图-建筑-木"]')).toContainText('剩', { timeout: 30_000 });
  await expect(page.locator('[role="建造队列面板-条目-木"]')).toContainText('在建');
  await expect(page.locator('[role="建造队列面板-条目-石"]')).toContainText('排队 1');
  await expect(page.locator('[role="顶栏-资源-粮-产量"]')).toContainText('+220/h', { timeout: 30_000 });
  await gotoPage(page, '情报');
  await expect(page.locator('[role="事件面板-列表"]')).toContainText('农田建造');
  await expect(page.locator('[role="事件面板-列表"]')).toContainText('伐木场从队列开工');
  await gotoPage(page, '城池');

  // 伐木场到期结算：采石场激活
  await expect(page.locator('[role="城内视图-建筑-木"]')).toContainText('Lv 1', { timeout: 30_000 });
  await expect(page.locator('[role="建造队列面板-条目-石"]')).toContainText('在建', { timeout: 30_000 });
  await expect(page.locator('[role="顶栏-资源-木-产量"]')).toContainText('+200/h', { timeout: 30_000 });

  // 采石场到期结算：队列清空回到空闲，三种建筑 Lv1、产量生效
  await expect(page.locator('[role="城内视图-建筑-石"]')).toContainText('Lv 1', { timeout: 30_000 });
  await expect(page.locator('[role="建造队列面板-空闲"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[role="顶栏-资源-石-产量"]')).toContainText('+180/h', { timeout: 30_000 });
});

test('建筑升级：详情就地升级到 Lv2，完成后等级与产量翻倍', async ({ page }) => {
  const username = uniqueUsername('e2e-upgrade');

  await loginViaForm(page, username);
  await gotoPage(page, '城池');
  await buildViaDetail(page, '田', '农田');
  await expect(page.locator('[role="城内视图-建筑-田"]')).toContainText('Lv 1', { timeout: 30_000 });
  await expect(page.locator('[role="顶栏-资源-粮-产量"]')).toContainText('+220/h', { timeout: 30_000 });

  // 详情显示当前等级、升级消耗与升级入口
  await page.locator('[role="城内视图-建筑-田"]').click();
  const detail = page.locator('[role="城池页-建筑详情"]');
  await expect(detail).toContainText('等级 Lv 1');
  await expect(page.locator('[role="城池页-建筑详情-消耗"]')).toContainText('金 100');
  await expect(page.locator('[role="城池页-建筑详情-消耗"]')).toContainText('木 50');
  await expect(page.locator('[role="城池页-建筑详情-建造按钮"]')).toContainText('升级至 Lv 2');
  await page.locator('[role="城池页-建筑详情-建造按钮"]').click();
  await expect(page.locator('[role="建造队列面板-条目-田"]')).toContainText('在建');
  await expect(page.locator('[role="建造队列面板-条目-田"]')).toContainText('升级至 Lv 2');

  // 升级时长 = 建造时长 × 当前等级（6 秒），完成后 Lv2、产量翻倍（基础 100 + Lv2 × 240 = 340）
  await expect(page.locator('[role="城内视图-建筑-田"]')).toContainText('Lv 2', { timeout: 30_000 });
  await expect(page.locator('[role="建造队列面板-空闲"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[role="顶栏-资源-粮-产量"]')).toContainText('+340/h', { timeout: 30_000 });
  await gotoPage(page, '情报');
  await expect(page.locator('[role="事件面板-列表"]')).toContainText('农田升级至 Lv 2');
});

test('断线重连：刷新后用会话令牌自动登录并按需查询到最新队列', async ({ page }) => {
  const username = uniqueUsername('e2e-reconnect');

  await loginViaForm(page, username);
  await gotoPage(page, '城池');
  await buildViaDetail(page, '田', '农田');
  await buildViaDetail(page, '木', '伐木场');
  await expect(page.locator('[role="建造队列面板-条目-田"]')).toContainText('在建');
  await expect(page.locator('[role="建造队列面板-条目-木"]')).toContainText('排队 1');

  // 刷新等价于断线重连：令牌自动登录 + 按需查询对齐队列状态（不依赖补推）；页面停在 #city（hash 持久化）
  await page.reload();
  await expect(page.locator('[role="侧栏-账号"]')).toContainText(username, { timeout: 15_000 });
  await expect(page.locator('[role="建造队列面板-条目-田"]')).toContainText('在建');
  await expect(page.locator('[role="建造队列面板-条目-木"]')).toContainText('排队 1');

  // 两条依次完成后队列回到空闲，产量生效（离线期间照常累积）
  await expect(page.locator('[role="建造队列面板-空闲"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[role="城内视图-建筑-木"]')).toContainText('Lv 1');
  await expect(page.locator('[role="顶栏-资源-粮-产量"]')).toContainText('+220/h', { timeout: 30_000 });
  await expect(page.locator('[role="顶栏-资源-木-产量"]')).toContainText('+200/h');
});
