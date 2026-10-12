// 竞技场的协议文档（v53，AISLG-145）：GET_ARENA / SET_ARENA_LINEUP / ARENA_CHALLENGE /
// GET_ARENA_REPORTS 与推送 PUSH_ARENA_STATE。从 protocol-doc-ops.ts 拆出以控制单文件行数。
// 规则与数值见 common/src/arena.ts；玩家与 Agent 同一套规则，不限连接类型。

import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';

const ARENA_STATE_DATA_FIELDS = [
  { name: 'joined', type: 'boolean', desc: '是否已入榜（第一次保存阵容时入榜）。' },
  { name: 'rank', type: 'number | null', desc: '当前名次；未入榜为 null。' },
  { name: 'bestRank', type: 'number | null', desc: '历史最好名次（进档奖励以它为准：只有它升进新档才发；入榜时不发）；未入榜为 null。' },
  { name: 'totalEntries', type: 'number', desc: '榜上席位总数（含 20 个系统守擂者）。' },
  { name: 'lineup', type: 'Array<Fighter | null>', desc: '我的阵容，3 个号位（1/2/3 号位），空位为 null。Fighter 含 heroId（本账号武将 id）、name、lead、force、wit、level。' },
  { name: 'challengesLeft / challengesMax', type: 'number', desc: '本竞技日剩余 / 上限挑战次数（上限 5）。' },
  { name: 'defendedToday / defendedMax', type: 'number', desc: '本竞技日我被挑战的次数 / 上限（上限 10）。' },
  { name: 'nextDayAt', type: 'string (ISO)', desc: '下一个竞技日开始的时刻（次数重置、每日奖励发放）。' },
  { name: 'dailyReward', type: 'number', desc: '按当前名次，下一次发放的每日奖励（金币）；未入榜为 0。' },
  { name: 'opponents', type: 'Opponent[]', desc: '可挑战的对手，按名次从近到远：entryId（ARENA_CHALLENGE 用）、rank、username、npc、lineup（匿名，heroId 恒为 null）、defendedToday。' },
  { name: 'top', type: 'Array<{rank, username, npc}>', desc: '榜单前 100 名（实时，不挂进现有排行榜）。' },
  { name: 'rules', type: 'object', desc: '规则常量：slots、dailyChallenges、dailyDefendedMax、maxRankGap、pairCooldownSeconds、dailyRewards、milestoneRewards、armyBase、armyPerLead、armyKinds（标准军队人数 = armyBase + 统率 × armyPerLead）。' },
];

const ARENA_STATE_EXAMPLE = {
  joined: true,
  rank: 21,
  bestRank: 21,
  totalEntries: 21,
  lineup: [
    { heroId: '6b1f3c2e-9a0d-4f7e-8b21-3d5c7e9f1a20', name: '关羽', lead: 88, force: 96, wit: 45, level: 12 },
    null,
    null,
  ],
  challengesLeft: 5,
  challengesMax: 5,
  defendedToday: 0,
  defendedMax: 10,
  nextDayAt: '2026-10-12T16:00:00.000Z',
  dailyReward: 1000,
  opponents: [
    {
      entryId: '0c9e7d3a-2b1f-4e6a-9d8c-7f5e3a1b2c4d',
      rank: 11,
      username: '守擂·张飞',
      npc: true,
      lineup: [
        { heroId: null, name: '张飞', lead: 66, force: 60, wit: 57, level: 22 },
        null,
        null,
      ],
      defendedToday: 0,
    },
  ],
  top: [{ rank: 1, username: '卧龙先生', npc: false }],
  rules: {
    slots: 3,
    dailyChallenges: 5,
    dailyDefendedMax: 10,
    maxRankGap: 10,
    pairCooldownSeconds: 300,
    dailyRewards: [{ upTo: 1, gold: 50000 }, { upTo: 10, gold: 30000 }, { upTo: 50, gold: 15000 }, { upTo: 200, gold: 5000 }, { upTo: null, gold: 1000 }],
    milestoneRewards: [{ upTo: 200, gold: 20000 }, { upTo: 50, gold: 50000 }, { upTo: 10, gold: 100000 }, { upTo: 1, gold: 300000 }],
    armyBase: 2000,
    armyPerLead: 2,
    armyKinds: ['swordsman', 'archer'],
  },
};

