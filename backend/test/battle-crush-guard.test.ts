// 折算接入口径的守卫测试（AISLG-246）：扫描 backend/{common,worker,api}/src 下所有 .ts，
// 拦住「以后新加的战斗出口漏折算」与「出口自己再包一层导致同一结果被折算两次」。
//
// 规则：
// 1. simulateBattle( 只允许出现在统一结算出口与引擎本身（白名单），战斗出口必须走 resolveBattle；
// 2. resolveBattle( 的调用不得带 crush: false（src 里没有需要引擎原始战损的出口）；
// 3. scaleCrushLosses( 只允许在 battle.ts（统一出口）与 battle-crush.ts（定义）出现——
//    出口自己包一层会与 resolveBattle 的缺省折算叠加，二次缩小战损。
// 需要引擎原始战损的只有校准脚本（backend/scripts/*-calibration.ts，显式传 crush: false），
// 不在本测试的扫描范围内。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');

/** 允许直接调 simulateBattle 的文件（相对 backend/） */
const SIMULATE_WHITELIST = new Set([
  'common/src/battle-engine.ts', // 引擎本身（定义处）
  'common/src/battle.ts', // 统一结算出口 resolveBattle / resolveNpcRaid 内部
  'common/src/battle-crush.ts', // 只有类型引用，留作白名单防将来复用
]);

/** 允许出现 crush: false 的文件（相对 backend/）：目前为空——所有出口都必须折算 */
const CRUSH_FALSE_WHITELIST = new Set<string>([]);

/** 允许直接调 scaleCrushLosses 的文件（相对 backend/） */
const SCALE_WHITELIST = new Set([
  'common/src/battle.ts', // 统一结算出口里调用
  'common/src/battle-crush.ts', // 定义处
]);

const SCAN_DIRS = ['common/src', 'worker/src', 'api/src'];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function allFiles(): Array<{ rel: string; text: string }> {
  const files: Array<{ rel: string; text: string }> = [];
  for (const dir of SCAN_DIRS) {
    const base = path.join(ROOT, dir);
    if (!fs.existsSync(base)) {
      continue;
    }
    for (const full of listTsFiles(base)) {
      files.push({ rel: path.relative(ROOT, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') });
    }
  }
  return files;
}

/** 去掉整行注释与块注释，避免文档里提到函数名被误判（保留代码行） */
function codeLines(text: string): string[] {
  const withoutBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlock
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .filter((line) => line.trim().length > 0);
}

test('守卫：只有统一结算出口可以直接调 simulateBattle', () => {
  const files = allFiles();
  assert.ok(files.length > 50, `扫描到的源文件数异常（${files.length}）`);
  const offenders: string[] = [];
  for (const file of files) {
    if (SIMULATE_WHITELIST.has(file.rel)) {
      continue;
    }
    codeLines(file.text).forEach((line, index) => {
      if (/\bsimulateBattle\s*\(/.test(line)) {
        offenders.push(`${file.rel}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `这些地方绕过统一出口直接调引擎（战斗出口必须走 resolveBattle）：${offenders.join(', ')}`);
});

test('守卫：resolveBattle 的调用不得关闭折算（crush: false）', () => {
  const files = allFiles();
  const offenders: string[] = [];
  for (const file of files) {
    if (CRUSH_FALSE_WHITELIST.has(file.rel)) {
      continue;
    }
    if (codeLines(file.text).some((line) => /crush\s*:\s*false/.test(line))) {
      offenders.push(file.rel);
    }
  }
  assert.deepEqual(offenders, [], `这些文件关闭了战损折算（只有校准脚本可以，且要在 scripts/ 下）：${offenders.join(', ')}`);
});

test('守卫：出口不得自己再包一层 scaleCrushLosses（避免同一结果被折算两次）', () => {
  const files = allFiles();
  const offenders: string[] = [];
  for (const file of files) {
    if (SCALE_WHITELIST.has(file.rel)) {
      continue;
    }
    codeLines(file.text).forEach((line, index) => {
      if (/\bscaleCrushLosses\s*\(/.test(line)) {
        offenders.push(`${file.rel}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `这些地方重复包装折算（折算在 resolveBattle 里已统一做过）：${offenders.join(', ')}`);
});
