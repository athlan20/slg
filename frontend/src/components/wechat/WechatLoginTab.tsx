// 登录面板「微信扫码登录」分页：进入分页就生成码；收到 confirmed 后把会话令牌交给上层走令牌登录。

import { useCallback } from 'react';
import { useWechatQr, type WxQrConfirmed } from '../../state/useWechatQr';
import { WECHAT_COPY } from '../../copy-wechat';
import type { ApiClient } from '../../api/client';
import { WechatQrView } from './WechatQrView';

interface WechatLoginTabProps {
  /** 本分页是否可见（切走时作废当前码，切回时重新生成） */
  active: boolean;
  /** 返回已连接（未登录）的客户端 */
  connect: () => Promise<ApiClient>;
  onToken: (sessionToken: string) => void;
}

export function WechatLoginTab({ active, connect, onToken }: WechatLoginTabProps) {
  const onConfirmed = useCallback(
    (result: WxQrConfirmed) => {
      if (result.sessionToken) {
        onToken(result.sessionToken);
      }
    },
    [onToken],
  );
  const { phase, refresh } = useWechatQr({ purpose: 'login', active, getClient: connect, onConfirmed });
  return (
    <div role="账号面板-微信扫码" className="flex flex-col items-center">
      <WechatQrView purpose="login" phase={phase} onRefresh={refresh} />
      <p role="账号面板-微信扫码-说明" className="mt-1 max-w-[320px] text-center text-[11.5px] text-faint">
        {WECHAT_COPY.qr.newAccountNote}
      </p>
    </div>
  );
}
