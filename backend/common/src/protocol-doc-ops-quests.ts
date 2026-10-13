// 任务与活动二期/三期（v56，AISLG-200）：主线/支线任务与成就查询领取 + 活动查询领取。
// 本地自建分支新增；条目登记在 protocol-doc-ops.ts 的 OP_DOC。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import { exampleCity } from './protocol-doc-shared';

const REWARD_1 = { gold: 500, wood: 0, food: 0, stone: 0, iron: 0 };
const REWARD_2 = { gold: 1000, wood: 1000, food: 0, stone: 0, iron: 0 };
const REWARD_3 = { gold: 2000, wood: 2000, food: 0, stone: 0, iron: 0 };

/** 任务视图示例（GET_QUESTS 的 data） */
const QUESTS_EXAMPLE = {
  main: {
    currentIndex: 1,
    total: 10,
    steps: [
      { id: 'm1', title: '初入乱世', desc: '完成 1 次建造或升级', reward: REWARD_1, done: true, claimed: true, unlocked: true },
      { id: 'm2', title: '固本培元', desc: '官府升到 3 级', reward: REWARD_2, done: true, claimed: false, unlocked: true },
      { id: 'm3', title: '格物致知', desc: '研究 1 项科技', reward: REWARD_2, done: false, claimed: false, unlocked: false },
    ],
  },
  side: [
    { id: 's_build', title: '大兴土木', desc: '累计建造或升级 10 次', reward: REWARD_3, done: false, claimed: false },
    { id: 's_tech', title: '百家争鸣', desc: '研究 5 项科技', reward: REWARD_3, done: false, claimed: false },
  ],
  achievements: [
    {
      id: 'a_build',
      title: '建造大师',
      desc: '累计建造 / 升级次数',
      value: 12,
      tiers: [
        { tier: 1, threshold: 10, reward: REWARD_2, done: true, claimed: false },
        { tier: 2, threshold: 50, reward: REWARD_3, done: false, claimed: false },
        { tier: 3, threshold: 200, reward: REWARD_3, done: false, claimed: false },
      ],
    },
  ],
};

/** 活动视图示例（GET_ACTIVITIES 的 data.activities） */
const ACTIVITIES_EXAMPLE = [
  {
    id: 'act_launch',
    title: '开服冲刺',
    desc: '开服两周内达成里程碑，领取冲刺奖励',
    daily: false,
    ongoing: true,
    endsAt: '2026-10-27T23:59:59+08:00',
    tiers: [
      { id: 'act_launch:1', title: '建造 20 次', reward: REWARD_3, done: false, claimed: false },
      { id: 'act_launch:2', title: '出征 20 次', reward: { gold: 3000, wood: 0, food: 0, stone: 3000, iron: 0 }, done: false, claimed: false },
    ],
  },
  {
    id: 'act_daily',
    title: '每日活跃',
    desc: '今日完成日常 / 签到攒活跃点',
    daily: true,
    ongoing: true,
    endsAt: null,
    tiers: [
      { id: 'act_daily:3', title: '活跃 3 点', reward: { gold: 800, wood: 0, food: 0, stone: 0, iron: 0 }, done: true, claimed: false },
      { id: 'act_daily:5', title: '活跃 5 点', reward: { gold: 1500, wood: 1500, food: 0, stone: 0, iron: 0 }, done: false, claimed: false },
    ],
  },
];

const QUESTS_SUMMARY =
  '主线任务链（10 环，顺序解锁与领取）、支线任务（并行）与成就（多条 × 3 档，逐档领取）。进度从 events / 建筑等级 / 科技 / 武将 / 签到等既有数据派生，奖励发往主城。';

/** GET_QUESTS（op 90，v56）：查询主线/支线任务与成就 */
export const REQUEST_GET_QUESTS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_QUESTS',
  title: '查询主线/支线任务与成就',
  preAuth: false,
  summary: QUESTS_SUMMARY,
  requestFields: [],
  dataFields: [
    { name: 'main', type: 'object', desc: '主线：{ currentIndex（已领取环数）, total, steps[] }。steps[]：{ id, title, desc, reward, done, claimed, unlocked（前置环是否已领，未解锁不可领） }。' },
    { name: 'side', type: 'array', desc: '支线：{ id, title, desc, reward, done, claimed }。' },
    { name: 'achievements', type: 'array', desc: '成就：{ id, title, desc, value（当前值）, tiers[] }；tiers[]：{ tier, threshold, reward, done, claimed }。' },
  ],
  errors: [],
  examples: [
    {
      caption: '查询任务与成就',
      request: { op: Op.GET_QUESTS, seq: 1 },
      responses: [{ op: Op.GET_QUESTS, seq: 1, ok: true, data: QUESTS_EXAMPLE }],
    },
  ],
  agentNote: '任务 / 成就 id 与条件未来可能调整，请以响应为准，不要硬编码。',
};

