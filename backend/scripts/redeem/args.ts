// 兑换码运营脚本的公共参数解析（AISLG-253，AISLG-255 拆到 scripts/redeem/ 下按子命令分文件）。
// 手写解析：`--key value`、布尔开关（--unused）、可重复的 `--item` / `--code`；不装依赖。
// 每个子命令用 checkOptions 声明自己认哪些参数，多给参数直接报错（运营脚本宁可吵也不猜）。

export interface ParsedArgs {
  positional: string[];
  options: Map<string, string>;
  flags: Set<string>;
  repeatable: Map<string, string[]>;
}

/** 不带值、只表示开关的参数 */
const BOOLEAN_OPTIONS: ReadonlySet<string> = new Set(['unused']);
/** 可以重复给出的参数（每次一个值） */
const REPEATABLE_OPTIONS: ReadonlySet<string> = new Set(['item', 'code']);

/** 手写参数解析：--key value、布尔开关、可重复参数 */
export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();
  const repeatable = new Map<string, string[]>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (BOOLEAN_OPTIONS.has(key)) {
      if (flags.has(key)) {
        throw new Error(`--${key} 重复给出`);
      }
      flags.add(key);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${key} 缺少值`);
    }
    i += 1;
    if (REPEATABLE_OPTIONS.has(key)) {
      const list = repeatable.get(key) ?? [];
      list.push(value);
      repeatable.set(key, list);
    } else {
      if (options.has(key)) {
        throw new Error(`--${key} 重复给出`);
      }
      options.set(key, value);
    }
  }
  return { positional, options, flags, repeatable };
}

/** 只允许这些参数（含可重复的与开关），其余一律报错 */
export function checkOptions(args: ParsedArgs, allowed: readonly string[]): void {
  const known: ReadonlySet<string> = new Set(allowed);
  for (const key of args.options.keys()) {
    if (!known.has(key)) {
      throw new Error(`未知参数 --${key}`);
    }
  }
  for (const key of args.flags) {
    if (!known.has(key)) {
      throw new Error(`未知参数 --${key}`);
    }
  }
  for (const key of args.repeatable.keys()) {
    if (!known.has(key)) {
      throw new Error(`未知参数 --${key}`);
    }
  }
  if (args.positional.length > 0) {
    throw new Error(`多余的参数：${args.positional.join(' ')}`);
  }
}

export function readInt(options: Map<string, string>, key: string, min: number, max: number): number | null {
  const raw = options.get(key);
  if (raw === undefined) {
    return null;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(`--${key} 必须是整数，收到 ${raw}`);
  }
  const value = Number(raw);
  if (value < min || value > max) {
    throw new Error(`--${key} 必须在 ${min}..${max} 之间，收到 ${value}`);
  }
  return value;
}

export function requireOption(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (value === undefined || value.trim() === '') {
    throw new Error(`缺少 --${key}`);
  }
  return value.trim();
}

// list / stats 的列对齐：按终端显示宽度估算（中日韩字符算 2，其余算 1）
export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += /[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 2 : 1;
  }
  return width;
}

export function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(1, width - displayWidth(text)));
}

/** 过期时间的展示（ISO 时间；null = 不过期） */
export function formatDate(date: Date | null): string {
  return date ? date.toISOString() : '不过期';
}