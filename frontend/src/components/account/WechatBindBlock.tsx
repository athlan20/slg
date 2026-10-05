// 账号设置 · 绑定微信：显示是否已绑定；未绑定时点按钮弹出 bind 用途的二维码（扫码、手机确认后刷新绑定状态）。
// 服务端没配置微信凭证（/auth/config 的 wechatEnabled=false）时整块不渲染（v45 起与 Google / GitHub 块同规则）。

import { useCallback, useState } from 'react';
import { useGame } from '../../state/GameContext';
import { useWechatQr, type WxQrConfirmed } from '../../state/useWechatQr';
import { useAuthConfig } from '../../state/useAuthConfig';
import { WECHAT_COPY } from '../../copy-wechat';
import { WechatQrView } from '../wechat/WechatQrView';

export function WechatBindBlock() {
  const { session } = useGame();
  const { config } = useAuthConfig();
  const bound = session.agent?.wechatBound ?? false;
  const [binding, setBinding] = useState(false);
  const { security } = session;

  const getClient = useCallback(() => session.connectForWechat(), [session.connectForWechat]);
  const onConfirmed = useCallback(
    (result: WxQrConfirmed) => {
      if (result.bound) {
        void security.refresh();
        // 留一小会儿让「绑定成功」可见，再收起二维码
        window.setTimeout(() => setBinding(false), 1500);
      }
    },
    [security],
  );
  const { phase, refresh } = useWechatQr({ purpose: 'bind', active: binding && !bound, getClient, onConfirmed });

  if (!(config?.wechatEnabled ?? false)) {
    return null;
  }

  return (
    <section role="账号设置-绑定微信" className="flex flex-col gap-1.5 rounded border border-line-soft bg-panel-2 p-2.5">
      <div className="flex items-baseline gap-2">
        <h4 className="text-[13px] font-semibold">{WECHAT_COPY.bind.title}</h4>
        <span role="账号设置-绑定微信-状态" className={`ml-auto text-[12px] ${bound ? 'text-st-online' : 'text-faint'}`}>
          {bound ? WECHAT_COPY.bind.bound : WECHAT_COPY.bind.unbound}
        </span>
      </div>
      <p className="text-[12px] text-faint">{WECHAT_COPY.bind.desc}</p>
      {!bound && !binding ? (
        <button type="button" role="账号设置-绑定微信-开始按钮" className="btn self-start px-3 py-1" onClick={() => setBinding(true)}>
          {WECHAT_COPY.bind.start}
        </button>
      ) : null}
      {!bound && binding ? (
        <>
          <WechatQrView purpose="bind" phase={phase} onRefresh={refresh} />
          {phase.kind !== 'done' ? (
            <button type="button" role="账号设置-绑定微信-取消按钮" className="btn self-center px-3 py-1" onClick={() => setBinding(false)}>
              {WECHAT_COPY.bind.cancel}
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
