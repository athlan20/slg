// 微信扫码登录与 Agent 令牌的类型镜像（v43）：唯一事实来源是 backend/common/src/protocol.ts，
// 字段说明见 docs/agent-api.md 与 docs/wechat-qr-login.md。protocol.ts 保持只放协议号与错误码。

export type WxQrPurpose = 'login' | 'bind';

/** WX_QR_CREATE（op 54）响应 */
export interface WxQrCreateData {
  ticket: string;
  /** 小游戏码图片，data URI，可直接放进 <img src> */
  qrImage: string;
  /** ticket 过期时间（ISO 8601，约 3 分钟后） */
  expiresAt: string;
}

/** PUSH_WX_QR_STATUS（op 2018）推送载荷 */
export interface WxQrStatusPushData {
  ticket: string;
  status: 'scanned' | 'confirmed' | 'canceled' | 'expired';
  /** 仅 login 用途的 confirmed：会话令牌，随后走 LOGIN {token} */
  sessionToken?: string;
  /** 仅 bind 用途的 confirmed：恒为 true */
  bound?: boolean;
}

/** GET_AGENT_TOKEN / RESET_AGENT_TOKEN（op 64 / 65，v46）响应：每账号一个永久令牌 */
export interface AgentTokenData {
  /** 令牌原文（sk_ 前缀，永不过期） */
  token: string;
  /** 生成 / 最近一次重置时间 */
  createdAt: string;
  /** 最近一次用它登录；从未用过为 null */
  lastUsedAt: string | null;
}
