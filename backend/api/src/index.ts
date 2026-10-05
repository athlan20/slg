// API 进程入口：Fastify + @fastify/websocket。
// 职责边界（见 docs/phase-1-mvp.md「各目录交接边界」）：连接接入、登录注册、
// 协议分发、建造校验与保存、在线连接通知、按需查询。游戏规则全部来自 common。

import fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import type { WebSocket } from 'ws';
import { createPool, ensureSchema, readDbConfig } from '../../common/src/db';
import { ensureWorld } from '../../common/src/world-db';
import { getTimeScale, refreshTimeScale, timeScaleStale } from '../../common/src/time-scale';
import { registerCors } from './cors';
import { handleMessage, handleConnectionClosed, type HandlerContext } from './handlers';
import { createWxService, sweepWxTickets } from './handlers-wechat';
import { createWechatClient, readWechatConfig } from './wechat';
import { createGoogleService } from './handlers-google';
import { readGoogleConfig } from './google';
import { createGithubService, sweepGithubOauth } from './handlers-github';
import { createGithubClient } from './github';
import {
  githubSiteFor,
  hostFromHeaders,
  isPasswordLoginDisabled,
  readGithubSites,
  readPasswordDisabledHosts,
} from './site-config';
import { registerGithubCallbackRoute } from './github-callback';
import { registerAgentApiRoutes } from './agent-api-routes';
import { registerAuthConfigRoute } from './auth-config-routes';
import { ConnectionRegistry, type ConnInfo } from './connections';
import { CompletionNotifier } from './notify';

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
/** 登录超时：连接建立后未登录则断开 */
const AUTH_TIMEOUT_MS = Number(process.env.AUTH_TIMEOUT_MS || 15000);
/** 单帧上限 */
const MAX_PAYLOAD = 64 * 1024;

/**
 * 反向代理场景的客户端 IP 解析（否则 request.ip 恒为代理地址）：
 * - 直连部署（默认）：不信任任何 X-Forwarded-For，取 TCP 对端地址，不可伪造；
 * - TRUST_PROXY=true：信任全部上游（仅当 API 只被自家代理可达时使用）；
 * - TRUST_PROXY=loopback / IP / CIDR：只信任对应代理跳（同机 Nginx 用 loopback）。
 */
const TRUST_PROXY_ENV = process.env.TRUST_PROXY;
const TRUST_PROXY =
  TRUST_PROXY_ENV === undefined || TRUST_PROXY_ENV === ''
    ? false
    : TRUST_PROXY_ENV === 'true' || TRUST_PROXY_ENV === '1'
      ? true
      : TRUST_PROXY_ENV;

