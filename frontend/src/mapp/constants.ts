import { Op } from '../api/protocol';

// Linux.do 微应用常量与配置约定（AISLG-261）。

/** 微应用登录操作码（对应协议 v113 的 Op.MAPP_LOGIN） */
export const OP_MAPP_LOGIN = Op.MAPP_LOGIN;

/** 微应用业务错误码 */
export const MAPP_ERROR_CODES = {
  /** 服务端未开启微应用（MAPP_ENABLED 关闭）或连接未通过平台令牌握手 */
  MAPP_UNAVAILABLE: 'MAPP_UNAVAILABLE',
  /** 论坛信任等级不足 */
  MAPP_TRUST_LEVEL_LOW: 'MAPP_TRUST_LEVEL_LOW',
  /** 握手/会话令牌无效或缺失 */
  MAPP_TOKEN_INVALID: 'MAPP_TOKEN_INVALID',
} as const;

/**
 * 标记字符串：用于构建隔离验证。
 * 普通构建产物中严禁出现该标记，微应用产物中必须包含该标记。
 */
export const MAPP_BUNDLE_MARKER = '__SLG_LINUXDO_MAPP_BUNDLE_MARKER_20261116__';

/** 微应用启动时预先同步读取到内存的本地存储键 */
export const KNOWN_STORAGE_KEYS = [
  'slg-city-theme',
  'slg-lang',
  'slg.chat.collapsed',
  'slg.chat.tab',
  'slg_seen_event_id',
  'slg.map.zoom',
  'slg.lastUsername',
  'slg.sessionToken',
];
