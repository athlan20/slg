// 任务与签到（v56，AISLG-200）：日常任务查询 / 领取 + 签到查询 / 签到。
// 本地自建分支新增；条目登记在 protocol-doc-ops.ts 的 OP_DOC。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import { exampleCity } from './protocol-doc-shared';

/** 示例用的任务/签到状态（GET_DAILY 的 data.quest） */
const QUEST_STATE_EXAMPLE = {
  day: '2026-10-13',
  daily: [
    { id: 'login', title: '每日登录', desc: '今日登录游戏', done: true, claimed: false, reward: { gold: 500, wood: 0, food: 0, stone: 0, iron: 0 } },
    { id: 'build', title: '大兴土木', desc: '完成 1 次建造或升级', done: true, claimed: false, reward: { gold: 1500, wood: 1500, food: 0, stone: 0, iron: 0 } },
    { id: 'recruit', title: '招兵买马', desc: '征兵 1 次', done: false, claimed: false, reward: { gold: 0, wood: 0, food: 2000, stone: 0, iron: 0 } },
    { id: 'march', title: '出征沙场', desc: '出征 1 次', done: false, claimed: false, reward: { gold: 1500, wood: 0, food: 0, stone: 0, iron: 1500 } },
    { id: 'research', title: '潜心钻研', desc: '研究科技 1 次', done: false, claimed: false, reward: { gold: 0, wood: 1500, food: 0, stone: 1500, iron: 0 } },
    { id: 'occupy', title: '开疆拓土', desc: '占领 1 块野地', done: false, claimed: false, reward: { gold: 1500, wood: 0, food: 0, stone: 1500, iron: 0 } },
  ],
  signin: {
    streak: 3,
    total: 10,
    todaySigned: false,
    days: [
      { day: 1, reward: { gold: 1000, wood: 0, food: 0, stone: 0, iron: 0 }, claimed: true },
      { day: 2, reward: { gold: 0, wood: 1500, food: 1500, stone: 0, iron: 0 }, claimed: true },
      { day: 3, reward: { gold: 2000, wood: 0, food: 0, stone: 0, iron: 0 }, claimed: true },
      { day: 4, reward: { gold: 0, wood: 0, food: 0, stone: 2000, iron: 2000 }, claimed: false },
      { day: 5, reward: { gold: 2500, wood: 2500, food: 0, stone: 0, iron: 0 }, claimed: false },
      { day: 6, reward: { gold: 0, wood: 0, food: 3000, stone: 3000, iron: 0 }, claimed: false },
      { day: 7, reward: { gold: 8000, wood: 5000, food: 5000, stone: 5000, iron: 5000 }, claimed: false },
    ],
  },
};

const QUEST_SUMMARY =
  '任务与签到是本地自建分支新增的日常玩法（AISLG-200）：6 条日常任务按「北京日」（Asia/Shanghai）刷新，完成判定读取当日事件（登录恒完成）；签到每天一次、连续签到 7 天一轮循环。奖励发往主城。';

/** GET_DAILY（op 86，v56）：查询今日任务与签到状态 */
export const REQUEST_GET_DAILY: RequestOpDoc = {
  kind: 'request',
  name: 'GET_DAILY',
  title: '查询日常任务与签到状态',
  preAuth: false,
  summary: QUEST_SUMMARY,
  requestFields: [],
  dataFields: [
    { name: 'quest', type: 'object', desc: '任务与签到状态：{ day（今日北京日 YYYY-MM-DD）, daily（6 条任务）, signin（签到状态） }。daily[]：{ id, title, desc, done（今日是否达成）, claimed（是否已领奖）, reward（资源） }；signin：{ streak（连续天数）, total（累计次数）, todaySigned, days[7]（{ day, reward, claimed }） }。' },
  ],
  errors: [],
  examples: [
    {
      caption: '登录后查询当日任务',
      request: { op: Op.GET_DAILY, seq: 1 },
      responses: [{ op: Op.GET_DAILY, seq: 1, ok: true, data: { quest: QUEST_STATE_EXAMPLE } }],
    },
  ],
  agentNote: 'Agent 可查询并代领任务奖励（与玩家同一套规则）。任务 id 与条件在未来版本可能增删，请以本协议响应的 daily 列表为准，不要硬编码。',
};

