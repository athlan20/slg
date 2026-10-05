// 一键生成 Agent API 文档：docs/agent-api.md 与 docs/agent-api.json。
// 用法：npm run gen:api-doc 生成产物；npm run check:api-doc（--check）只校验
// 仓库产物与协议清单渲染结果一致、不写文件，供本地/CI 漂移检查。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderAgentApiManifest, renderAgentApiMarkdown } from '../common/src/protocol-doc-render';

// tsc（commonjs）不允许 import.meta；用脚本自身路径定位仓库 docs/ 目录，
// npm 脚本下 process.argv[1] 即本脚本路径。
const docsDir = path.resolve(path.dirname(process.argv[1]), '../../docs');

const artifacts = [
  { file: 'agent-api.md', content: renderAgentApiMarkdown() },
  { file: 'agent-api.json', content: renderAgentApiManifest() },
];

async function main(): Promise<void> {
  if (process.argv.includes('--check')) {
    let stale = false;
    for (const { file, content } of artifacts) {
      const target = path.join(docsDir, file);
      const existing = await readFile(target, 'utf8').catch(() => null);
      if (existing === content) {
        console.log(`✓ ${target} 与协议清单一致`);
      } else {
        stale = true;
        console.error(`✗ ${target} 缺失或与协议清单不一致：运行 npm run gen:api-doc 重新生成`);
      }
    }
    process.exitCode = stale ? 1 : 0;
    return;
  }
  await mkdir(docsDir, { recursive: true });
  for (const { file, content } of artifacts) {
    const target = path.join(docsDir, file);
    await writeFile(target, content);
    console.log(`已生成 ${target}`);
  }
}

main().catch((err) => {
  console.error('生成失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
