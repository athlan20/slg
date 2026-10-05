// Agent API 文档只读路由：从协议文档清单即时渲染并缓存，与运行中的代码严格同版本
// （内容源与生成产物见 backend/README.md「协议」）。
// 从 index.ts 拆出是为了能在无数据库环境（单元测试）用 inject 验证路由行为。
// 文档是面向玩家及其 Agent 的公开交付物（无凭证、只读），允许任意来源跨域读取，
// 浏览器前端（如 rsbuild dev 的 8424 端口）可直接 fetch；游戏 WebSocket（/ws）不受影响。

import type { FastifyInstance, FastifyReply } from 'fastify';
import { renderAgentApiManifest, renderAgentApiMarkdown } from '../../common/src/protocol-doc-render';
import { CHANGES_PATH_PREFIX, changesSince } from '../../common/src/protocol-changelog';
import { PROTOCOL_VERSION } from '../../common/src/protocol-version';

let mdCache: string | null = null;
let jsonCache: string | null = null;

export function registerAgentApiRoutes(app: FastifyInstance): void {
  app.get('/agent-api.md', async (_request, reply) => {
    reply
      .type('text/markdown; charset=utf-8')
      .header('cache-control', 'public, max-age=60')
      .header('access-control-allow-origin', '*');
    mdCache ??= renderAgentApiMarkdown();
    return mdCache;
  });
  app.get('/agent-api.json', async (_request, reply) => {
    reply
      .type('application/json; charset=utf-8')
      .header('cache-control', 'public, max-age=60')
      .header('access-control-allow-origin', '*');
    jsonCache ??= renderAgentApiManifest();
    return jsonCache;
  });
  // v32（AISLG-91）：增量变更清单。主用路径形式 /agent-api/changes/{since}（CDN 忽略查询串时也不串缓存），
  // 兼容 ?since=；since 为调用方手上文档的协议版本，0 返回全部。
  const changes = async (since: string | undefined, reply: FastifyReply) => {
    reply
      .type('application/json; charset=utf-8')
      .header('cache-control', 'public, max-age=60')
      .header('access-control-allow-origin', '*');
    const n = since !== undefined && /^\d{1,6}$/.test(since) ? Number(since) : NaN;
    if (!Number.isInteger(n)) {
      reply.code(400);
      return { error: 'INVALID_PARAMS', message: `since 须为非负整数（你手上文档的协议版本号），例如 ${CHANGES_PATH_PREFIX}/28` };
    }
    return { version: PROTOCOL_VERSION, since: n, changes: changesSince(n) };
  };
  app.get<{ Params: { since: string } }>(`${CHANGES_PATH_PREFIX}/:since`, async (request, reply) =>
    changes(request.params.since, reply),
  );
  app.get<{ Querystring: { since?: string } }>(CHANGES_PATH_PREFIX, async (request, reply) =>
    changes(request.query.since, reply),
  );
}
