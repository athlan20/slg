// 组件内联文案集中（AISLG-137）：导航外壳 / 账号 / 登录组件里残余的用户可见中文字面量，
// 集中到这里由 i18n bundle 按界面语言取用；英文孪生见 copy-extra-auth-en.ts。

export const EXTRA_AUTH = {
  /** 侧栏：城池切换按钮的方形头像字（取城名首字，无城时的兜底字） */
  sidebar: {
    avatarFallback: '城',
  },
  /** 底栏时间线：尚未开工条目的占位（与 COPY.status.queued「排队中」文案不同，保持原显示） */
  bottomBar: {
    queued: '排队',
  },
};
