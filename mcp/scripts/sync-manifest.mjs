// 从仓库根的 docs/ 同步协议清单到 mcp/manifest/（协议变更后跑一次，
// MCP 工具列表在启动时由清单生成，无需改代码）。
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const mcpRoot = join(here, '..');
const docsDir = join(mcpRoot, '..', 'docs');
const manifestDir = join(mcpRoot, 'manifest');

mkdirSync(manifestDir, { recursive: true });
for (const file of ['agent-api.json', 'agent-api.md']) {
  copyFileSync(join(docsDir, file), join(manifestDir, file));
  console.log(`synced docs/${file} -> manifest/${file}`);
}
