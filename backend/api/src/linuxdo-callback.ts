// Linux.do OAuth 回调路由（AISLG-258）：GET /auth/linuxdo/callback?code=…&state=…
//（玩家在 linux.do 点「取消」时带 error=access_denied）。核对并作废 state 后用 code 换用户信息，
// 资格不足（等级 / 禁言 / 未激活）在换令牌阶段即拒绝，不建号、不绑定。login 路径查号或建号后
// 生成 60 秒一次性登录码 302 回前端 ?oauth=linuxdo&code=…；bind 路径写绑定后 302 回 ?oauth=linuxdo&bind=ok。
// 失败一律 302 回前端带 error=canceled / expired / unavailable / already_bound / not_eligible。
// 一次性码与 GitHub 共用 OAUTH_REDEEM 兑换，本路由不依赖 GitHub 是否配置。
// 注意：本路由必须不被 CDN 缓存（响应带 no-store；CDN 侧也要设为不缓存，见 backend/README.md）。

import type { FastifyInstance } from 'fastify';
import type { HandlerContext } from './handlers';
import { linuxdoEntryFor, type LinuxdoService } from './handlers-linuxdo';
import { LinuxdoError } from './linuxdo';
import { bindOauth, findAccountByOauth, loginWithOauth, updateOauthDisplayName } from './oauth-accounts';
import { diagLog } from '../../common/src/diag-log';
import { dbErrorReason } from '../../common/src/db-diag';

export function registerLinuxdoCallbackRoute(
  app: FastifyInstance,
  options: { linuxdo: LinuxdoService; ctx: HandlerContext },
): void {
  app.get('/auth/linuxdo/callback', async (request, reply) => {
    const startedAt = Date.now();
    // [oauth-callback] 诊断字段：只记结果与耗时，绝不记 code、令牌与 state
    const diag: { purpose?: string; site?: string; reason?: string; exchangeMs?: number; dbMs?: number } = {};
    const service = options.linuxdo;
    const query = request.query as Record<string, unknown>;
    const stateValue = typeof query.state === 'string' ? query.state : '';
    const code = typeof query.code === 'string' ? query.code : '';
    // 跳回哪个前端由发起站点的 state 决定；state 无效时用 default 套兜底（只要能 302 走）
    const fallback = linuxdoEntryFor(service, null);

    const report = (result: string): void => {
      diagLog(
        'oauth-callback',
        `result=${result} provider=linuxdo purpose=${diag.purpose ?? '-'} site=${diag.site ?? '-'} reason=${diag.reason ?? '-'} ` +
          `exchange_ms=${diag.exchangeMs ?? '-'} db_ms=${diag.dbMs ?? '-'} total_ms=${Date.now() - startedAt}`,
      );
    };
    // 数据库步骤计时（login 路径可能查多次，耗时累加）
    const timedDb = async <T>(work: () => Promise<T>): Promise<T> => {
      const dbStartedAt = Date.now();
      try {
        return await work();
      } finally {
        diag.dbMs = (diag.dbMs ?? 0) + Date.now() - dbStartedAt;
      }
    };
    const finish = (params: Record<string, string>, entry = fallback): void => {
      report(params.error ?? 'ok');
      const frontendUrl = entry?.config.frontendUrl;
      if (!frontendUrl) {
        reply.code(503).send({ error: 'LINUXDO_UNAVAILABLE' });
        return;
      }
      reply.header('cache-control', 'no-store');
      reply.redirect(`${frontendUrl}/?${new URLSearchParams({ oauth: 'linuxdo', ...params })}`);
    };

    // state 核对并作废（一次性）：不存在 / 过期 / 被重复使用都按过期提示；取消同样要核对
    const state = stateValue ? service.states.take(stateValue, service.now()) : null;
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

    // state 里记着发起站点：用它选 Linux.do 配置套换令牌
    const entry = linuxdoEntryFor(service, state.host);
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
      if (!(err instanceof LinuxdoError)) {
        console.error('linuxdo callback failed:', err);
        diag.reason = 'linuxdo:error';
        return void finish({ error: 'unavailable' }, entry);
      }
      diag.reason = `linuxdo:${err.kind}`;
      // code 被篡改 / 已用过按过期；资格不足回 not_eligible；接口性故障按不可用
      return void finish({ error: err.kind === 'code_invalid' ? 'expired' : err.kind }, entry);
    }
    diag.exchangeMs = Date.now() - exchangeStartedAt;
    const identity = { provider: 'linuxdo' as const, subject: user.id, displayName: user.login };

    // 数据库故障（连接卡死 / 超时 / 池耗尽等）按不可用处理：记日志后 302 回前端，不给裸 500
    try {
      if (state.purpose === 'bind') {
        const accountId = state.accountId as string;
        const result = await timedDb(() => bindOauth(options.ctx.pool, accountId, identity));
        if (result === 'already_bound') {
          return void finish({ error: 'already_bound' }, entry);
        }
        return void finish({ bind: 'ok' }, entry);
      }

      // login：查号或建号，签一次性登录码带回前端（OAUTH_REDEEM 换会话令牌）。绑定身份由不可变数字 id 确定，
      // 已有账号时顺手刷新展示名（用户在 Linux.do 改名后仍是同一个号）
      const existing = await timedDb(() => findAccountByOauth(options.ctx.pool, 'linuxdo', user.id));
      const account = existing
        ? { id: existing.id, username: existing.username, created: false }
        : await timedDb(() => loginWithOauth(options.ctx.pool, identity, request.ip ?? null));
      if (existing) {
        await timedDb(() => updateOauthDisplayName(options.ctx.pool, 'linuxdo', user.id, user.login));
      }
      const oneTimeCode = service.codes.create(
        { accountId: account.id, username: account.username, created: account.created },
        service.now(),
      );
      return void finish({ code: oneTimeCode }, entry);
    } catch (err) {
      diag.reason = `db:${dbErrorReason(err)}`;
      console.error('linuxdo callback database failed:', err);
      return void finish({ error: 'unavailable' }, entry);
    }
  });
}