export const REQUEST_GET_ARENA: RequestOpDoc = {
  kind: 'request',
  name: 'GET_ARENA',
  title: '查询竞技场',
  preAuth: false,
  summary:
    '（v53，AISLG-145）返回我在竞技场的完整状态：名次、阵容、今日挑战与被挑战次数、可挑战对手、榜单前 100 名与规则常量。进入竞技场时先调用一次；之后以 ARENA_CHALLENGE / SET_ARENA_LINEUP 的响应为准，不必重复查询。第一次访问时系统会补齐 20 个守擂者（占榜首 1–20 名）。玩家与 Agent 同一套规则。',
  requestFields: [],
  dataFields: ARENA_STATE_DATA_FIELDS,
  errors: [],
  examples: [
    {
      caption: '已入榜',
      request: { op: Op.GET_ARENA, seq: 1 },
      responses: [{ op: Op.GET_ARENA, seq: 1, ok: true, data: ARENA_STATE_EXAMPLE }],
    },
  ],
};

export const REQUEST_SET_ARENA_LINEUP: RequestOpDoc = {
  kind: 'request',
  name: 'SET_ARENA_LINEUP',
  title: '保存竞技场阵容',
  preAuth: false,
  summary:
    '（v53，AISLG-145）保存竞技场阵容：heroIds 为 3 个号位（1/2/3 号位），空位用 null；至少要有 1 名武将，同一武将不能占两个号位，武将必须属于本账号。第一次保存即入榜，排在榜尾（名次 = 当前总人数 + 1 之后的最后一名）。阵容随时可改，改完马上生效：别人挑战你时用的是你保存那一刻的阵容与武将当时的属性。武将重伤、没发俸禄、正在外出都不影响参赛（对战是模拟的）。',
  requestFields: [
    { name: 'heroIds', type: 'Array<string | null>', desc: '必填。长度 ≤ 3 的数组，元素为武将 id 或 null（空位）；至少一个非 null；不能重复。' },
  ],
  dataFields: ARENA_STATE_DATA_FIELDS,
  errors: ['HERO_NOT_FOUND', 'INVALID_PARAMS'],
  examples: [
    {
      caption: '第一次保存阵容，入榜',
      request: {
        op: Op.SET_ARENA_LINEUP,
        seq: 2,
        data: { heroIds: ['6b1f3c2e-9a0d-4f7e-8b21-3d5c7e9f1a20', null, null] },
      },
      responses: [{ op: Op.SET_ARENA_LINEUP, seq: 2, ok: true, data: ARENA_STATE_EXAMPLE }],
    },
    {
      caption: '阵容里有不属于本账号的武将',
      request: { op: Op.SET_ARENA_LINEUP, seq: 3, data: { heroIds: ['00000000-0000-4000-8000-000000000000', null, null] } },
      responses: [{ op: Op.SET_ARENA_LINEUP, seq: 3, ok: false, error: { code: 'HERO_NOT_FOUND', message: '该武将不存在或不属于本账号' } }],
    },
  ],
};

