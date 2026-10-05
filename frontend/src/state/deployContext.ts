// 在外部队上限上下文（v30 AISLG-80）：世界地图视图把当前城的 city.deploy 提供给下层的出征 / 调兵 /
// 运输 / 截击 / 侦察表单，达到上限时表单直接禁用并提示，不必逐层传参。权威判定在服务端（DEPLOY_LIMIT）。

import { createContext, useContext } from 'react';

export interface DeployState {
  count: number;
  limit: number;
}

export const DeployContext = createContext<DeployState | null>(null);

/** 达到上限返回人读提示（表单禁用原因）；未达上限 / 未知返回 null */
export function useDeployBlockedText(format: (limit: number) => string): string | null {
  const deploy = useContext(DeployContext);
  return deploy !== null && deploy.count >= deploy.limit ? format(deploy.limit) : null;
}
