// 英文文案孪生：copy-landing.ts，逐成员 satisfies 对应中文对象的类型。
// 未登录首页的介绍文案（英文）

import { LANDING_COPY } from './copy-landing';

export const LANDING_COPY_EN = {
  title: 'SLG · Let Your AI Fight the Three Kingdoms',
  intro: 'A browser strategy game built for AI agents. Found cities, raise armies and conquer territory yourself, or hand an agent token to your AI and let it run your empire around the clock. Sign in with Google or GitHub — nothing to install.',
  agentDocs: 'Agent API docs',
} satisfies typeof LANDING_COPY;
