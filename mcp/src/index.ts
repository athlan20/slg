#!/usr/bin/env node
// slg-mcp 入口（AISLG-131）：stdio 传输的 MCP Server。stdout 是 JSON-RPC 通道，
// 一切日志走 stderr。启动即连游戏服务器并自动重连；SLG_TOKEN 缺失时以清晰
// 报错退出（AI 工具的 MCP 面板会把 stderr 展示给玩家）。

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConfig } from './config.js';
import { SlgConnection } from './connection.js';
import { createMcpServer } from './server.js';
import { loadManifest, loadManifestMarkdown } from './manifest.js';

async function main(): Promise<void> {
  const parsed = readConfig(process.env);
  if ('error' in parsed) {
    console.error(`[slg-mcp] ${parsed.error}`);
    process.exit(1);
  }
  const config = parsed.config;
  const manifest = loadManifest();
  const connection = new SlgConnection(config, manifest);
  connection.start();

  const server = createMcpServer(config, manifest, connection, loadManifestMarkdown());
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[slg-mcp] 已启动：${manifest.ops.length} 个协议操作，工具由清单生成（文档版本 v${manifest.version}）；服务器 ${config.server}`);

  const shutdown = (): void => {
    void connection.stop().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error('[slg-mcp] 启动失败:', err instanceof Error ? err.message : err);
  process.exit(1);
});
