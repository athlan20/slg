// GitHub OAuth 回调路由（AISLG-128）：GET /auth/github/callback?code=…&state=…
//（玩家在 GitHub 点「取消」时带 error=access_denied）。核对并作废 state 后用 code 换
// 用户信息：login 路径生成 60 秒一次性登录码并 302 回前端 ?oauth=github&code=…（会话令牌
// 不进 URL）；bind 路径直接写绑定后 302 回 ?oauth=github&bind=ok。失败一律 302 回前端带
// error=canceled / expired / unavailable / already_bound，由前端给出人读提示。
// 注意：本路由必须不被 CDN 缓存（响应带 no-store；CDN 侧也要设为不缓存，见 backend/README.md）。

import type { FastifyInstance } from 'fastify';
import { GithubError } from './github';
import { githubEntryFor, type GithubService } from './handlers-github';
import { bindOauth, findAccountByOauth, loginWithOauth } from './oauth-accounts';
import type { HandlerContext } from './handlers';
import { diagLog } from '../../common/src/diag-log';
import { dbErrorReason } from '../../common/src/db-diag';

type CallbackError = 'canceled' | 'expired' | 'unavailable' | 'already_bound';

export function registerGithubCallbackRoute(
  app: FastifyInstance,
  options: { github: GithubService; ctx: HandlerContext },
): void {
  app.get('/auth/github/callback', async (request, reply) => {
    const startedAt = Date.now();
    // [oauth-callback] 诊断字段（AISLG-173）：只记结果与耗时，绝不记 code、令牌与 state
    const diag: { purpose?: string; site?: string; reason?: string; exchangeMs?: number; dbMs?: number } = {};
    const query = request.query as Record<string, string | undefined>;
    const stateValue = typeof query.state === 'string' ? query.state : '';
    const code = typeof query.code === 'string' ? query.code : '';
    const github = options.github;
    // 跳回哪个前端由发起站点的 state 决定；state 无效时用 default 套兜底（只要能 302 走）
    const fallbackEntry = githubEntryFor(github, null);

    const report = (result: string): void => {
      diagLog(
        'oauth-callback',
        `result=${result} purpose=${diag.purpose ?? '-'} site=${diag.site ?? '-'} reason=${diag.reason ?? '-'} ` +
          `exchange_ms=${diag.exchangeMs ?? '-'} db_ms=${diag.dbMs ?? '-'} total_ms=${Date.now() - startedAt}`,
      );
    };
    // 数据库步骤计时（login 路径可能查两次，耗时累加）
    const timedDb = async <T>(work: () => Promise<T>): Promise<T> => {
      const dbStartedAt = Date.now();
      try {
        return await work();
      } finally {
        diag.dbMs = (diag.dbMs ?? 0) + Date.now() - dbStartedAt;
      }
    };

    const finish = (params: Record<string, string>, entry = fallbackEntry): void => {
      report(params.error ?? 'ok');
      const search = new URLSearchParams({ oauth: 'github', ...params });
      const frontendUrl = entry?.config.frontendUrl;
      if (!frontendUrl) {
        reply.code(503).send({ error: 'GITHUB_UNAVAILABLE' });
        return;
      }
      // 302 带一次性码也不允许被任何中间层缓存
      reply.header('cache-control', 'no-store');
      reply.redirect(`${frontendUrl}/?${search.toString()}`);
    };

    // state 核对并作废（一次性）：不存在 / 过期 / 被重复使用都按过期提示。玩家在 GitHub
    // 点了「取消」（error=access_denied）时同样要核对——被重放的取消请求按 expired 处理
    const state = stateValue ? github.states.take(stateValue, github.now()) : null;
    if (query.error) {
      return void finish({ error: state ? 'canceled' : 'expired' });
    }
    if (!state) {
      return void finish({ error: 'expired' });
    }
    diag.purpose = state.purpose;
    diag.site = state.host ?? undefined;
    if (!code) {
      return void finish({ error: 'expired' });
    }

    // state 里记着发起站点：用它选 GitHub 配置套换令牌（两站各一个 OAuth App）
    const entry = githubEntryFor(github, state.host);
    if (!entry) {
      diag.reason = 'no_site_config';
      return void finish({ error: 'unavailable' });
    }
    let user;
    const exchangeStartedAt = Date.now();
    try {
      user = await entry.client.exchangeCode(code);
    } catch (err) {
      diag.exchangeMs = Date.now() - exchangeStartedAt;
      if (!(err instanceof GithubError)) {
        console.error('github callback failed:', err);
        diag.reason = 'github:error';
        return void finish({ error: 'unavailable' });
      }
      diag.reason = `github:${err.kind}`;
      // code 被篡改 / 已用过（bad_verification_code）按过期；接口性故障按不可用
      return void finish({ error: err.kind === 'code_invalid' ? 'expired' : 'unavailable' });
    }
    diag.exchangeMs = Date.now() - exchangeStartedAt;
    const identity = { provider: 'github' as const, subject: user.id, displayName: user.login };

    // 数据库故障（连接卡死 / 超时 / 池耗尽等）按不可用处理：记日志后 302 回前端，不给裸 500
    try {
      if (state.purpose === 'bind') {
        const accountId = state.accountId as string;
        // 发起后账号可能已被别的连接绑过 / 该 GitHub 可能已绑别的号，唯一约束兜底统一提示
        const result = await timedDb(() => bindOauth(options.ctx.pool, accountId, identity));
        if (result === 'already_bound') {
          return void finish({ error: 'already_bound' });
        }
        return void finish({ bind: 'ok' }, entry);
      }

      // login：查号或建号，签一次性登录码带回前端（OAUTH_REDEEM 换会话令牌）
      const existing = await timedDb(() => findAccountByOauth(options.ctx.pool, 'github', user.id));
      if (existing) {
        const oneTimeCode = github.codes.create(
          { accountId: existing.id, username: existing.username, created: false },
          github.now(),
        );
        return void finish({ code: oneTimeCode }, entry);
      }
      const account = await timedDb(() => loginWithOauth(options.ctx.pool, identity, request.ip ?? null));
      const oneTimeCode = github.codes.create(
        { accountId: account.id, username: account.username, created: account.created },
        github.now(),
      );
      return void finish({ code: oneTimeCode }, entry);
    } catch (err) {
      diag.reason = `db:${dbErrorReason(err)}`;
      console.error('github callback database failed:', err);
      return void finish({ error: 'unavailable' }, entry);
    }
  });
}