/** CLAIM_DAILY（op 87，v56）：领取一条已完成的日常任务奖励 */
export const REQUEST_CLAIM_DAILY: RequestOpDoc = {
  kind: 'request',
  name: 'CLAIM_DAILY',
  title: '领取日常任务奖励',
  preAuth: false,
  summary: '领取一条当日已完成、未领取的日常任务奖励，资源发往主城。任务不存在 / 未完成 / 今日已领取均返回 INVALID_PARAMS。',
  requestFields: [{ name: 'taskId', type: 'string', desc: '必填。任务 id（来自 GET_DAILY 的 daily[].id，如 login / build / recruit / march / research / occupy）。' }],
  dataFields: [
    { name: 'quest', type: 'object', desc: '领取后的任务与签到状态（结构同 GET_DAILY 的 quest）。' },
    { name: 'granted', type: 'object', desc: '本次发放的资源（{ gold, wood, food, stone, iron }）。' },
    { name: 'city', type: 'object', desc: '发奖后的主城状态（字段同 GET_STATE）。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '领取「每日登录」奖励',
      request: { op: Op.CLAIM_DAILY, seq: 1, data: { taskId: 'login' } },
      responses: [
        {
          op: Op.CLAIM_DAILY,
          seq: 1,
          ok: true,
          data: {
            quest: { ...QUEST_STATE_EXAMPLE, daily: QUEST_STATE_EXAMPLE.daily.map((t) => (t.id === 'login' ? { ...t, claimed: true } : t)) },
            granted: { gold: 500, wood: 0, food: 0, stone: 0, iron: 0 },
            city: exampleCity(),
          },
        },
      ],
    },
    {
      caption: '任务未完成',
      request: { op: Op.CLAIM_DAILY, seq: 2, data: { taskId: 'march' } },
      responses: [{ op: Op.CLAIM_DAILY, seq: 2, ok: false, error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' } }],
    },
  ],
  agentNote: '建议 Agent 在完成对应动作后（建造 / 征兵 / 出征 / 研究 / 占领）顺手领取当日任务奖励。',
};

/** GET_SIGNIN（op 88，v56）：查询签到状态 */
export const REQUEST_GET_SIGNIN: RequestOpDoc = {
  kind: 'request',
  name: 'GET_SIGNIN',
  title: '查询签到状态',
  preAuth: false,
  summary: '查询签到状态（GET_DAILY 的 quest.signin 子集亦可获取）。',
  requestFields: [],
  dataFields: [
    { name: 'signin', type: 'object', desc: '{ streak（连续天数）, total（累计次数）, todaySigned, days[7]（{ day, reward, claimed }） }。' },
  ],
  errors: [],
  examples: [
    {
      caption: '查询签到状态',
      request: { op: Op.GET_SIGNIN, seq: 1 },
      responses: [{ op: Op.GET_SIGNIN, seq: 1, ok: true, data: { signin: QUEST_STATE_EXAMPLE.signin } }],
    },
  ],
};

/** SIGNIN（op 89，v56）：每日签到 */
export const REQUEST_SIGNIN: RequestOpDoc = {
  kind: 'request',
  name: 'SIGNIN',
  title: '每日签到',
  preAuth: false,
  summary: '每日签到（每天一次，按北京日）。连续签到，7 天一轮循环，奖励按档位递增，第 7 天最优；断签后连续天数归 1。当日重复签到返回 INVALID_PARAMS。奖励发往主城。',
  requestFields: [],
  dataFields: [
    { name: 'signin', type: 'object', desc: '签到后的状态（结构同 GET_SIGNIN）。' },
    { name: 'tier', type: 'number', desc: '本次落在 7 天循环中的档位（1..7）。' },
    { name: 'granted', type: 'object', desc: '本次发放的资源。' },
    { name: 'city', type: 'object', desc: '发奖后的主城状态（字段同 GET_STATE）。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '今日首次签到（连续第 4 天）',
      request: { op: Op.SIGNIN, seq: 1 },
      responses: [
        {
          op: Op.SIGNIN,
          seq: 1,
          ok: true,
          data: {
            signin: { ...QUEST_STATE_EXAMPLE.signin, streak: 4, total: 11, todaySigned: true, days: QUEST_STATE_EXAMPLE.signin.days.map((d) => (d.day <= 4 ? { ...d, claimed: true } : d)) },
            tier: 4,
            granted: { gold: 0, wood: 0, food: 0, stone: 2000, iron: 2000 },
            city: exampleCity(),
          },
        },
      ],
    },
    {
      caption: '今日已签到',
      request: { op: Op.SIGNIN, seq: 2 },
      responses: [{ op: Op.SIGNIN, seq: 2, ok: false, error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' } }],
    },
  ],
};
