// 跨域（CORS）注册：前端站点与 API 网关不同域名时（如国内站）
// 两者不同源，浏览器从站点页面发起的 HTTP 请求（/health、文档路由、未来的 REST 辅助接口）
// 需要跨域头才能读到响应；游戏 WebSocket（/ws）本身不受同源策略约束。
// 从 index.ts 拆出是为了能在无数据库环境（单元测试）用 inject 验证来源过滤行为。
// 来源策略（环境变量 CORS_ORIGIN）：
// - 未设置：默认允许 生产站点 https://slg.yuntianyou.cc + 本地开发来源（localhost/127.0.0.1 任意端口）；
//   页面与网关不同域名的站点（国内站）必须写进 CORS_ORIGIN；
// - `*`：允许任意来源（公开只读服务的宽策略）；
// - 逗号分隔的 Origin 清单：精确匹配白名单。
// 无 Origin 头的请求（同源 / curl / 服务端调用）不加跨域头（callback false），不影响访问。

import type { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { FastifyCorsOptions } from '@fastify/cors';

/** 生产前端站点 Origin（默认白名单成员） */
export const PRODUCTION_SITE_ORIGIN = 'https://slg.yuntianyou.cc';
/** 本地开发来源（rsbuild dev 等）：主机 localhost/127.0.0.1、任意端口、http/https */
const DEV_ORIGINPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export type CorsOriginConfig = '*' | string[];

/** 解析 CORS_ORIGIN：未设置为默认白名单（生产站点 + 本地开发另行正则放行） */
export function parseCorsOrigins(env: string | undefined): CorsOriginConfig {
  const raw = (env ?? '').trim();
  if (raw === '*') {
    return '*';
  }
  if (raw) {
    return raw.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [PRODUCTION_SITE_ORIGIN];
}

/**
 * 来源过滤器（@fastify/cors 的 origin 回调形态）；origin 缺省（非浏览器）不降级拒绝访问。
 * 回调第二参运行时为 boolean（true 反射来源 / false 不加跨域头），库的类型声明未收进
 * boolean、按 unknown 放宽以满足协变（cb(null, true) / cb(null, false) 为其文档用法）。
 */
export function corsOriginFilter(
  config: CorsOriginConfig,
): (origin: string | undefined, cb: (err: Error | null, allow?: unknown) => void) => void {
  return (origin, cb) => {
    if (origin === undefined || origin === '') {
      cb(null, false);
      return;
    }
    if (config === '*' || config.includes(origin) || DEV_ORIGINPattern.test(origin)) {
      cb(null, true);
      return;
    }
    cb(null, false);
  };
}

export async function registerCors(app: FastifyInstance): Promise<void> {
  await app.register(cors, {
    // 库对 origin 回调的布尔放行值（true 反射来源 / false 不加头）运行时明确支持、
    // 但类型声明未收进（OriginCallback 只认 string/RegExp/数组），此处局部对齐
    origin: corsOriginFilter(parseCorsOrigins(process.env.CORS_ORIGIN)) as unknown as FastifyCorsOptions['origin'],
    methods: ['GET', 'POST', 'OPTIONS'],
  });
}
