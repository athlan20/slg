// 账号设置弹窗（侧栏账号菜单进入）：绑定微信 / 绑定 Google / 绑定 GitHub + Agent 令牌几块。
// 内容可能较高（二维码、令牌列表），内部自行滚动。

import { useEffect } from 'react';
import { useGame } from '../../state/GameContext';
import { useCopy } from '../../i18n/bundle';
import { Modal } from '../ui/Modal';
import { AgentTokenBlock } from './AgentTokenBlock';
import { GithubBindBlock } from './GithubBindBlock';
import { GoogleBindBlock } from './GoogleBindBlock';
import { WechatBindBlock } from './WechatBindBlock';

export function AccountSettingsDialog({ onClose }: { onClose: () => void }) {
  const copy = useCopy();
  const { WECHAT_COPY } = copy;
  const { session } = useGame();
  const { refresh } = session.security;
  // 打开时对齐一次：令牌清单与绑定状态以服务端为准（别的连接可能刚改过）
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Modal role="账号设置弹窗" title={WECHAT_COPY.settings.title} accent="none" onClose={onClose}>
      <div role="账号设置弹窗-内容" className="flex min-h-0 flex-col gap-2 overflow-y-auto">
        <WechatBindBlock />
        <GoogleBindBlock />
        <GithubBindBlock />
        <AgentTokenBlock />
      </div>
    </Modal>
  );
}
