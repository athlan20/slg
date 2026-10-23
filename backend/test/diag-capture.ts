// 诊断日志测试的公共辅助（AISLG-173）：收集 console 输出，便于断言日志行与脱敏结果。
// 不是测试文件（不以 .test.ts 结尾），由各诊断测试引用。

export async function captureConsole(run: () => Promise<void> | void): Promise<string[]> {
  const lines: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const push = (...args: unknown[]): void => {
    lines.push(args.map((arg) => (typeof arg === 'string' ? arg : arg instanceof Error ? arg.message : String(arg))).join(' '));
  };
  console.log = push;
  console.warn = push;
  console.error = push;
  try {
    await run();
  } finally {
    console.log = saved.log;
    console.warn = saved.warn;
    console.error = saved.error;
  }
  return lines;
}

/** 同步执行并丢弃 console 输出（用于夹具初始化时的 connect 事件，避免测试输出里混入无关诊断行） */
export function silenceConsole<T>(run: () => T): T {
  const saved = { log: console.log, warn: console.warn, error: console.error };
  console.log = () => undefined;
  console.warn = () => undefined;
  console.error = () => undefined;
  try {
    return run();
  } finally {
    console.log = saved.log;
    console.warn = saved.warn;
    console.error = saved.error;
  }
}

/** 临时设置环境变量，结束后恢复 */
export async function withEnv(env: Record<string, string | undefined>, run: () => Promise<void> | void): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    saved[key] = process.env[key];
    if (env[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = env[key];
    }
  }
  try {
    await run();
  } finally {
    for (const key of Object.keys(env)) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}
