import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RsbuildDevServer, RsbuildPreviewServer } from '@rsbuild/core';

/** `server.setup` 的回调参数：Rsbuild 没有导出这个上下文类型，只能按 server 实例类型拼。 */
type SetupContext = {
  action: 'dev' | 'preview';
  server: RsbuildDevServer | RsbuildPreviewServer;
};

/** 样稿目录：frontend/prototypes/（不带尾部斜杠，便于做越界校验）。 */
const ROOT = fileURLToPath(new URL('../prototypes', import.meta.url));

/** dev server 上的访问前缀，与目录名保持一致，避免和应用自身路由混淆。 */
const PREFIX = '/prototypes';

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 把 frontend/prototypes/ 挂到 dev server 的 `/prototypes/*` 下。
 *
 *  样稿是纯静态页面、不参与构建。`server.publicDir` 会把目录内容平铺到 dev 根路径，
 *  与应用的 index.html 撞名（`/index.html` 只会返回应用页面），所以这里单独挂一层
 *  带前缀的只读中间件；`server.setup` 的中间件注册在内置中间件之前，也顺带避开
 *  SPA fallback 把 `/prototypes/*` 当成前端路由。
 */
export const prototypesPreview = ({ action, server }: SetupContext) => {
  if (action !== 'dev') return;

  server.middlewares.use(async (req, res, next) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return next();

    const target = resolve(join(ROOT, decodeURIComponent(path.slice(PREFIX.length)) || '/'));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.statusCode = 403;
      res.end('样稿目录之外的文件不可访问');
      return;
    }

    try {
      const file = (await stat(target)).isDirectory() ? join(target, 'index.html') : target;
      const body = await readFile(file);
      res.statusCode = 200;
      res.setHeader(
        'Content-Type',
        CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      );
      res.setHeader('Cache-Control', 'no-store');
      res.end(body);
    } catch {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(`样稿不存在：${path}`);
    }
  });

  return () => {
    console.log(`\n  样稿预览：http://localhost:${server.port}${PREFIX}/index.html`);
  };
};
