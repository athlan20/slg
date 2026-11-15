// 对旧服务端与异常响应保持保守默认值：不暴露未配置的第三方入口。
export interface AuthConfig {
  googleClientId: string | null;
  wechatEnabled: boolean;
  githubEnabled: boolean;
  linuxdoEnabled: boolean;
  passwordLogin: boolean;
}

export const FALLBACK: AuthConfig = {
  googleClientId: null, wechatEnabled: false, githubEnabled: false, linuxdoEnabled: false, passwordLogin: true,
};

export function parseAuthConfig(value: unknown): AuthConfig {
  const body = value && typeof value === 'object' ? value as Partial<AuthConfig> : {};
  return {
    googleClientId: typeof body.googleClientId === 'string' && body.googleClientId ? body.googleClientId : null,
    wechatEnabled: body.wechatEnabled === true,
    githubEnabled: body.githubEnabled === true,
    linuxdoEnabled: body.linuxdoEnabled === true,
    passwordLogin: body.passwordLogin !== false,
  };
}
