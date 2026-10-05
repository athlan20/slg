// 环境变量配置（AISLG-131）：Agent 令牌只存在玩家本机的 MCP 配置里，
// 只发给 SLG_SERVER 指向的游戏服务器，不发给任何第三方。

export interface SlgMcpConfig {
  /** 玩家的永久 Agent 令牌（sk_ 前缀，来自游戏内「复制给 AI」） */
  token: string;
  /** 游戏 WebSocket 地址；默认公测服 */
  server: string;
  /** 可选（协议 v50）：LOGIN 时自报的驱动模型名，进「模型榜」分组（不填则未声明） */
  agentModel: string | null;
  /** 单个工具调用的等待上限（毫秒） */
  requestTimeoutMs: number;
  /** 等待连接就绪（含登录）的上限（毫秒） */
  readyTimeoutMs: number;
}

export const DEFAULT_SERVER = 'wss://slg.yuntianyou.cc/ws';

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 300_000;

function readTimeout(env: NodeJS.ProcessEnv, key: string, fallbackMs: number): number {
  const raw = Number(env[key]);
  if (!Number.isFinite(raw)) {
    return fallbackMs;
  }
  return Math.min(Math.max(Math.floor(raw), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

/** 解析环境变量；token 缺失时返回 error（进程以清晰报错退出，而不是半启动） */
export function readConfig(env: NodeJS.ProcessEnv): { config: SlgMcpConfig } | { error: string } {
  const token = typeof env.SLG_TOKEN === 'string' ? env.SLG_TOKEN.trim() : '';
  if (token === '') {
    return {
      error:
        '缺少环境变量 SLG_TOKEN：请填入游戏内「Agent 面板 → 复制给 AI / 复制 MCP 配置」里的 Agent 令牌（sk_ 开头）。详见 https://github.com/athlan20/slg 的 mcp/README.md。',
    };
  }
  const server = typeof env.SLG_SERVER === 'string' && env.SLG_SERVER.trim() !== '' ? env.SLG_SERVER.trim() : DEFAULT_SERVER;
  const agentModel = typeof env.SLG_AGENT_MODEL === 'string' && env.SLG_AGENT_MODEL.trim() !== '' ? env.SLG_AGENT_MODEL.trim() : null;
  return {
    config: {
      token,
      server,
      agentModel,
      requestTimeoutMs: readTimeout(env, 'SLG_REQUEST_TIMEOUT_MS', 30_000),
      readyTimeoutMs: readTimeout(env, 'SLG_READY_TIMEOUT_MS', 20_000),
    },
  };
}