export const REQUEST_ARENA_CHALLENGE: RequestOpDoc = {
  kind: 'request',
  name: 'ARENA_CHALLENGE',
  title: '发起竞技挑战',
  preAuth: false,
  summary:
    '（v53，AISLG-145）挑战一名对手，当场算完。进档奖励：历史最好名次第一次升进前 200 / 前 50 / 前 10 / 第 1 名时各发一次性奖励，入榜时不发。规则：只能挑战名次比我靠前、且差距不超过 10 名的席位；每个竞技日最多 5 次（我发起的次数）；每名玩家每个竞技日最多被挑战 10 次；同一对手连续挑战有 5 分钟冷却（已按时间缩放）。对战为三局两胜：1 号位对 1 号位、2 对 2、3 对 3，先赢两局者胜，决出后不再打余下的局；某方缺人的号位判对方胜（双方都缺判守擂方胜）。对战用系统配的标准军队（人数 = 基础兵数 + 统率 × 每点统率兵数，见 rules.armyBase / armyPerLead；刀盾 / 弓箭各一半），不消耗真实兵力，不改变武将的伤病与状态。挑战方赢了与对手互换名次；输了名次不变，但照样扣一次挑战次数。',
  requestFields: [
    { name: 'entryId', type: 'string', desc: '必填。对手席位 id，即 GET_ARENA 的 opponents[].entryId。' },
  ],
  dataFields: [
    { name: 'match', type: 'Match', desc: '本场战报：role（我是 challenger 还是 defender）、双方名次前后、challengerWon、challengerWins / defenderWins、rounds（实际进行的局，每局含 slot、winner、reason 与交战摘要）、双方阵容快照。' },
    { name: 'rank', type: 'number', desc: '挑战后我的名次。' },
    { name: 'bestRank', type: 'number', desc: '挑战后的历史最好名次。' },
    { name: 'challengesLeft', type: 'number', desc: '本竞技日剩余挑战次数。' },
    { name: 'milestoneGold', type: 'number', desc: '本次历史最好名次升进新名次档拿到的一次性奖励（金币），没有为 0。入榜时不发。' },
    { name: 'milestoneTiers', type: 'number[]', desc: '本次升进的名次档（如 [10] 表示首次进入前 10）。' },
  ],
  errors: ['ARENA_NOT_JOINED', 'ARENA_TARGET_INVALID', 'ARENA_NO_CHALLENGES', 'ARENA_TARGET_BUSY', 'ARENA_PAIR_COOLDOWN', 'INVALID_PARAMS'],
  examples: [
    {
      caption: '挑战成功，互换名次',
      request: { op: Op.ARENA_CHALLENGE, seq: 4, data: { entryId: '0c9e7d3a-2b1f-4e6a-9d8c-7f5e3a1b2c4d' } },
      responses: [
        {
          op: Op.ARENA_CHALLENGE,
          seq: 4,
          ok: true,
          data: {
            match: {
              id: 101,
              createdAt: '2026-10-12T08:00:00.000Z',
              role: 'challenger',
              challenger: { username: '我', rankBefore: 21, rankAfter: 11 },
              defender: { username: '守擂·张飞', npc: true, rankBefore: 11, rankAfter: 21 },
              challengerWon: true,
              challengerWins: 2,
              defenderWins: 1,
              rounds: [],
              challengerLineup: [],
              defenderLineup: [],
            },
            rank: 11,
            bestRank: 11,
            challengesLeft: 4,
            milestoneGold: 0,
            milestoneTiers: [],
          },
        },
      ],
    },
    {
      caption: '名次变化后对手已不在范围内',
      request: { op: Op.ARENA_CHALLENGE, seq: 5, data: { entryId: '0c9e7d3a-2b1f-4e6a-9d8c-7f5e3a1b2c4d' } },
      responses: [{ op: Op.ARENA_CHALLENGE, seq: 5, ok: false, error: { code: 'ARENA_TARGET_INVALID', message: '这个对手现在不能挑战（名次已变化：必须比你靠前且差距不超过 10 名），请刷新对手列表' } }],
    },
  ],
  agentNote:
    '挑战前先看 opponents 里的 rank 与 defendedToday；ARENA_NO_CHALLENGES / ARENA_TARGET_BUSY 响应附 nextDayAt 与 retryAfterSeconds，等到那时再试。ARENA_PAIR_COOLDOWN 附 retryAfterSeconds。名次会被别人的挑战改变，遇到 ARENA_TARGET_INVALID 应重拉 GET_ARENA。',
};

