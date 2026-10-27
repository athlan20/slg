// 声望与爵位（v76，AISLG-197）的对外协议文档：查询爵位 / 每日俸禄、领取俸禄。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import {
  FAMOUS_CITY_NOBILITY_INDEX,
  NOBILITY_TIERS,
  nobilitySalaryGold,
} from './nobility';

const TIER_TABLE = NOBILITY_TIERS.map((tier) => `${tier.name} ${tier.threshold}`).join(' / ');
const SALARY_TEXT = NOBILITY_TIERS.filter((tier) => tier.index > 0)
  .slice(0, 4)
  .map((tier) => `${tier.name} ${nobilitySalaryGold(tier.index)} 金`)
  .join('、');

/** 示例用的爵位状态（大夫） */
const NOBILITY_VIEW = {
  prestige: 2_350,
  index: 3,
  name: '大夫',
  privilege: '可占领名城；每日俸禄',
  next: { index: 4, name: '公乘', threshold: 6_000 },
  progressPercent: 8,
  salaryGold: nobilitySalaryGold(3),
  claimedToday: false,
  claimable: true,
  lastClaimedAt: null,
  nextClaimAt: '2026-10-27T04:00:00.000Z',
  heroCapBonus: 0,
  canOccupyFamous: true,
} as const;

export const REQUEST_GET_NOBILITY: RequestOpDoc = {
  kind: 'request',
  name: 'GET_NOBILITY',
  title: '查询声望与爵位（v76，AISLG-197）',
  preAuth: false,
  summary:
    `累计声望只增不减：世界地图上的每一场战斗（攻守、输赢、NPC / 玩家 / 黄巾）按歼灭敌军的参考战力 1:1 计；剧本战场的军功按 1 军功 = 1 声望再计一次。竞技场与将星塔不计。` +
    `爵位共 10 级（${TIER_TABLE}），达到门槛自动升级；升到大夫及以上会全服播报。` +
    `大夫（${FAMOUS_CITY_NOBILITY_INDEX}）起可以占领名城（之前只能打外围与掠夺）；五大夫 / 列侯各让普通武将上限 +1。` +
    `每日俸禄（金币 = 爵位序号 × 200 × 全局时间缩放，当前示例 ${SALARY_TEXT}）在北京时间每天 0 点后领一次，用 CLAIM_NOBILITY_SALARY。` +
    `声威与爵位随赛季重置；上一季的最高爵位随名人堂留存。`,
  requestFields: [],
  dataFields: [
    { name: 'prestige', type: 'number', desc: '累计声望。' },
    { name: 'index', type: 'number', desc: '爵位序号（0 = 平民）。' },
    { name: 'name', type: 'string', desc: '爵位名称。' },
    { name: 'privilege', type: 'string', desc: '该爵位特权说明。' },
    { name: 'next', type: 'object | null', desc: '下一级爵位 { index, name, threshold }；已到「王」为 null。' },
    { name: 'progressPercent', type: 'number', desc: '距离下一级的进度（0..100；满级 100）。' },
    { name: 'salaryGold', type: 'number', desc: '每日俸禄金额（金币；平民 0；已按全局时间缩放折算）。' },
    { name: 'claimedToday', type: 'boolean', desc: '今日（北京日）是否已领。' },
    { name: 'claimable', type: 'boolean', desc: '现在是否可以领。' },
    { name: 'lastClaimedAt', type: 'string | null', desc: '最近一次领取时刻；从未领过为 null。' },
    { name: 'nextClaimAt', type: 'string', desc: '下次可领时刻（今日已领 = 明日 0 点北京时间；否则为现在）。' },
    { name: 'heroCapBonus', type: 'number', desc: '普通武将上限加成（五大夫 +1、列侯再 +1）。' },
    { name: 'canOccupyFamous', type: 'boolean', desc: '能否占领名城（爵位 ≥ 大夫）。' },
  ],
  errors: [],
  examples: [
    {
      caption: '大夫：今天还能领俸禄，距公乘还差 3650 声望',
      request: { op: Op.GET_NOBILITY, seq: 40, data: {} },
      responses: [{ op: Op.GET_NOBILITY, seq: 40, ok: true, data: NOBILITY_VIEW }],
    },
  ],
  agentNote:
    '声望是长期累积线：能打就打，不用刻意刷。打名城前先确认 canOccupyFamous；否则先打 NPC 城 / 野地攒到 2000 声望。俸禄每天记得领（claimable 为 true 时），金额随爵位提高。',
};

export const REQUEST_CLAIM_NOBILITY_SALARY: RequestOpDoc = {
  kind: 'request',
  name: 'CLAIM_NOBILITY_SALARY',
  title: '领取每日爵位俸禄（v76，AISLG-197）',
  preAuth: false,
  summary:
    '按北京日领取一次爵位俸禄（金币），直接加到主城。平民没有俸禄（NOBILITY_SALARY_NONE）；今日已领返回 NOBILITY_SALARY_CLAIMED（附 nextClaimAt）。金额 = 爵位序号 × 200 × 全局时间缩放。',
  requestFields: [],
  dataFields: [
    { name: 'gold', type: 'number', desc: '本次领取的金币。' },
    { name: 'index', type: 'number', desc: '领取后的爵位序号。' },
    { name: 'name', type: 'string', desc: '领取后的爵位名称。' },
    { name: 'prestige', type: 'number', desc: '领取后的累计声望。' },
    { name: 'claimedAt', type: 'string', desc: '领取时刻（ISO 8601）。' },
  ],
  errors: ['NOBILITY_SALARY_NONE', 'NOBILITY_SALARY_CLAIMED'],
  examples: [
    {
      caption: '大夫领取 3 万金（示例按 50 倍缩放）',
      request: { op: Op.CLAIM_NOBILITY_SALARY, seq: 41, data: {} },
      responses: [
        {
          op: Op.CLAIM_NOBILITY_SALARY,
          seq: 41,
          ok: true,
          data: { gold: nobilitySalaryGold(3), index: 3, name: '大夫', prestige: 2_350, claimedAt: '2026-10-27T04:00:00.000Z' },
        },
      ],
    },
  ],
  agentNote: '每天上线先领一次（幂等：重复领只会返回已领）。金币直接进主城，可用于建造 / 征兵 / 俸禄。',
};