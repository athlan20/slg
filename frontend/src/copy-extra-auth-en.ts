// EXTRA_AUTH 的英文孪生（AISLG-137）：结构必须与中文一致（satisfies 校验漏译）。

import { EXTRA_AUTH } from './copy-extra-auth';

export const EXTRA_AUTH_EN = {
  sidebar: {
    avatarFallback: 'C',
  },
  bottomBar: {
    queued: 'Queued',
  },
} satisfies typeof EXTRA_AUTH;