/** CLAIM_QUEST（op 91，v56）：领取主线/支线/成就奖励 */
export const REQUEST_CLAIM_QUEST: RequestOpDoc = {
  kind: 'request',
  name: 'CLAIM_QUEST',
  title: '领取任务/成就奖励',
  preAuth: false,
  summary: '领取已完成、未领取的主线 / 支线 / 成就奖励，资源发往主城。条件未达成 / 前置未完成 / 重复领取均返回 INVALID_PARAMS。',
  requestFields: [
    { name: 'kind', type: 'string', desc: '必填。main（主线）/ side（支线）/ achv（成就）。' },
    { name: 'id', type: 'string', desc: '必填。main/side 用其 id（如 m2 / s_build）；achv 用「成就 id:档位序号」（如 a_build:0，序号从 0 起）。' },
  ],
  dataFields: [
    { name: 'quests', type: 'object', desc: '领取后的任务与成就状态（结构同 GET_QUESTS）。' },
    { name: 'granted', type: 'object', desc: '本次发放的资源（{ gold, wood, food, stone, iron }）。' },
    { name: 'city', type: 'object', desc: '发奖后的主城状态（字段同 GET_STATE）。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '领取主线第 2 环',
      request: { op: Op.CLAIM_QUEST, seq: 1, data: { kind: 'main', id: 'm2' } },
      responses: [
        {
          op: Op.CLAIM_QUEST,
          seq: 1,
          ok: true,
          data: {
            quests: { ...QUESTS_EXAMPLE, main: { ...QUESTS_EXAMPLE.main, currentIndex: 2 } },
            granted: REWARD_2,
            city: exampleCity(),
          },
        },
      ],
    },
    {
      caption: '条件未达成 / 前置未完成',
      request: { op: Op.CLAIM_QUEST, seq: 2, data: { kind: 'main', id: 'm3' } },
      responses: [{ op: Op.CLAIM_QUEST, seq: 2, ok: false, error: { code: 'INVALID_PARAMS', message: '任务未完成或今日已领取' } }],
    },
  ],
};

const ACTIVITIES_SUMMARY =
  '活动：开服冲刺（限时，按活动窗口内的事件达成里程碑，每档一次）与每日活跃（今日完成的日常任务数 + 是否签到 = 活跃点，每档每天一次）。奖励发往主城。';

/** GET_ACTIVITIES（op 92，v56）：查询活动状态 */
export const REQUEST_GET_ACTIVITIES: RequestOpDoc = {
  kind: 'request',
  name: 'GET_ACTIVITIES',
  title: '查询活动状态',
  preAuth: false,
  summary: ACTIVITIES_SUMMARY,
  requestFields: [],
  dataFields: [
    { name: 'activities', type: 'array', desc: '{ id, title, desc, daily（true=每日活跃，false=限时活动）, ongoing（是否在可领期）, endsAt（限时活动截止 ISO，每日活动为 null）, tiers[] }。tiers[]：{ id, title, reward, done, claimed }。' },
  ],
  errors: [],
  examples: [
    {
      caption: '查询活动',
      request: { op: Op.GET_ACTIVITIES, seq: 1 },
      responses: [{ op: Op.GET_ACTIVITIES, seq: 1, ok: true, data: { activities: ACTIVITIES_EXAMPLE } }],
    },
  ],
};

/** CLAIM_ACTIVITY（op 93，v56）：领取活动奖励 */
export const REQUEST_CLAIM_ACTIVITY: RequestOpDoc = {
  kind: 'request',
  name: 'CLAIM_ACTIVITY',
  title: '领取活动奖励',
  preAuth: false,
  summary: '领取活动某一档奖励（data.id = 阶梯 id，如 act_launch:1 / act_daily:3）。未达成 / 不在活动期 / 重复领取均返回 INVALID_PARAMS。奖励发往主城。',
  requestFields: [{ name: 'id', type: 'string', desc: '必填。阶梯 id（来自 GET_ACTIVITIES 的 tiers[].id）。' }],
  dataFields: [
    { name: 'activities', type: 'array', desc: '领取后的活动状态（结构同 GET_ACTIVITIES 的 activities）。' },
    { name: 'granted', type: 'object', desc: '本次发放的资源。' },
    { name: 'city', type: 'object', desc: '发奖后的主城状态（字段同 GET_STATE）。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '领取每日活跃 3 点奖励',
      request: { op: Op.CLAIM_ACTIVITY, seq: 1, data: { id: 'act_daily:3' } },
      responses: [
        {
          op: Op.CLAIM_ACTIVITY,
          seq: 1,
          ok: true,
          data: {
            activities: ACTIVITIES_EXAMPLE,
            granted: { gold: 800, wood: 0, food: 0, stone: 0, iron: 0 },
            city: exampleCity(),
          },
        },
      ],
    },
    {
      caption: '不在活动期 / 未达成',
      request: { op: Op.CLAIM_ACTIVITY, seq: 2, data: { id: 'act_launch:1' } },
      responses: [{ op: Op.CLAIM_ACTIVITY, seq: 2, ok: false, error: { code: 'INVALID_PARAMS', message: '任务未完成或今日已领取' } }],
    },
  ],
};
