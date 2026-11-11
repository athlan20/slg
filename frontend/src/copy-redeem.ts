// 兑换码文案（AISLG-253，v109）：道具商店里的「兑换码」入口、面板输入与提交、成功摘要与各错误码提示。
// 英文孪生见 copy-redeem-en.ts。码的规范化与校验都在服务端（大小写、空格、横线都不敏感），前端只负责原样发送；
// 奖励数量以服务端返回的 rewards 为准，这里只负责拼成一句话。

export const REDEEM_COPY = {
  entry: '兑换码',
  title: '兑换码',
  backToShop: '返回商店',
  placeholder: '输入兑换码',
  submit: '兑换',
  submitting: '正在兑换…',
  /** 面板里的一行小字：码从哪来、怎么输（没有淘宝入口的环境用这一句） */
  hint: '从店铺或活动获得的券号；不区分大小写，可以带横线。',
  /** 配了淘宝入口（PUBLIC_TAOBAO_URL）时换成这一句：券号从淘宝订单里看 */
  hintTaobao: '券号在淘宝订单里查看；不区分大小写，可以带横线。',
  /** 成功摘要的前缀，后面接「元宝 +500、迁城令 ×2」 */
  success: (rewards: string) => `兑换成功：${rewards}`,
  rewardIngot: (amount: number) => `元宝 +${amount}`,
  rewardItem: (name: string, count: number) => `${name} ×${count}`,
  /** 奖励之间的分隔（中文顿号） */
  rewardJoiner: '、',
  errors: {
    /** 码不存在（含格式不对、字符集外的字符） */
    CODE_INVALID: '没有这个兑换码，请检查是不是输错了',
    CODE_EXPIRED: '这个兑换码已经过期了',
    CODE_USED: '这个兑换码已经被使用过了',
    CODE_BATCH_CLAIMED: '这一批福利你已经领过了，同批次的其它码可以给其他玩家',
    CODE_EXHAUSTED: '这个兑换码已经被领完了',
    /** 输错次数太多：分钟数已向上取整、至少 1 分钟 */
    CODE_RATE_LIMITED: (minutes: number) => `输错次数太多了，请 ${minutes} 分钟后再试`,
    /** 背包里某道具已满：整次兑换回滚，券号没有作废 */
    ITEM_STACK_FULL: (name: string, canGrant: number, stackMax: number) =>
      canGrant > 0
        ? `背包里的${name}最多还能收 ${canGrant} 张（上限 ${stackMax} 张）。先用掉一些再来兑换，券号没有作废。`
        : `背包里的${name}已经满了（上限 ${stackMax} 张）。先用掉一些再来兑换，券号没有作废。`,
    INVALID_PARAMS: '兑换码格式不对，请检查后重试',
    fallback: '兑换失败，请稍后再试',
  },
};