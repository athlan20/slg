// 导航外壳的单屏验收（docs/frontend-nav-layout.md 第 11 节）：五种窗口尺寸 × 七个页面（含地图页选中目标、城池页选中建筑、
// 弹窗打开时），逐一检查
//   1. 页面本身不滚动：document.documentElement.scrollHeight <= innerHeight；
//   2. 没有任何元素 overflow-y 为 auto / scroll 且内容超出（竖向滚动条）；
//   3. 没有内容被裁在区块底边外（overflow 非 visible 的块里 scrollHeight 超过 clientHeight；
//      line-clamp 截断的多行文本是有意的，不算）。
// 登录页不在检查范围（内容本来就小，允许滚动）。检查脚本在浏览器里跑，违规项带上最近的 role 方便定位。
// 默认用预建的新账号（内容少）；设置 E2E_FIT_USER=已有账号名 可改用内容密集的账号（密码同 E2E_PASSWORD）复查分页与截断。

import { expect, test, type Page } from '@playwright/test';
import { gotoPage, loginViaForm, uniqueUsername } from './helpers';

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
      // 任务卡「日常」页签整块滚动是有意例外（AISLG-189，docs/frontend-nav-layout.md 第 2 节第 1 条）
      const allowedScroll = el.getAttribute('role') === '任务面板-日常滚动区';
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && overflows && !allowedScroll) {
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
    // 名人堂页签（v65 AISLG-134）：赛季下拉 + 榜种页签 + 分页列表 / 空态，同样不滚动
    await page.locator('[role="排行榜弹窗-视图切换-名人堂"]').click();
    await expect(page.locator('[role="排行榜-名人堂"]')).toBeVisible();
    await expectFit(page, `${size.width}×${size.height} 排行榜弹窗 名人堂`);
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="排行榜弹窗"]')).toHaveCount(0);
  });
}

/** 养成页内容密集：建酒馆 → 等建成 → 刷新领任务金币（大兴土木 / 每日登录）→ 招两名最便宜的武将 → 配阵保存（配兵预览与特长行出现） */
async function makeGrowthDense(page: Page): Promise<void> {
  await gotoPage(page, '城池');
  await page.locator('[role="城内视图-建筑-酒"]').click();
  await page.locator('[role="城池页-建筑详情-建造按钮"]').click();
  await expect(page.locator('[role="城池页-建筑详情-队列状态"]')).toContainText('在建');
  // 建造时长取决于后端的倍速：这里等 Worker 结算完（最多 3 分钟）
  await expect(page.locator('[role="城池页-建筑详情-队列状态"]')).toContainText('不在队列中', { timeout: 180_000 });
  // 酒馆候选在建成后要刷新页面才会出现
  await page.reload();
  await expect(page.locator('[role="顶栏-资源"]')).toBeVisible();
  await gotoPage(page, '养成');
  await page.locator('[role="任务面板-签到按钮"]:not([disabled])').first().click().catch(() => undefined);
  for (let i = 0; i < 6; i += 1) {
    const claim = page.locator('[role^="任务面板-领取按钮-"]:not([disabled])').first();
    if ((await claim.count()) === 0) {
      break;
    }
    await claim.click();
    await page.waitForTimeout(800);
  }
  await page.reload();
  await expect(page.locator('[role="顶栏-资源"]')).toBeVisible();
  await gotoPage(page, '养成');
  await expect(page.locator('[role="武将面板-招募按钮"]').first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 2; i += 1) {
    const cheapest = await page.locator('[role="武将面板-招募按钮"]:not([disabled])').evaluateAll((btns) => {
      let best = -1;
      let bestCost = Infinity;
      btns.forEach((btn, idx) => {
        const cost = Number((btn.textContent ?? '').replace(/[^0-9]/g, ''));
        if (cost < bestCost) {
          bestCost = cost;
          best = idx;
        }
      });
      return best;
    });
    if (cheapest < 0) {
      break;
    }
    await page.locator('[role="武将面板-招募按钮"]:not([disabled])').nth(cheapest).click();
    await page.waitForTimeout(1500);
  }
  const heroIds = await page.locator('[role="养成页-竞技场-阵容-1号位"] option').evaluateAll((opts) =>
    opts.map((o) => (o as HTMLOptionElement).value).filter((v) => v));
  const formations = ['cavalry', 'infantry', 'ranged'];
  for (let i = 0; i < Math.min(3, heroIds.length); i += 1) {
    await page.locator(`[role="养成页-竞技场-阵容-${i + 1}号位"]`).selectOption(heroIds[i]);
    await page.locator(`[role="养成页-竞技场-阵容-formation-${i + 1}"]`).selectOption(formations[i]);
  }
  await page.locator('[role="养成页-竞技场-阵容-保存"]').click();
  await expect(page.locator('[role="养成页-竞技场-阵容-保存"]')).toBeDisabled();
}

// 养成页竞技场卡片在 1280×720（三栏，竞技场占右列）与 1100×800（分段条）下装满内容时不被裁：
// 阵容 + 榜单 / 对手 + 战报列表要完整可见（AISLG-161 配兵预览加长后曾把列表压到 0 高）。
test('养成页内容密集：竞技场在 1280×720 与 1100×800 下不被裁', async ({ page }) => {
  test.setTimeout(400_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await loginViaForm(page, uniqueUsername('e2e-arena'));
  await expect(page.locator('[role="顶栏-资源"]')).toBeVisible();
  await makeGrowthDense(page);

  for (const size of [
    { width: 1280, height: 720 },
    { width: 1100, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await gotoPage(page, '养成');
    // 1024–1279 养成页是分段条，先切到竞技场
    const seg = page.locator('[role="养成页-分段-竞技场"]');
    if (await seg.isVisible()) {
      await seg.click();
    }
    await page.waitForTimeout(500);
    const arena = page.locator('[role="养成页-竞技场"]');
    await expect(arena).toBeVisible();
    const clipped = await arena.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(clipped, `${size.width}×${size.height} 竞技场内容被裁 ${clipped}px`).toBeLessThanOrEqual(1);
    const list = page.locator('[role="养成页-竞技场-对手"], [role="养成页-竞技场-榜单"]').first();
    await expect(list).toBeVisible();
    expect(await list.evaluate((el) => el.clientHeight), `${size.width}×${size.height} 列表被压到 0 高`).toBeGreaterThan(0);
  }
});