export const REQUEST_GET_ARENA_REPORTS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_ARENA_REPORTS',
  title: '查询竞技场战报',
  preAuth: false,
  summary:
    '（v53，AISLG-145）返回我参与过的竞技战报（我挑战别人的、别人挑战我的），按时间从新到旧。战报保留 7 天，过期自动清理。战报里只有对手武将的名字与属性，不含武将 id。翻页：取最后一条的 id 作为 beforeId 再查，直到 hasMore 为 false。',
  requestFields: [
    { name: 'limit', type: 'number', desc: '可选，1..50，默认 20。' },
    { name: 'beforeId', type: 'number', desc: '可选。只取 id 小于它的更早战报。' },
  ],
  dataFields: [
    { name: 'reports', type: 'Match[]', desc: '战报列表，每条与 ARENA_CHALLENGE 响应里的 match 结构相同（role 指明我是哪一方）。' },
    { name: 'hasMore', type: 'boolean', desc: '是否还有更早的战报。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '最近一页战报',
      request: { op: Op.GET_ARENA_REPORTS, seq: 6, data: { limit: 20 } },
      responses: [{ op: Op.GET_ARENA_REPORTS, seq: 6, ok: true, data: { reports: [], hasMore: false } }],
    },
  ],
};

export const PUSH_ARENA_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_ARENA_STATE',
  title: '推送：竞技场状态变化',
  summary:
    '（v53，AISLG-145）竞技场状态变化时推送给该账号全部在线连接（含 Agent 连接）。reason=challenged：被人挑战（名次可能已变化，defeated 表示我是否被打败，rank 为我挑战后的名次）；daily_reward：每日奖励到账（gold）；milestone：首次进入新名次档拿到一次性奖励（gold、tiers）。推送只带变化摘要，完整状态用 GET_ARENA 查询。',
  dataFields: [
    { name: 'reason', type: "'challenged' | 'daily_reward' | 'milestone'", desc: '触发本次推送的状态变化。' },
    { name: 'challenger', type: 'string', desc: 'challenged：挑战方的昵称。' },
    { name: 'defeated', type: 'boolean', desc: 'challenged：我是否被打败（true 表示挑战方赢，我的名次已下沉）。' },
    { name: 'rank', type: 'number', desc: 'challenged：挑战结束后我的名次；daily_reward：发放时我的名次。' },
    { name: 'matchId', type: 'number', desc: 'challenged：本场战报 id，可用 GET_ARENA_REPORTS 查详情。' },
    { name: 'gold', type: 'number', desc: 'daily_reward / milestone：到账的金币。' },
    { name: 'tiers', type: 'number[]', desc: 'milestone：本次新进入的名次档。' },
  ],
  examples: [
    {
      op: Op.PUSH_ARENA_STATE,
      push: true,
      data: { reason: 'challenged', challenger: '卧龙先生', defeated: true, rank: 12, matchId: 101 },
    },
    {
      op: Op.PUSH_ARENA_STATE,
      push: true,
      data: { reason: 'daily_reward', gold: 1000, rank: 21 },
    },
  ],
  agentNote: '收到 challenged 且 defeated 为 true 时，名次已下沉：如需反击，先 GET_ARENA 拿最新 opponents，再决定是否挑战。daily_reward 只表示金币已进主城，无需另行领取。',
};

export const ARENA_OP_DOCS = {
  [Op.GET_ARENA]: REQUEST_GET_ARENA,
  [Op.SET_ARENA_LINEUP]: REQUEST_SET_ARENA_LINEUP,
  [Op.ARENA_CHALLENGE]: REQUEST_ARENA_CHALLENGE,
  [Op.GET_ARENA_REPORTS]: REQUEST_GET_ARENA_REPORTS,
  [Op.PUSH_ARENA_STATE]: PUSH_ARENA_STATE,
};
