// 导航外壳的单屏验收（docs/frontend-nav-layout.md 第 11 节）：五种窗口尺寸 × 七个页面（含地图页选中目标、城池页选中建筑、
// 弹窗打开时），逐一检查
//   1. 页面本身不滚动：document.documentElement.scrollHeight <= innerHeight；
//   2. 没有任何元素 overflow-y 为 auto / scroll 且内容超出（竖向滚动条）；
//   3. 没有内容被裁在区块底边外（overflow 非 visible 的块里 scrollHeight 超过 clientHeight；
//      line-clamp 截断的多行文本是有意的，不算）。
// 登录页不在检查范围（内容本来就小，允许滚动）。检查脚本在浏览器里跑，违规项带上最近的 role 方便定位。
// 默认用预建的新账号（内容少）；设置 E2E_FIT_USER=已有账号名 可改用内容密集的账号（密码同 E2E_PASSWORD）复查分页与截断。

import { expect, test, type Page } from '@playwright/test';
import { loginViaForm, uniqueUsername } from './helpers';

const FIT_USER = process.env.E2E_FIT_USER;

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1100, height: 800 },
  { width: 390, height: 844 },
];

const PAGES = ['overview', 'map', 'city', 'army', 'growth', 'intel', 'agent'] as const;

interface Violation {
  kind: string;
  role: string;
  detail: string;
}

/** 在页面里扫描违规项：返回空数组即通过 */
async function scanLayout(page: Page): Promise<Violation[]> {
  return page.evaluate(() => {
    const out: Array<{ kind: string; role: string; detail: string }> = [];
    const roleOf = (el: Element): string => {
      let cur: Element | null = el;
      while (cur) {
        const role = cur.getAttribute('role');
        if (role) {
          return role;
        }
        cur = cur.parentElement;
      }
      return el.tagName.toLowerCase();
    };
    const doc = document.documentElement;
    if (doc.scrollHeight > window.innerHeight + 1) {
      out.push({ kind: '页面竖向滚动', role: 'html', detail: `scrollHeight ${doc.scrollHeight} > innerHeight ${window.innerHeight}` });
    }
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') {
        continue;
      }
      const overflows = el.scrollHeight > el.clientHeight + 1;
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && overflows) {
        out.push({ kind: '出现竖向滚动条', role: roleOf(el), detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
        continue;
      }
      const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      const lineClamp = (style as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp;
      const clamped = lineClamp !== undefined && lineClamp !== 'none' && lineClamp !== '';
      // 横向截断（truncate）的单行文本、地图格 / 滚轮外壳等本身就不会纵向超出；line-clamp 截断也是有意的
      if (clipsY && overflows && !clamped && el.clientHeight > 0) {
        out.push({ kind: '内容被裁在区块底边外', role: roleOf(el), detail: `scrollHeight ${el.scrollHeight} > clientHeight ${el.clientHeight}` });
      }
    }
    return out;
  });
}

async function expectFit(page: Page, label: string): Promise<void> {
  // 分页列表测高后会收敛一两帧：等布局稳定再扫
  await page.waitForTimeout(500);
  const violations = await scanLayout(page);
  expect(violations, `${label}\n${JSON.stringify(violations, null, 1)}`).toEqual([]);
}

for (const size of SIZES) {
  test(`${size.width}×${size.height}：七个页面与弹窗都不出现竖向滚动、不裁内容`, async ({ page }) => {
    await page.setViewportSize(size);
    await loginViaForm(page, FIT_USER ?? uniqueUsername('e2e-fit'));
    // 等城池状态到位（顶栏资源条出现）
    await expect(page.locator('[role="顶栏-资源"]')).toBeVisible();

    for (const key of PAGES) {
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, key);
      await expectFit(page, `${size.width}×${size.height} #${key}`);
    }

    // 地图页：逐类选中目标（野地 / NPC 城 / 本方城池 / 黄巾营地 / 流寇商队），右侧换成详情与操作表单；
    // 窗口里没有的类别跳过。每类都切一遍操作页签（掠夺·占领·侦察 等），表单高度各不相同
    await page.evaluate(() => {
      window.location.hash = 'map';
    });
    await expect(page.locator('[role="世界地图视野-地块"]').first()).toBeVisible();
    const targets: Array<[string, string]> = [
      ['野地', '野地 Lv'],
      ['NPC 城', 'NPC 城池'],
      ['本方城池', '本方城池'],
      ['黄巾营地', '黄巾'],
    ];
    for (const [name, pattern] of targets) {
      // 黄巾浮卡 / 图例会盖住部分地块：挑中心点没被盖住的第一个匹配地块
      const clicked = await page.evaluate((text) => {
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('[role="世界地图视野-地块"]'))) {
          if (!(el.getAttribute('aria-label') ?? '').includes(text)) {
            continue;
          }
          const rect = el.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          if (document.elementFromPoint(x, y) === el || el.contains(document.elementFromPoint(x, y))) {
            return { x, y };
          }
        }
        return null;
      }, pattern);
      if (clicked === null) {
        continue;
      }
      await page.mouse.click(clicked.x, clicked.y);
      await expect(page.locator('[role="世界地图详情区"]')).toBeVisible();
      await expectFit(page, `${size.width}×${size.height} #map 选中${name}`);
      const tabs = page.locator('[role="选中详情-操作类型"] button');
      for (let i = 0; i < (await tabs.count()); i += 1) {
        await tabs.nth(i).click();
        await expectFit(page, `${size.width}×${size.height} #map 选中${name} 操作页签 ${i}`);
      }
    }

    // 城池页：选中一座建筑
    await page.evaluate(() => {
      window.location.hash = 'city';
    });
    await page.locator('[role="城内视图-建筑-田"]').click();
    await expect(page.locator('[role="城池页-建筑详情"]')).toBeVisible();
    await expectFit(page, `${size.width}×${size.height} #city 选中建筑`);

    // 弹窗：排行榜（经账号菜单 / 顶栏按钮）与离线日报
    const leaderboardBtn = page.locator('[role="顶栏-排行榜按钮"]');
    if (await leaderboardBtn.isVisible()) {
      await leaderboardBtn.click();
    } else {
      await page.locator('[role="侧栏-账号按钮"]').click();
      await page.locator('[role="账号菜单-排行榜"]').click();
    }
    await expect(page.locator('[role="排行榜弹窗"]')).toBeVisible();
    await expectFit(page, `${size.width}×${size.height} 排行榜弹窗`);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="排行榜弹窗"]')).toHaveCount(0);
  });
}
