// 名将忠诚度与被俘的协议文档（RANSOM_HERO op 151，v94，AISLG-228）。数值直引 hero-loyalty.ts 的真实常量。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import {
  CAPTIVE_HOURS,
  CAPTURE_BASE_PERCENT,
  CAPTURE_LIMIT_DAYS,
  CAPTURE_PER_MISSING_PERCENT,
  LOYALTY_ARREARS_PER_HOUR,
  LOYALTY_DECAY_PER_PERIOD,
  LOYALTY_DECAY_PERIOD_HOURS,
  LOYALTY_GIFT,
  LOYALTY_RANSOM_DROP,
  LOYALTY_WARN_LINE,
  RANSOM_GOLD_PER_LEVEL,
  RANSOM_TAKER_PERCENT,
} from './hero-loyalty';

/** 忠诚度与被俘规则说明（供 GET_HEROES / 相关 op 引用，数值全部来自常量） */
export const LOYALTY_RULES_DESC = `名将忠诚度（只有 29 位在野名将有，范围 0..100，招揽时为 100；普通将、名城与黄巾名将的 loyalty 为 null，不受影响）：每 ${LOYALTY_DECAY_PERIOD_HOURS} 小时（基准，随时间缩放）自然下降 ${LOYALTY_DECAY_PER_PERIOD}，从招揽时刻起各自结算；赏赐（GIFT_HERO）每次 +${LOYALTY_GIFT}（上限 100）；欠饷期间每小时（基准）额外 −${LOYALTY_ARREARS_PER_HOUR}。忠诚度降到 ${LOYALTY_WARN_LINE} 及以下发一次 hero_loyalty_low 事件，回到 ${LOYALTY_WARN_LINE} 以上后下次再提醒。忠诚度为 0 时名将下野（行军 / 历练中则等回城或历练结束后再下野）。下野 = 解雇的同一删除路径：武将消失、全服归属清除、城守撤掉、该名将的结交进度全部清空（好感从头算），原野地不变，所有玩家可按现有规则重新结交与招揽；已获得的结交资格保留。全服播报 hero_left（不带坐标）。`;

/** 被俘规则说明：只在玩家打玩家时判定 */
export const CAPTURE_RULES_DESC = `被俘（只在玩家打玩家时判定；打 NPC / 黄巾 / 竞技场 / 将星塔 / 战场都不判定）：进攻玩家城或野地失败 → 随队名将；守城失败 → 该城城守名将。被俘概率 = ${CAPTURE_BASE_PERCENT}% + (100 − 忠诚度) × ${CAPTURE_PER_MISSING_PERCENT}%（忠诚度 100 为 ${CAPTURE_BASE_PERCENT}%，0 为 ${CAPTURE_BASE_PERCENT + 100 * CAPTURE_PER_MISSING_PERCENT}%）。每个账号 ${CAPTURE_LIMIT_DAYS} 天内最多被俘 1 名，不管赎没赎回。被俘后囚禁 ${CAPTIVE_HOURS} 小时：不能出征 / 侦察 / 任城守 / 历练 / 赏赐 / 解雇 / 加点 / 洗点 / 施计（HERO_CAPTURED），不扣俸禄、忠诚度不变，城守职位撤掉。主人 ${CAPTIVE_HOURS} 小时内可 RANSOM_HERO 赎回；赎金 = ${RANSOM_GOLD_PER_LEVEL} × 名将等级（从主城扣全额），胜方主城收 ${RANSOM_TAKER_PERCENT}%（向下取整），另一半销毁。赎回后名将立刻回归，忠诚度 −${LOYALTY_RANSOM_DROP}（最低 1）。超时未赎回则名将下野，胜方获得这名将的结交资格（已有资格不重复发）。被俘与赎回分别写 hero_captured / hero_ransomed 事件（主人与胜方各一条），被俘另有全服播报。`;

export const REQUEST_RANSOM_HERO: RequestOpDoc = {
  kind: 'request',
  name: 'RANSOM_HERO',
  title: '赎回被俘名将（v94，AISLG-228）',
  preAuth: false,
  summary: `只有名将的主人能赎回处于囚禁中的名将（GET_HEROES 的 heroes[].captive 非 null）。赎金 = ${RANSOM_GOLD_PER_LEVEL} × 名将等级，从主人主城扣全额；金币不足返回 INSUFFICIENT_RESOURCES（附 city）且不改任何数据。成功后胜方主城收 ${RANSOM_TAKER_PERCENT}%（向下取整），另一半销毁；名将立刻回归，忠诚度 −${LOYALTY_RANSOM_DROP}（最低 1）。囚禁已到期（captive.capturedUntil 已过）时返回 HERO_NOT_CAPTURED，名将即将或已经下野。\n\n${CAPTURE_RULES_DESC}\n\n${LOYALTY_RULES_DESC}`,
  requestFields: [{ name: 'heroId', type: 'string', desc: '必填。被俘名将的 id（GET_HEROES 的 heroes[].id）。' }],
  dataFields: [
    { name: 'hero', type: 'object', desc: '赎回后的武将视图（captive 为 null，loyalty 已减 20 最低 1）。' },
    { name: 'ransom', type: 'object', desc: '{ cost 支付的赎金, taxShare 胜方主城收到的部分, destroyed 销毁的部分 }。' },
  ],
  errors: ['INVALID_PARAMS', 'HERO_NOT_FOUND', 'HERO_NOT_CAPTURED', 'INSUFFICIENT_RESOURCES'],
  examples: [
    {
      caption: '赎回一名被俘的名将（赎金 40000，主城金币足够）',
      request: { op: Op.RANSOM_HERO, seq: 91, data: { heroId: '5c1e7a2b-9d3f-4b6a-8e10-2f7c9a4d6b35' } },
      responses: [
        {
          op: Op.RANSOM_HERO,
          seq: 91,
          ok: true,
          data: {
            hero: { id: '5c1e7a2b-9d3f-4b6a-8e10-2f7c9a4d6b35', name: '关羽', famous: true, level: 20, loyalty: 80, captive: null },
            ransom: { cost: 40000, taxShare: 20000, destroyed: 20000 },
          },
        },
      ],
    },
  ],
  agentNote: `被俘的名将 captive.capturedUntil 前必须赎，否则下野；赎金 = ${RANSOM_GOLD_PER_LEVEL} × 等级，提前在主城留足金币。下野后名将回到原野地，可以按结交 → 好感满 100 → 招揽的流程重新争取（前主人没有特权）。`,
};
