// 账号安全相关会话切片：Agent 令牌（v46 永久令牌：查看 / 重置）、绑定 Google（v44）、
// 发起 GitHub 绑定授权（v45）与 GET_AGENT_INFO 重拉。绑定状态随 GET_AGENT_INFO 下发；
// 永久令牌不进 GET_AGENT_INFO（那条协议 Agent 也能调），专门走 GET_AGENT_TOKEN / RESET_AGENT_TOKEN。
// 单独成文件：useGameSession.ts 已经过长，账号类动作不再往里堆。

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ApiClient } from '../api/client';
import { Op } from '../api/protocol';
import type { AgentInfoView } from '../api/protocol';
import type { AgentTokenData } from '../api/protocol-wechat';
import { githubErrorText, googleErrorText } from '../api/errorText';
import { GITHUB_COPY } from '../copy-github';
import { GOOGLE_COPY } from '../copy-google';

export interface AccountSecurity {
  /** 重拉 agent 信息（绑定状态） */
  refresh: () => Promise<void>;
  /** 查看本账号永久 Agent 令牌（v46；服务端没有时自动补生成）；失败返回 null */
  getAgentToken: () => Promise<AgentTokenData | null>;
  /** 重置永久 Agent 令牌（v46；旧令牌立即失效、用它在线的连接被断开）；失败返回 null */
  resetAgentToken: () => Promise<AgentTokenData | null>;
  /** 绑定 Google（v44）：credential 为 GSI 回调给的 ID Token；成功返回 null，失败返回人读提示 */
  bindGoogle: (credential: string) => Promise<string | null>;
  /** 发起 GitHub 绑定授权（v45）：成功拿到授权地址返回 null 并由调用方整页跳转；失败返回人读提示 */
  startGithubBind: () => Promise<string | null>;
}

interface Options {
  clientRef: MutableRefObject<ApiClient | null>;
  setAgent: Dispatch<SetStateAction<AgentInfoView | null>>;
}

export function useAccountSecurity({ clientRef, setAgent }: Options): AccountSecurity {
  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    const res = await client.request(Op.GET_AGENT_INFO);
    if (res.ok && res.data) {
      setAgent(res.data as unknown as AgentInfoView);
    }
  }, [clientRef, setAgent]);

  const getAgentToken = useCallback(async (): Promise<AgentTokenData | null> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return null;
    }
    try {
      const res = await client.request(Op.GET_AGENT_TOKEN);
      return res.ok ? (res.data as unknown as AgentTokenData) : null;
    } catch {
      return null;
    }
  }, [clientRef]);

  const resetAgentToken = useCallback(async (): Promise<AgentTokenData | null> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return null;
    }
    try {
      const res = await client.request(Op.RESET_AGENT_TOKEN);
      return res.ok ? (res.data as unknown as AgentTokenData) : null;
    } catch {
      return null;
    }
  }, [clientRef]);

  const bindGoogle = useCallback(
    async (credential: string): Promise<string | null> => {
      const client = clientRef.current;
      if (!client?.connected) {
        return GOOGLE_COPY.errors.connect;
      }
      try {
        const res = await client.request(Op.GOOGLE_BIND, { credential });
        if (!res.ok) {
          return googleErrorText(res.error?.code, res.error?.message);
        }
        await refresh();
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : GOOGLE_COPY.errors.fallback;
      }
    },
    [clientRef, refresh],
  );

  /** GitHub 绑定授权（v45）：在当前已登录连接上发 GITHUB_AUTH_START，拿到授权地址交给调用方跳转 */
  const startGithubBind = useCallback(async (): Promise<string | null> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return GITHUB_COPY.errors.connect;
    }
    try {
      const res = await client.request(Op.GITHUB_AUTH_START, { purpose: 'bind' });
      if (!res.ok) {
        return githubErrorText(res.error?.code, res.error?.message);
      }
      const authUrl = res.data?.authUrl;
      if (typeof authUrl !== 'string') {
        return GITHUB_COPY.errors.fallback;
      }
      window.location.href = authUrl;
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : GITHUB_COPY.errors.fallback;
    }
  }, [clientRef]);

  return { refresh, getAgentToken, resetAgentToken, bindGoogle, startGithubBind };
}
