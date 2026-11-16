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
  readonly channel: MappChannel;
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
