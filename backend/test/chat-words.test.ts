// 聊天屏蔽词过滤（v51，AISLG-138）的单元测试：词表解析、Aho-Corasick 替换与归一化规则。
// 不需要数据库。

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildBannedWordFilter,
  parseWordList,
  resolveWordListPath,
  CHAT_WORDS_EXAMPLE_PATH,
  CHAT_WORDS_LOCAL_PATH,
} from '../api/src/chat-words';

test('词表解析：去 BOM、CRLF / LF 都能拆行、去首尾空白、跳过空行、去重', () => {
  const raw = '﻿甲乙\r\n  丙丁  \r\n\r\n甲乙\n\n戊';
  assert.deepEqual(parseWordList(raw), ['甲乙', '丙丁', '戊']);
});

test('词表解析：全角词按半角归一，大小写不敏感', () => {
  assert.deepEqual(parseWordList('ＡＢＣ\nDeF'), ['abc', 'def']);
});

test('替换：命中的词逐码点替换成等长的 *，其余字符不变', () => {
  const filter = buildBannedWordFilter(['坏词']);
  assert.equal(filter.mask('这是坏词哦'), '这是**哦');
  assert.equal(filter.mask('没有问题'), '没有问题');
});

test('替换：多处命中都替换，词长为 1 的词也生效', () => {
  const filter = buildBannedWordFilter(['坏', '词语']);
  assert.equal(filter.mask('坏坏词语坏'), '*****');
});

test('大小写与全角半角等价：英文词在全角 / 大写输入下也被替换', () => {
  const filter = buildBannedWordFilter(['badword']);
  assert.equal(filter.mask('x BADWORD y'), 'x ******* y');
  assert.equal(filter.mask('ｂａｄｗｏｒｄ'), '*******');
});

test('包含关系：较长的词覆盖较短的词（同一位置只看最长命中）', () => {
  const filter = buildBannedWordFilter(['ab', 'abc']);
  assert.equal(filter.mask('xabcx'), 'x***x');
  assert.equal(filter.mask('xabx'), 'x**x');
});

test('重叠的两个词：整段都被覆盖', () => {
  const filter = buildBannedWordFilter(['甲乙', '乙丙']);
  assert.equal(filter.mask('甲乙丙'), '***');
});

test('按码点计长度：emoji（代理对）替换后长度不变，不会切坏', () => {
  const filter = buildBannedWordFilter(['坏']);
  const text = '😀坏😀';
  const masked = filter.mask(text);
  assert.equal(masked, '😀*😀');
  assert.equal(Array.from(masked).length, Array.from(text).length);
});

test('空词表：原样返回', () => {
  const filter = buildBannedWordFilter([]);
  assert.equal(filter.size, 0);
  assert.equal(filter.mask('随便写'), '随便写');
});

test('词条计数按去重后的有效词计', () => {
  const filter = buildBannedWordFilter(['甲', '甲', '乙']);
  assert.equal(filter.size, 2);
});

test('示例词表可解析且能替换示例词', () => {
  assert.ok(existsSync(CHAT_WORDS_EXAMPLE_PATH), '示例词表应随仓库提交');
  const words = parseWordList(readFileSync(CHAT_WORDS_EXAMPLE_PATH, 'utf8'));
  assert.ok(words.length >= 1);
  const filter = buildBannedWordFilter(words);
  assert.equal(filter.mask('你好示例屏蔽词'), '你好*****');
});

test('本机运营词表（若存在）：能解析出非空词条且 BOM / CRLF 不会混进首词', () => {
  const candidate = CHAT_WORDS_LOCAL_PATH;
  if (!existsSync(candidate)) {
    return;
  }
  const words = parseWordList(readFileSync(candidate, 'utf8'));
  assert.ok(words.length > 0);
  assert.ok(words.every((word) => word.length > 0 && !word.includes('\r') && !word.includes('\n') && !word.startsWith('﻿')));
});

test('选词表：环境变量优先，其次 backend/config/chat-banned-words.txt（存在才用），最后示例表', () => {
  const none = () => false;
  const all = () => true;
  assert.deepEqual(resolveWordListPath({ CHAT_BANNED_WORDS_FILE: ' /srv/words.txt ' }, all), {
    path: '/srv/words.txt',
    source: 'CHAT_BANNED_WORDS_FILE',
  });
  assert.deepEqual(resolveWordListPath({}, all), { path: CHAT_WORDS_LOCAL_PATH, source: 'config/chat-banned-words.txt' });
  assert.deepEqual(resolveWordListPath({ CHAT_BANNED_WORDS_FILE: '  ' }, none), {
    path: CHAT_WORDS_EXAMPLE_PATH,
    source: 'example list',
  });
  assert.equal(join(CHAT_WORDS_LOCAL_PATH, '..'), join(CHAT_WORDS_EXAMPLE_PATH, '..'));
});

test('词中间插空格、标点、零宽字符或组合符号仍被拦截，整段替换', () => {
  const filter = buildBannedWordFilter(['坏词']);
  assert.equal(filter.mask('坏 词'), '***');
  assert.equal(filter.mask('坏，词'), '***');
  assert.equal(filter.mask('坏\u200B词'), '***');
  assert.equal(filter.mask('坏\u3000.\u3000词'), '*****');
  assert.equal(filter.mask('坏\u0301词'), '***');
});

test('只替换命中的一段：前后的字、标点与表情保留', () => {
  const filter = buildBannedWordFilter(['坏词']);
  assert.equal(filter.mask('你好，坏 词！'), '你好，***！');
  assert.equal(filter.mask('😀坏 词😀'), '😀***😀');
});

test('词表里的空格与标点同样忽略：「坏-词」与「坏词」等价', () => {
  assert.deepEqual(parseWordList('坏-词\n坏 词\n坏词'), ['坏词']);
  assert.equal(buildBannedWordFilter(['坏-词']).mask('坏词'), '**');
});

test('只有标点的词条不参与匹配，不误伤正常文字', () => {
  const filter = buildBannedWordFilter(['—', '。']);
  assert.equal(filter.size, 0);
  assert.equal(filter.mask('你好。'), '你好。');
  assert.equal(buildBannedWordFilter(['坏词']).mask('坏好词'), '坏好词');
});

test('本机运营词表：每个词在字间插空格、逗号或零宽字符后都整段被替换', () => {
  const candidate = CHAT_WORDS_LOCAL_PATH;
  if (!existsSync(candidate)) {
    return;
  }
  const raw = readFileSync(candidate, 'utf8');
  const filter = buildBannedWordFilter(parseWordList(raw));
  let failures = 0;
  for (const line of raw.split(/\r?\n/)) {
    if (parseWordList(line).length === 0) {
      continue;
    }
    // 词首尾的标点不属于词本身（词表里偶有「词。」这类写法），只校验词的核心部分
    const cps = Array.from(line.trim().replace(/^[\s\p{P}\p{S}\p{Z}\p{C}\p{M}]+|[\s\p{P}\p{S}\p{Z}\p{C}\p{M}]+$/gu, ''));
    for (const sep of [' ', '，', '\u200B']) {
      const text = cps.join(sep);
      if (filter.mask(text) !== '*'.repeat(Array.from(text).length)) {
        failures += 1;
      }
    }
  }
  assert.equal(failures, 0, '有词在插入空格 / 标点 / 零宽字符后没有被整段替换（失败的词不在报错里输出）');
});
