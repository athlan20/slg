// GET /auth/config（v44，AISLG-127）：登录入口的公开配置。前端登录页 / 账号设置据此决定
// 显示哪些入口（Google 按钮、GitHub 按钮、微信扫码分页、用户名密码表单）。
// v47（AISLG-130 双站点）：passwordLogin 与 githubEnabled 按请求的 Host 计算——国际站
// （PASSWORD_LOGIN_DISABLED_HOSTS 列出的 Host）没有密码表单；GitHub 两站各一个 OAuth App。
// 跨域沿用 registerCors 的全站策略（国际站页面与 API 同域名，天然同源）。

import type { FastifyInstance } from 'fastify';
import { hostFromHeaders } from './site-config';
import type { GithubSiteConfig } from './site-config';

export interface AuthConfigDeps {
  /** Google 登录的 Client ID（两站共用一个；null = 未配置） */
  googleClientId: string | null;
  /** 微信扫码登录是否可用（配置了 WX_APPID / WX_APPSECRET） */
  wechatEnabled: boolean;
  /** 是否信任代理头（与 fastify trustProxy 同值；Host 取法与 /ws 一致：优先 X-Forwarded-Host） */
  trustProxy: boolean;
  /** 请求站点是否关闭了密码登录（PASSWORD_LOGIN_DISABLED_HOSTS） */
  isPasswordLoginDisabled: (host: string | null) => boolean;
  /** 请求站点的 GitHub 配置套（null = 该站未配置） */
  githubSiteForHost: (host: string | null) => GithubSiteConfig | null;
}

export function registerAuthConfigRoute(app: FastifyInstance, deps: AuthConfigDeps): void {
  app.get('/auth/config', async (request, reply) => {
    // 与 WebSocket 连接同规则：TRUST_PROXY 开启时优先 X-Forwarded-Host
    const host = hostFromHeaders(request.headers, deps.trustProxy);
    // 站点关了密码登录 = 国际站（只有 Google / GitHub）：微信入口也一并关掉
    const passwordLogin = !deps.isPasswordLoginDisabled(host);
    reply
      .type('application/json; charset=utf-8')
      .header('cache-control', 'public, max-age=60');
    return {
      googleClientId: deps.googleClientId,
      // v47：国际站是「纯第三方站」——登录入口只有 Google / GitHub，微信扫码入口也一并关掉
      wechatEnabled: passwordLogin ? deps.wechatEnabled : false,
      // v47：国际站不显示用户名密码表单（旧后端没有该字段时前端按 true 处理）
      passwordLogin,
      githubEnabled: deps.githubSiteForHost(host) !== null,
    };
  });
}