async function main(): Promise<void> {
  // fastify 日志要等 ensureSchema 之后才建，这里先用 console 提示启动阶段，
  // 避免数据库不可达时（连接超时 10s）终端长时间无输出、误以为服务已就绪。
  const { host, port, database } = readDbConfig();
  console.log(`slg-api connecting to PostgreSQL ${host}:${port}/${database} ...`);
  const pool = createPool('slg-api', 8);
  await ensureSchema(pool);
  console.log('slg-api database schema ready');
  // v12：首次启动生成世界并回填存量城池坐标（幂等；与 Worker 并发由咨询锁串行化）
  await ensureWorld(pool);
  console.log('slg-api world ready');
  // v20：全局时间缩放从 settings 预热（AISLG-38）；定期刷新，切换无需重启
  await refreshTimeScale(pool).catch(() => undefined);
  setInterval(() => {
    if (timeScaleStale()) {
      void refreshTimeScale(pool).catch(() => undefined);
    }
  }, 5_000);
  console.log(`slg-api time_scale=${getTimeScale()}`);

  const registry = new ConnectionRegistry();
  // 微信扫码登录（v43）：没配 WX_APPID / WX_APPSECRET 时整体关闭，WX_QR_CREATE 返回 WX_UNAVAILABLE
  const wechatConfig = readWechatConfig();
  const wxTtl = Number(process.env.WX_TICKET_TTL_SECONDS || 180);
  const wx = createWxService(wechatConfig ? createWechatClient(wechatConfig) : null, Number.isFinite(wxTtl) && wxTtl > 0 ? wxTtl : 180);
  const ctx: HandlerContext = { pool, registry, wx, passwordDisabledHosts: readPasswordDisabledHosts() };
  console.log(
    wechatConfig
      ? `slg-api wechat qr login enabled (env=${wechatConfig.envVersion}, ticket ttl=${wxTtl}s)`
      : 'slg-api wechat qr login disabled (WX_APPID / WX_APPSECRET not set)',
  );
  const wxSweeper = setInterval(() => {
    sweepWxTickets(ctx);
    sweepGithubOauth(ctx.github);
  }, 5_000);

  // Google 一键登录（v44）：没配 GOOGLE_CLIENT_ID 时整体关闭，GOOGLE_LOGIN 返回 GOOGLE_UNAVAILABLE
  const googleConfig = readGoogleConfig();
  const google = createGoogleService(googleConfig);
  ctx.google = google;
  console.log(googleConfig ? 'slg-api google login enabled' : 'slg-api google login disabled (GOOGLE_CLIENT_ID not set)');

  // GitHub 一键登录（v45，v47 起按站点分套）：GITHUB_SITES 以 Host 为键各配一套
  //（GitHub OAuth App 的回调地址只能填一个，两站各建一个）；旧四变量作为 default 套
  const githubSites = readGithubSites();
  const github = createGithubService(githubSites);
  ctx.github = github;
  console.log(
    githubSites.defaultSite || githubSites.byHost.size > 0
      ? `slg-api github login enabled (sites: ${[...githubSites.byHost.keys()].join(', ') || 'default'})`
      : 'slg-api github login disabled (GITHUB_* / FRONTEND_URL not all set)',
  );
  // 双站点（v47）：PASSWORD_LOGIN_DISABLED_HOSTS 列出的 Host（如国际站 slg.yuntianyou.cc）
  // 整站关闭密码登录；国内站照旧。/auth/config 也按请求 Host 下发 passwordLogin
  //（构造 ctx 时已读取，LOGIN 处理器用它拦截；此处仅打日志）
  const passwordDisabledHosts = ctx.passwordDisabledHosts;
  console.log(
    passwordDisabledHosts.size > 0
      ? `slg-api password login disabled for hosts: ${[...passwordDisabledHosts].join(', ')}`
      : 'slg-api password login enabled on all hosts',
  );

  // 推送 eventId 起点下限 = 事件表当前最大 id（v21 AISLG-37）：API 重启后 eventId
  // 不回退，客户端「已见最大 eventId」的幂等去重在重启后依然成立
  const seed = await pool.query('SELECT COALESCE(MAX(id), 0) AS m FROM events');
  registry.setEventIdFloor(Number(seed.rows[0].m));

  const notifier = new CompletionNotifier(pool, registry);
  await notifier.start();

  const app = fastify({ logger: { level: process.env.LOG_LEVEL || 'info' }, trustProxy: TRUST_PROXY });
  // 跨域：生产站点（slg.example.cn）与 API 网关不同源，HTTP 路由放开跨域读
  // （来源策略见 cors.ts；WebSocket /ws 不受同源策略约束）
  await registerCors(app);
  await app.register(websocketPlugin, { options: { maxPayload: MAX_PAYLOAD } });

  app.get('/health', async () => ({ ok: true, service: 'slg-api' }));

  // Agent API 文档只读路由（GET /agent-api.md、GET /agent-api.json）
  registerAgentApiRoutes(app);
  // 登录入口配置（v44）：前端据此决定显示 Google / 微信入口；v45 加 GitHub；v47 起按请求
  // Host 下发 passwordLogin / githubEnabled（双站点，国际站无密码表单）
  registerAuthConfigRoute(app, {
    googleClientId: google.clientId,
    wechatEnabled: wechatConfig !== null,
    trustProxy: TRUST_PROXY !== false,
    isPasswordLoginDisabled: (host) => isPasswordLoginDisabled(host, passwordDisabledHosts),
    githubSiteForHost: (host) => githubSiteFor(host, githubSites),
  });
  // GitHub OAuth 回调（v45）：302 回前端；此路由不能被 CDN 缓存（README 部署注意）
  registerGithubCallbackRoute(app, { github, ctx });

  app.get('/ws', { websocket: true }, (socket: WebSocket, request) => {
    const conn: ConnInfo = {
      socket,
      ip: request.ip || null,
      host: hostFromHeaders(request.headers, TRUST_PROXY !== false),
      accountId: null,
      username: null,
      role: null,
      sessionId: null,
      connectedAt: new Date(),
      authDeadlineAt: Date.now() + AUTH_TIMEOUT_MS,
    };
    registry.add(conn);

    // 登录超时：等人扫微信码的连接会把 authDeadlineAt 往后延，到点时按最新截止时刻复查
    let authTimer: NodeJS.Timeout;
    const checkAuth = (): void => {
      if (conn.accountId) {
        return;
      }
      const remaining = (conn.authDeadlineAt ?? 0) - Date.now();
      if (remaining > 0) {
        authTimer = setTimeout(checkAuth, remaining);
        return;
      }
      socket.close(4001, 'login timeout');
    };
    authTimer = setTimeout(checkAuth, AUTH_TIMEOUT_MS);

    socket.on('message', (data: unknown, isBinary: boolean) => {
      if (isBinary) {
        void handleMessage(ctx, conn, '');
        return;
      }
      const raw = Array.isArray(data)
        ? Buffer.concat(data as Buffer[]).toString('utf8')
        : String(data);
      handleMessage(ctx, conn, raw).catch((err) => {
        app.log.error(err, 'unhandled message error');
      });
    });

    socket.on('close', () => {
      clearTimeout(authTimer);
      void handleConnectionClosed(ctx, conn);
    });

    socket.on('error', (err: Error) => {
      app.log.warn({ err: err.message }, 'socket error');
    });
  });

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`slg-api listening on ${HOST}:${PORT}`);

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`received ${signal}, shutting down`);
    clearInterval(wxSweeper);
    await notifier.stop();
    registry.closeAll(1001, 'server shutdown');
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('slg-api failed to start:', err);
  process.exit(1);
});
