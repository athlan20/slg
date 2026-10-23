// 请求日志脱敏（AISLG-173）：fastify 的请求日志会原样记下 URL。GitHub 回调地址的查询串里有授权码
// code 与 state，日志里一律替换为 [redacted]；其他路由的日志保持不变。
// 用法：fastify({ logger: { serializers: { req: requestLogSerializer } } })（与 fastify 默认 req 序列化字段一致）。

const REDACTED = '[redacted]';
/** 查询串里含敏感参数的路由（末尾斜杠视为同一路由） */
const SENSITIVE_PATHS = new Set(['/auth/github/callback']);
const SECRET_PARAMS = new Set(['code', 'state']);

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** 脱敏后的 URL：仅敏感路由的 code / state 取值被替换，其余原样保留 */
export function redactRequestUrl(url: string): string {
  const question = url.indexOf('?');
  if (question < 0) {
    return url;
  }
  const path = url.slice(0, question);
  if (!SENSITIVE_PATHS.has(path.replace(/\/+$/, ''))) {
    return url;
  }
  const parts = url
    .slice(question + 1)
    .split('&')
    .map((part) => {
      const eq = part.indexOf('=');
      const rawKey = eq < 0 ? part : part.slice(0, eq);
      return SECRET_PARAMS.has(safeDecode(rawKey)) ? `${rawKey}=${REDACTED}` : part;
    });
  return `${path}?${parts.join('&')}`;
}

/** fastify 的 req 序列化器替代实现：字段与 fastify 默认一致，只有 url 经过脱敏 */
export function requestLogSerializer(req: {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}): Record<string, unknown> {
  return {
    method: req.method,
    url: typeof req.url === 'string' ? redactRequestUrl(req.url) : req.url,
    version: req.headers?.['accept-version'],
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort,
  };
}
