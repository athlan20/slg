// 协议清单（docs/agent-api.json 的同步副本，见 scripts/sync-manifest.mjs）：
// MCP 工具在启动时由清单生成——一个 op 对应一个 tool，协议新增操作后重新
// sync:manifest 即出现，不用手写。排除规则（与后端的角色限制对齐，见
// backend/api/src/handlers*.ts 的 conn.role !== 'player' 拦截）：
// - preAuth（登录前）的 op：WX_* / GOOGLE_LOGIN / GITHUB_AUTH_START / OAUTH_REDEEM——
//   仅供网页与微信小游戏；
// - LOGIN / LOGOUT：由本服务自己的连接管理，暴露成工具只会破坏连接；
// - 仅玩家连接可调：RESET_ACCOUNT / GOOGLE_BIND / GET_AGENT_TOKEN / RESET_AGENT_TOKEN
//   （Agent 连接一律 AGENT_FORBIDDEN）。

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ManifestField {
  name: string;
  type: string;
  desc: string;
}

export interface ManifestOp {
  op: number;
  kind: 'request' | 'push';
  name: string;
  title: string;
  preAuth?: boolean;
  summary: string;
  requestFields?: ManifestField[];
  agentNote?: string;
}

export interface ManifestErrorCode {
  desc: string;
  action?: string;
}

export interface AgentApiManifest {
  version: number;
  title: string;
  ops: ManifestOp[];
  errorCodes?: Record<string, ManifestErrorCode>;
}

/** 仅玩家连接可调、不生成工具的 op 名（preAuth 之外的补充名单） */
const PLAYER_ONLY_OPS = new Set(['RESET_ACCOUNT', 'GOOGLE_BIND', 'GET_AGENT_TOKEN', 'RESET_AGENT_TOKEN']);

/** 由本服务自行管理、不作为工具暴露的 op 名 */
const SELF_MANAGED_OPS = new Set(['LOGIN', 'LOGOUT']);

/** manifest/ 目录：src 与 dist 到它的相对层级一致，运行时定位无需打包器支持 */
function manifestDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'manifest');
}

export function loadManifest(): AgentApiManifest {
  const raw = JSON.parse(readFileSync(join(manifestDir(), 'agent-api.json'), 'utf8')) as AgentApiManifest;
  return raw;
}

export function loadManifestMarkdown(): string {
  return readFileSync(join(manifestDir(), 'agent-api.md'), 'utf8');
}

/** 生成 MCP 工具用的 op 清单（保留原有顺序，剔除排除项） */
export function toolOps(manifest: AgentApiManifest): ManifestOp[] {
  return manifest.ops.filter(
    (op) => op.kind === 'request' && !op.preAuth && !SELF_MANAGED_OPS.has(op.name) && !PLAYER_ONLY_OPS.has(op.name),
  );
}

/** 字段名必须是合法标识符：清单里的「（规则）」等纯文档行不是真实参数，跳过 */
const IDENTIFIER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ParamKind = 'string' | 'number' | 'boolean' | 'enum' | 'any';

export interface ToolParam {
  name: string;
  desc: string;
  required: boolean;
  kind: ParamKind;
  /** kind=enum 时的取值 */
  options: string[];
  /** 原始类型文本（object 等复杂类型写进描述，让模型照协议构造） */
  typeText: string;
}

/** 单引号字面量联合（"'a' | 'b'"）→ 枚举；其余按基础类型映射，复杂类型宽松放行 */
function parseKind(typeText: string): { kind: ParamKind; options: string[] } {
  if (typeText === 'boolean') {
    return { kind: 'boolean', options: [] };
  }
  if (typeText === 'number') {
    return { kind: 'number', options: [] };
  }
  const options = [...typeText.matchAll(/'([^']+)'/g)].map((match) => match[1] as string);
  if (options.length > 0 && /^[\s'|-]+$/.test(typeText.replace(/'[^']*'/g, ''))) {
    return { kind: 'enum', options };
  }
  // 纯 string / 'string | null' 等含 string 字样的都按 string 收
  if (typeText.split('|').every((part) => part.trim() === 'string' || part.trim() === 'null')) {
    return { kind: 'string', options: [] };
  }
  return { kind: 'any', options: [] };
}

/** op 的请求字段 → 工具入参定义；desc 以「必填」开头视为必填（清单约定） */
export function toolParams(op: ManifestOp): ToolParam[] {
  const fields = op.requestFields ?? [];
  const params: ToolParam[] = [];
  for (const field of fields) {
    if (!IDENTIFIER_NAME.test(field.name)) {
      continue;
    }
    const { kind, options } = parseKind(field.type);
    params.push({
      name: field.name,
      desc: field.desc,
      required: field.desc.startsWith('必填'),
      kind,
      options,
      typeText: field.type,
    });
  }
  return params;
}

/** 错误码 → 描述映射（工具失败时附给人话解释） */
export function errorCodeMap(manifest: AgentApiManifest): Map<string, ManifestErrorCode> {
  return new Map(Object.entries(manifest.errorCodes ?? {}));
}
