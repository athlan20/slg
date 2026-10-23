// 诊断日志输出（AISLG-173）：统一为 `<ISO 时间戳> [前缀] 文本`，便于运维按关键字 grep。
// 默认开启，环境变量 DIAG_LOG=0 整体关闭（见 backend/README.md「故障排查：怎么捞日志」）。
// 只用于新增的诊断行；既有的 console 调用保持原样。

import { LogThrottle } from './log-throttle';

export type DiagLevel = 'info' | 'warn' | 'error';

const throttle = new LogThrottle();

/** 诊断日志是否开启：默认开启，DIAG_LOG=0 关闭（每次读取，便于运行中核对配置） */
export function diagEnabled(): boolean {
  return process.env.DIAG_LOG !== '0';
}

/** 输出一行诊断日志；warn / error 走 stderr */
export function diagLog(tag: string, message: string, level: DiagLevel = 'info'): void {
  if (!diagEnabled()) {
    return;
  }
  const line = `${new Date().toISOString()} [${tag}] ${message}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

/**
 * 限流版诊断日志：同一 key 在 windowMs 内只输出一行；放行时若期间有被合并的行，行尾附「合并=N」。
 */
export function diagLogThrottled(
  key: string,
  windowMs: number,
  tag: string,
  message: string,
  level: DiagLevel = 'info',
): void {
  if (!diagEnabled()) {
    return;
  }
  const suppressed = throttle.take(key, windowMs);
  if (suppressed === null) {
    return;
  }
  diagLog(tag, suppressed > 0 ? `${message} 合并=${suppressed}` : message, level);
}

/** 压成单行短文本：去掉换行与多余空白，超过 max 字符截断。用于语句文本与错误信息 */
export function oneLine(value: string, max = 200): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** 语句文本或错误信息的日志写法：单行、截断、加引号（语句只取文本，不含任何参数值） */
export function quoteText(text: string): string {
  return JSON.stringify(oneLine(text));
}
