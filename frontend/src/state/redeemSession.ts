// 兑换码切片（v109，AISLG-253）：道具弹窗里「兑换码」面板的开关、输入原文、REDEEM_CODE（op 156）提交与结果 / 错误。
// 码原样发送：不 trim、不转大小写、不校验格式（规范化由服务端负责，见 backend/common/src/redeem-code.ts），
// 前端只在输入为空时不提交、并限制输入长度（够带空格与横线的码，留出富余）。
// 成功响应自带全量背包与元宝余额，直接写回 useCityList（applyItems）；其他在线连接走 PUSH_ACCOUNT_STATE。
// 只有玩家连接有这个入口：网页端固定以玩家身份登录（见 useGameSession），Agent 令牌不经本界面。

import { useCallback, useMemo, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op, type ErrorCode, type RedeemCodeResponseData, type RedeemErrorDetail } from '../api/protocol';
import { redeemErrorText, redeemRewardText } from '../api/redeemText';
import { getCopy } from '../i18n/bundle';
import type { CityList } from './useCityList';

/** 输入框长度上限：16 位码带横线是 19 字符，留出空格 / 复制粘贴的富余，但不接受整段文本 */
export const REDEEM_CODE_MAX_LENGTH = 40;

export interface RedeemSession {
  /** 兑换码面板是否替换背包 / 商店列表 */
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /** 输入框原文（原样发给服务端） */
  code: string;
  setCode: (text: string) => void;
  busy: boolean;
  /** 成功后领到的内容（「元宝 +500、迁城令 ×2」）；失败为 null */
  result: string | null;
  /** 失败提示；成功为 null */
  error: string | null;
  submit: () => Promise<void>;
  clear: () => void;
}

export interface RedeemSessionOptions {
  /** 写回背包与元宝余额（useCityList.applyItems） */
  applyItems: CityList['applyItems'];
}

export function useRedeemSession(clientRef: { current: ApiClient | null }, options: RedeemSessionOptions): RedeemSession {
  const { applyItems } = options;
  const [panelOpen, setPanelOpen] = useState(false);
  const [code, setCodeState] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setCode = useCallback((text: string) => {
    setCodeState(text);
    // 用户开始改码：上一轮的结果 / 错误不再对应当前输入
    setError(null);
    setResult(null);
  }, []);

  const openPanel = useCallback(() => {
    setPanelOpen(true);
    setError(null);
    setResult(null);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setError(null);
    setResult(null);
  }, []);

  const submit = useCallback(async () => {
    const { REDEEM_COPY } = getCopy();
    const client = clientRef.current;
    if (!client?.connected) {
      setError(REDEEM_COPY.errors.fallback);
      return;
    }
    // 空输入不提交（不做码的格式校验：只判空，避免把空白串当码发出去）
    if (code.trim().length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await client.request(Op.REDEEM_CODE, { code });
      if (!res.ok) {
        setError(redeemErrorText(res.error?.code as ErrorCode | undefined, res.data as RedeemErrorDetail | undefined, res.error?.message));
        return;
      }
      const data = res.data as unknown as RedeemCodeResponseData;
      applyItems({ items: data.items, ingot: data.ingot });
      setResult(REDEEM_COPY.success(redeemRewardText(data.rewards)));
      // 成功后清空输入框，避免重复提交同一个码
      setCodeState('');
    } catch (err) {
      setError(err instanceof Error ? err.message : REDEEM_COPY.errors.fallback);
    } finally {
      setBusy(false);
    }
  }, [clientRef, code, applyItems]);

  const clear = useCallback(() => {
    setPanelOpen(false);
    setCodeState('');
    setBusy(false);
    setResult(null);
    setError(null);
  }, []);

  return useMemo(
    () => ({ panelOpen, openPanel, closePanel, code, setCode, busy, result, error, submit, clear }),
    [panelOpen, openPanel, closePanel, code, setCode, busy, result, error, submit, clear],
  );
}