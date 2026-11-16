// Linux.do 微应用服务端鉴权与接入类型定义（AISLG-261）。

export type MappChannel = 'production' | 'sandbox';

export interface MappIdentity {
  readonly iss: string;
  readonly sub: string;
  readonly trust_level?: number;
  readonly channel: MappChannel;
  readonly appId: string;
}

export interface MappConfig {
  readonly enabled: boolean;
  readonly issuer: string;
  readonly appId: string;
  /** 主渠道（MAPP_CHANNEL 的第一个） */
  readonly channel: MappChannel;
  /** 接受的渠道集合；缺省只接受主渠道（单元测试直接构造配置时可省略） */
  readonly allowedChannels?: readonly MappChannel[];
  readonly audience: string;
  readonly origins: ReadonlySet<string>;
  readonly identityProvider: 'linuxdo_mapp' | 'linuxdo';
  readonly minTrustLevel: number;
}

export class MappAuthError extends Error {
  readonly code = 'INVALID_PLATFORM_REQUEST';
  constructor(message = 'Invalid platform request') {
    super(message);
    this.name = 'MappAuthError';
  }
}
