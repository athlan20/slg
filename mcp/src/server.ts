// MCP 服务装配（AISLG-131）：工具全部由协议清单生成（manifest.ts 的排除与入参规则），
// 另加两个固定件——get_notifications 工具（读推送环形缓冲）与 agent-api 资源（整份协议
// 文档，AI 需要规则细节时自己读）。游戏侧返回错误时附错误码表里的人话解释；
// LOGIN 带 docNotice 时在工具结果开头提示 AI 更新文档。

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, type ZodTypeAny } from 'zod';
import type { SlgConnection } from './connection.js';
import type { SlgMcpConfig } from './config.js';
import {
  errorCodeMap,
  loadManifestMarkdown,
  toolOps,
  toolParams,
  type AgentApiManifest,
  type ToolParam,
} from './manifest.js';

export const AGENT_API_RESOURCE_URI = 'slg://agent-api.md';
const NOTIFICATIONS_TOOL = 'get_notifications';
const NOTIFICATION_PAGE_LIMIT = 50;

function zodForParam(param: ToolParam): ZodTypeAny {
  const base =
    param.kind === 'enum'
      ? z.enum(param.options as [string, ...string[]])
      : param.kind === 'number'
        ? z.number()
        : param.kind === 'boolean'
          ? z.boolean()
          : param.kind === 'string'
            ? z.string()
            : z.any();
  const withDesc = base.describe(
    param.kind === 'any' ? `${param.desc}（类型：${param.typeText}，结构按协议文档构造）` : param.desc,
  );
  return param.required ? withDesc : withDesc.optional();
}

function toolDescription(manifest: AgentApiManifest, opName: string, summary: string, agentNote?: string): string {
  const lines = [summary];
  if (agentNote) {
    lines.push(`\n使用建议：${agentNote}`);
  }
  lines.push(`\n（协议 op ${opName}，文档版本 v${manifest.version}；完整规则可读资源 ${AGENT_API_RESOURCE_URI}）`);
  return lines.join('\n');
}

interface ToolOutcome {
  text: string;
  isError: boolean;
}

function respondText(text: string, isError = false): ToolOutcome {
  return { text, isError };
}

/** 组装工具结果：docNotice 前置提示 */
function formatOutcome(connection: SlgConnection, outcome: ToolOutcome): ToolOutcome {
  const prefix =
    connection.docNotice !== null ? `[协议文档更新提示] ${connection.docNotice}\n\n` : '';
  if (!outcome.isError) {
    return respondText(prefix + outcome.text);
  }
  return respondText(prefix + outcome.text, true);
}

export function createMcpServer(
  config: SlgMcpConfig,
  manifest: AgentApiManifest,
  connection: SlgConnection,
  manifestMarkdown: string = loadManifestMarkdown(),
): McpServer {
  const server = new McpServer({ name: 'slg-mcp', version: getVersion() });
  const errorLookup = errorCodeMap(manifest);

  for (const op of toolOps(manifest)) {
    const shape: Record<string, ZodTypeAny> = {};
    for (const param of toolParams(op)) {
      shape[param.name] = zodForParam(param);
    }
    const description = toolDescription(manifest, op.name, op.summary, op.agentNote);
    server.registerTool(
      op.name,
      { title: op.title, description, inputSchema: shape },
      async (args) => {
        const response = await connection.request(op.op, (args ?? {}) as Record<string, unknown>);
        const outcome = response.ok
          ? respondText(JSON.stringify(response.data, null, 2))
          : respondText(
              describeError(errorLookup, response.error),
              true,
            );
        const decorated = formatOutcome(connection, outcome);
        return { content: [{ type: 'text' as const, text: decorated.text }], isError: decorated.isError };
      },
    );
  }

  server.registerTool(
    NOTIFICATIONS_TOOL,
    {
      title: '读取新消息（服务器推送）',
      description:
        '读取游戏服务器主动推送的消息（op ≥ 2000：建造完成、来袭预警、战报、资源与地块变化等）与连接状态变化。推送先存在本地缓冲，用本工具增量读取：传入上次返回的 nextSinceId（首次不传 = 从头读），只返回更新的部分。定时轮询本工具即可跟上游戏内发生的事情。',
      inputSchema: {
        sinceId: z.number().int().min(0).describe('上一次调用返回的 nextSinceId；不传表示从头读取缓冲内的全部消息').optional(),
        limit: z.number().int().min(1).max(200).describe('本次最多返回条数，默认 50').optional(),
      },
    },
    async (args) => {
      const sinceId = typeof args.sinceId === 'number' ? args.sinceId : 0;
      const limit = typeof args.limit === 'number' ? args.limit : NOTIFICATION_PAGE_LIMIT;
      const { entries, nextSinceId } = connection.notificationsSince(sinceId, limit);
      const payload = {
        notifications: entries,
        nextSinceId,
        hasMore: entries.length === limit && connection.notificationsSince(nextSinceId, 1).entries.length > 0,
        connection: { state: connection.getState(), server: config.server },
      };
      const decorated = formatOutcome(connection, respondText(JSON.stringify(payload, null, 2)));
      return { content: [{ type: 'text' as const, text: decorated.text }], isError: decorated.isError };
    },
  );

  server.registerResource(
    'agent-api',
    AGENT_API_RESOURCE_URI,
    { mimeType: 'text/markdown', description: `《SLG》Agent API 完整协议文档（v${manifest.version}）：全部操作、字段、错误码与游戏规则数值。` },
    async (uri) => ({
      contents: [{ uri: uri.href, text: manifestMarkdown, mimeType: 'text/markdown' }],
    }),
  );

  return server;
}

function describeError(
  errorLookup: Map<string, { desc: string; action?: string }>,
  error: { code: string; message: string },
): string {
  const known = errorLookup.get(error.code);
  const parts = [`游戏服务器返回错误 ${error.code}：${error.message}`];
  if (known) {
    parts.push(`（${known.desc}${known.action ? `；${known.action}` : ''}）`);
  }
  return parts.join('');
}

function getVersion(): string {
  return process.env.npm_package_version ?? '0.1.0';
}
