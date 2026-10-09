// 聊天屏蔽词过滤（v51，AISLG-138）。
// 启动时从 CHAT_BANNED_WORDS_FILE 读取词表（UTF-8，可带 BOM，CRLF / LF 均可），建成 Aho-Corasick 自动机；
// 发送前把命中的词替换成等长的 *。匹配前先去掉空格、标点、符号、emoji、零宽字符等「不计字」的字符，所以在词中间
// 插空格、标点、零宽字符也拦得住（词表里的这类字符同样忽略，「坏-词」即「坏词」）；大小写不敏感、全角与半角等价。
// 替换时整段覆盖：从命中的第一个字到最后一个字，中间被忽略的字符一并盖住，按码点等长。
// 词表是运营数据，只放服务器（仓库 .gitignore 忽略 backend/config/chat-banned-words.txt）。
// 选词表的顺序：CHAT_BANNED_WORDS_FILE → backend/config/chat-banned-words.txt（存在才用）→ 仓库内的示例表。
// 配置了路径却读不到时启动失败，不在没有过滤的状态下开放聊天。

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** 默认的运营词表位置（不进仓库；部署时把词表放到这里即可，不用配环境变量） */
export const CHAT_WORDS_LOCAL_PATH = join(__dirname, '../../config/chat-banned-words.txt');

/** 仓库内示例词表（只有几个测试词，前两处都没有词表时使用） */
export const CHAT_WORDS_EXAMPLE_PATH = join(__dirname, '../../config/chat-banned-words.example.txt');

export interface BannedWordFilter {
  /** 返回把命中的屏蔽词替换成 * 之后的文本（长度按码点保持不变） */
  mask(text: string): string;
  /** 有效词条数（去重后） */
  readonly size: number;
}

/** 不计字的字符：空白、标点、符号（含 emoji）、分隔符、控制 / 格式字符（含零宽）、组合附加符号。匹配前全部去掉 */
const IGNORED = /[\s\p{P}\p{S}\p{Z}\p{C}\p{M}]/u;

interface MatchUnits {
  /** 参与匹配的单元：逐码点 NFKC + 小写，不计字已去掉 */
  units: string[];
  /** 每个单元来自原文的第几个码点（命中位置据此映回原文） */
  origin: number[];
}

/** 把文字拆成匹配单元：不计字跳过，其余逐码点 NFKC + 小写；origin 记下每个单元来自原文的哪个码点 */
function toUnits(text: string): MatchUnits {
  const units: string[] = [];
  const origin: number[] = [];
  Array.from(text).forEach((cp, index) => {
    if (IGNORED.test(cp)) {
      return;
    }
    for (const unit of Array.from(cp.normalize('NFKC').toLowerCase())) {
      if (!IGNORED.test(unit)) {
        units.push(unit);
        origin.push(index);
      }
    }
  });
  return { units, origin };
}

/** 词条的匹配形式（去掉不计字之后）；为空的词不参与匹配 */
function wordKey(word: string): string {
  return toUnits(word).units.join('');
}

/** 解析词表文本：去 BOM、按行拆分、取匹配形式、跳过空行、去重 */
export function parseWordList(raw: string): string[] {
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const words = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const key = wordKey(line);
    if (key.length > 0) {
      words.add(key);
    }
  }
  return Array.from(words);
}

interface TrieNode {
  next: Map<string, number>;
  fail: number;
  /** 以本节点结尾的词长（码点单元数，0 = 不是词尾） */
  ownLen: number;
  /** 以本节点结尾、且是某个词的后缀的最长词长（沿失败链取最大） */
  dictLen: number;
}

