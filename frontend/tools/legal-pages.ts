// 法务静态页（AISLG-252）：隐私政策 / 服务条款 / 定价说明。
//
// 源文件在 src/legal/*.html，构建后平铺到产物根目录（/privacy.html、/terms.html、/pricing.html），
// 由静态服务器直接返回——不经过前端路由，不依赖服务端把未知路径回退到 index.html，也不依赖登录态。
// dev 下由下面的 server.setup 中间件按同一套渲染逻辑返回，保证开发时看到的就是线上效果。
//
// 客服邮箱不写进仓库（项目开源）：源文件里写 {{SUPPORT_EMAIL}} 占位，构建 / dev 时用环境变量
// PUBLIC_SUPPORT_EMAIL 替换；没配置时替换成占位文案，构建不失败。
// index.html 的静态介绍走同一个替换函数，并用 support-email:begin / end 标记让「未配置」时整段消失。

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildDevServer, RsbuildPlugin, RsbuildPreviewServer } from '@rsbuild/core';

/** 页名即产物路径；源文件同名放在 src/legal/ 下。 */
export const LEGAL_PAGES = ['privacy.html', 'terms.html', 'pricing.html'] as const;

/** 源文件目录 frontend/src/legal */
const SOURCE_DIR = fileURLToPath(new URL('../src/legal', import.meta.url));

const EMAIL_PLACEHOLDER = '{{SUPPORT_EMAIL}}';
/** 没配 PUBLIC_SUPPORT_EMAIL 时的兜底文案（构建不能因此失败） */
const EMAIL_FALLBACK = '(support email not configured)';
/** index.html 里「邮箱这一项」的包裹标记：未配置邮箱时整段去掉 */
const EMAIL_BLOCK = /<!-- support-email:begin -->[\s\S]*?<!-- support-email:end -->/g;

/** 客服邮箱：读环境变量 PUBLIC_SUPPORT_EMAIL（来自 shell 或 frontend/.env*，由 Rsbuild 载入 process.env） */
function supportEmail(): string | null {
  const value = (process.env.PUBLIC_SUPPORT_EMAIL ?? '').trim();
  return value === '' ? null : value;
}

/** 把占位符换成客服邮箱；未配置时先去掉 index.html 的邮箱段落，再替换成兜底文案 */
export function fillSupportEmail(html: string): string {
  const email = supportEmail();
  const body = email === null ? html.replace(EMAIL_BLOCK, '') : html;
  return body.split(EMAIL_PLACEHOLDER).join(email ?? EMAIL_FALLBACK);
}

/** 当前渲染好的法务页（dev 中间件按请求读取，改完源文件刷新即可看到） */
async function renderPage(name: string): Promise<string> {
  const source = await readFile(join(SOURCE_DIR, name), 'utf8');
  return fillSupportEmail(source);
}

/** 静态页插件：index.html 的邮箱替换 + 构建后把三个页面写到产物根目录。 */
export const pluginLegalPages = (): RsbuildPlugin => ({
  name: 'legal-pages',
  setup(api) {
    // dev 与 build 都生效：index.html 静态介绍里的客服邮箱同样在构建期替换
    api.modifyHTML((html) => fillSupportEmail(html));

    api.onAfterBuild(async () => {
      const distPath = api.context.distPath;
      await mkdir(distPath, { recursive: true });
      for (const name of LEGAL_PAGES) {
        await writeFile(join(distPath, name), await renderPage(name), 'utf8');
        api.logger.ready(`法务页面已输出：${name}`);
      }
    });
  },
});

/** `server.setup` 的回调参数：Rsbuild 没有导出这个上下文类型，只能按 server 实例类型拼（与 prototypes-preview.ts 一致）。 */
type SetupContext = {
  action: 'dev' | 'preview';
  server: RsbuildDevServer | RsbuildPreviewServer;
};

/** dev server 上的三个法务页：注册在内置中间件之前，避免被应用入口页兜底接管。 */
export const legalPagesDevServer = ({ action, server }: SetupContext) => {
  if (action !== 'dev') return;

  server.middlewares.use(async (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    const name = LEGAL_PAGES.find((page) => path === `/${page}`);
    if (name === undefined) return next();

    try {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(await renderPage(name));
    } catch {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`法务页面读取失败：${name}`);
    }
  });
};
