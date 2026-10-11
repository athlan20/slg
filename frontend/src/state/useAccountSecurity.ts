// 账号安全相关会话切片：Agent 令牌（v46 永久令牌：查看 / 重置）、绑定 Google（v44）、
// 发起 GitHub 绑定授权（v45）、修改昵称（v52 AISLG-142）与 GET_AGENT_INFO 重拉。
// 绑定状态随 GET_AGENT_INFO 下发；永久令牌不进 GET_AGENT_INFO（那条协议 Agent 也能调），
// 专门走 GET_AGENT_TOKEN / RESET_AGENT_TOKEN。单独成文件：useGameSession.ts 已经过长，
// 账号类动作不再往里堆。

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { ApiClient } from '../api/client';
import { Op } from '../api/protocol';
import type { AgentInfoView } from '../api/protocol';
import type { AgentTokenData } from '../api/protocol-wechat';
import { githubErrorText, googleErrorText, nicknameErrorText } from '../api/errorText';
import { getCopy } from '../i18n/bundle';
import type { AccountInfo } from './useGameSession';

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
  /** 修改账号昵称（v52 AISLG-142）：成功返回 null（account.username 已按响应更新），失败返回人读提示 */
  setNickname: (nickname: string) => Promise<string | null>;
}

interface Options {
  clientRef: MutableRefObject<ApiClient | null>;
  setAgent: Dispatch<SetStateAction<AgentInfoView | null>>;
  /** 改昵称成功后同步会话里的账号名（v52） */
  setAccount: Dispatch<SetStateAction<AccountInfo | null>>;
}

export function useAccountSecurity({ clientRef, setAgent, setAccount }: Options): AccountSecurity {
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
      const { GOOGLE_COPY } = getCopy();
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
    const { GITHUB_COPY } = getCopy();
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

  /** 修改昵称（v52）：发起连接按响应更新账号名；同账号其他连接走 PUSH_ACCOUNT_STATE */
  const setNickname = useCallback(
    async (nickname: string): Promise<string | null> => {
      const { WECHAT_COPY } = getCopy();
      const client = clientRef.current;
      if (!client?.connected) {
        return WECHAT_COPY.errors.connect;
      }
      try {
        const res = await client.request(Op.SET_NICKNAME, { nickname });
        if (!res.ok) {
          return nicknameErrorText(res.error?.code, res.error?.message);
        }
        const username = res.data?.username;
        if (typeof username === 'string') {
          setAccount((prev) => (prev ? { ...prev, username } : prev));
        }
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : WECHAT_COPY.nickname.fallback;
      }
    },
    [clientRef, setAccount],
  );

  return { refresh, getAgentToken, resetAgentToken, bindGoogle, startGithubBind, setNickname };
}