/** 由词表建 Aho-Corasick 自动机（单元按归一后的码点计） */
export function buildBannedWordFilter(words: readonly string[]): BannedWordFilter {
  const nodes: TrieNode[] = [{ next: new Map(), fail: 0, ownLen: 0, dictLen: 0 }];
  let size = 0;
  for (const word of words) {
    const units = toUnits(word).units;
    if (units.length === 0) {
      continue;
    }
    let node = 0;
    for (const unit of units) {
      let child = nodes[node].next.get(unit);
      if (child === undefined) {
        child = nodes.push({ next: new Map(), fail: 0, ownLen: 0, dictLen: 0 }) - 1;
        nodes[node].next.set(unit, child);
      }
      node = child;
    }
    if (nodes[node].ownLen === 0) {
      size += 1;
    }
    nodes[node].ownLen = Math.max(nodes[node].ownLen, units.length);
  }

  // 失败链：按层（BFS）计算，保证计算某节点时它的失败节点已经final
  const queue: number[] = [];
  for (const child of nodes[0].next.values()) {
    nodes[child].dictLen = nodes[child].ownLen;
    queue.push(child);
  }
  for (let head = 0; head < queue.length; head += 1) {
    const parent = queue[head];
    for (const [unit, child] of nodes[parent].next) {
      let f = nodes[parent].fail;
      while (f !== 0 && !nodes[f].next.has(unit)) {
        f = nodes[f].fail;
      }
      const target = nodes[f].next.get(unit);
      nodes[child].fail = target !== undefined && target !== child ? target : 0;
      nodes[child].dictLen = Math.max(nodes[child].ownLen, nodes[nodes[child].fail].dictLen);
      queue.push(child);
    }
  }

  return {
    size,
    mask(text: string): string {
      const cps = Array.from(text);
      const { units, origin } = toUnits(text);
      const masked = new Uint8Array(cps.length);
      let state = 0;
      for (let i = 0; i < units.length; i += 1) {
        const unit = units[i];
        while (state !== 0 && !nodes[state].next.has(unit)) {
          state = nodes[state].fail;
        }
        const target = nodes[state].next.get(unit);
        state = target !== undefined ? target : 0;
        // 以当前位置结尾的最长词能覆盖所有以此结尾的更短词
        const len = nodes[state].dictLen;
        if (len > 0) {
          // 整段覆盖：从命中的第一个字到最后一个字，中间被忽略的字符（空格、标点等）一并盖住
          for (let k = origin[i - len + 1]; k <= origin[i]; k += 1) {
            masked[k] = 1;
          }
        }
      }
      return cps.map((cp, index) => (masked[index] ? '*' : cp)).join('');
    },
  };
}

let active: BannedWordFilter | null = null;

export type WordListSource = 'CHAT_BANNED_WORDS_FILE' | 'config/chat-banned-words.txt' | 'example list';

/** 选词表：环境变量优先，其次默认位置（存在才用），最后示例表 */
export function resolveWordListPath(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): { path: string; source: WordListSource } {
  const configured = env.CHAT_BANNED_WORDS_FILE?.trim();
  if (configured) {
    return { path: configured, source: 'CHAT_BANNED_WORDS_FILE' };
  }
  if (exists(CHAT_WORDS_LOCAL_PATH)) {
    return { path: CHAT_WORDS_LOCAL_PATH, source: 'config/chat-banned-words.txt' };
  }
  return { path: CHAT_WORDS_EXAMPLE_PATH, source: 'example list' };
}

/** 启动时调用：读取词表并建好过滤器（配置了路径却读取失败会抛错） */
export function initBannedWordFilter(env: NodeJS.ProcessEnv = process.env): BannedWordFilter {
  const { path, source } = resolveWordListPath(env);
  const words = parseWordList(readFileSync(path, 'utf8'));
  active = buildBannedWordFilter(words);
  console.log(`chat banned words: ${active.size} entries from ${source}`);
  return active;
}

/** 取已初始化的过滤器（未调用 initBannedWordFilter 时抛错） */
export function bannedWordFilter(): BannedWordFilter {
  if (!active) {
    throw new Error('chat banned-word filter is not initialized');
  }
  return active;
}
