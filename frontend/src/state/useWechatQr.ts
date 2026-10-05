// 微信扫码二维码会话（v43，docs/wechat-qr-login.md「网页前端」）：登录与绑定共用。
// 流程：WX_QR_CREATE 拿码 → 收 PUSH_WX_QR_STATUS（scanned 提示在手机上确认；confirmed 交给调用方；
// canceled / expired 自动换码，连续自动重试最多 3 次，之后显示「点击刷新」）。
// 码的状态只存在于创建它的那条连接上：连接由调用方提供（登录前是尚未登录的连接，绑定时是当前已登录连接）。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op } from '../api/protocol';
import type { PushFrame } from '../api/protocol';
import type { WxQrCreateData, WxQrPurpose, WxQrStatusPushData } from '../api/protocol-wechat';
import { wechatErrorText } from '../api/errorText';
import { getCopy } from '../i18n/bundle';

/** 连续自动换码的次数上限（扫码成功或手动刷新后清零） */
export const MAX_AUTO_RETRIES = 3;

export type WxQrPhase =
  | { kind: 'idle' }
  | { kind: 'loading'; retrying: boolean }
  | { kind: 'ready'; qrImage: string; expiresAt: number }
  | { kind: 'scanned' }
  | { kind: 'done' }
  /** 自动重试用尽 / 生成失败：显示提示与「点击刷新」 */
  | { kind: 'stale'; message: string };

export interface WxQrConfirmed {
  sessionToken?: string;
  bound?: boolean;
}

interface Options {
  purpose: WxQrPurpose;
  /** 为 false 时不生成码（如登录面板切到别的分页）；变回 true 时重新生成 */
  active: boolean;
  /** 返回已连接的 ApiClient（登录前负责建立连接） */
  getClient: () => Promise<ApiClient>;
  onConfirmed: (result: WxQrConfirmed) => void;
}

export function useWechatQr({ purpose, active, getClient, onConfirmed }: Options) {
  const [phase, setPhase] = useState<WxQrPhase>({ kind: 'idle' });
  const ticketRef = useRef<string | null>(null);
  const retriesRef = useRef(0);
  const runRef = useRef(0);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const onConfirmedRef = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  const generateRef = useRef<(auto: boolean) => Promise<void>>(async () => undefined);

  const generate = useCallback(
    async (auto: boolean) => {
      const { WECHAT_COPY } = getCopy();
      const run = ++runRef.current;
      if (!auto) {
        retriesRef.current = 0;
      }
      ticketRef.current = null;
      setPhase({ kind: 'loading', retrying: auto });
      try {
        const client = await getClient();
        if (run !== runRef.current) {
          return;
        }
        unsubscribeRef.current?.();
        unsubscribeRef.current = client.onPush((frame: PushFrame) => {
          if (frame.op !== Op.PUSH_WX_QR_STATUS) {
            return;
          }
          const data = frame.data as unknown as WxQrStatusPushData;
          if (data.ticket !== ticketRef.current || run !== runRef.current) {
            return;
          }
          if (data.status === 'scanned') {
            retriesRef.current = 0;
            setPhase({ kind: 'scanned' });
          } else if (data.status === 'confirmed') {
            ticketRef.current = null;
            setPhase({ kind: 'done' });
            onConfirmedRef.current({ sessionToken: data.sessionToken, bound: data.bound });
          } else if (retriesRef.current < MAX_AUTO_RETRIES) {
            retriesRef.current += 1;
            void generateRef.current(true);
          } else {
            ticketRef.current = null;
            setPhase({ kind: 'stale', message: WECHAT_COPY.qr.refresh });
          }
        });
        const res = await client.request(Op.WX_QR_CREATE, { purpose });
        if (run !== runRef.current) {
          return;
        }
        if (!res.ok) {
          setPhase({ kind: 'stale', message: wechatErrorText(res.error?.code, res.error?.message) });
          return;
        }
        const data = res.data as unknown as WxQrCreateData;
        ticketRef.current = data.ticket;
        setPhase({ kind: 'ready', qrImage: data.qrImage, expiresAt: Date.parse(data.expiresAt) });
      } catch (err) {
        if (run === runRef.current) {
          setPhase({ kind: 'stale', message: err instanceof Error ? err.message : WECHAT_COPY.errors.connect });
        }
      }
    },
    [purpose, getClient],
  );
  generateRef.current = generate;

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    void generate(false);
    return () => {
      // 离开分页 / 卸载：作废在途请求与订阅（服务端的码到期自会清理）
      runRef.current += 1;
      ticketRef.current = null;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      setPhase({ kind: 'idle' });
    };
    // getClient 随会话回调重建时不应重新生成二维码，只在开关与用途变化时重来
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, purpose]);

  const refresh = useCallback(() => void generate(false), [generate]);

  return { phase, refresh };
}
