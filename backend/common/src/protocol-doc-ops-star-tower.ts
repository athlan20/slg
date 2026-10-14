// 将星塔的协议文档（v55，AISLG-146）：GET_STAR_TOWER / STAR_TOWER_CHALLENGE / GET_STAR_TOWER_REPORTS。
// 从 protocol-doc-ops.ts 拆出以控制单文件行数。规则与数值见 common/src/star-tower.ts；玩家与 Agent 同一套规则。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';

// 示例数值按 star-tower.ts 的公式算：第 1 层基础属性 23（统率型 +6、其余 -3），等级 round(23 / 3) = 8
const STAR_TOWER_FIGHTER_EXAMPLE = { heroId: null, name: '许褚', lead: 29, force: 20, wit: 20, level: 8 };

export const REQUEST_GET_STAR_TOWER: RequestOpDoc = {
  kind: 'request',
  name: 'GET_STAR_TOWER',
  title: '查询将星塔',
  preAuth: false,
  summary:
    '（v55，AISLG-146）返回我的爬塔进度：已通过的最高层 bestFloor（0 = 还没通过任何一层）、下一层 nextFloor（只能从它开始打，不能跳层）、下一层是否 Boss 层、下一层的敌方阵容（匿名）与首通奖励预览、我的阵容（与竞技场共用，保存走 SET_ARENA_LINEUP）、阵容是否可用、账号是否有城。挑战前先调用一次；之后以 STAR_TOWER_CHALLENGE 的响应为准。',
  requestFields: [],
  dataFields: [
    { name: 'formations', type: 'string[3]', desc: 'v59: Saved templates shared with arena. Each fighter snapshot includes formation and specialty. Save templates through SET_ARENA_LINEUP. System enemies retain the balanced template and no specialty.' },
    { name: 'rules.armyBase / rules.armyPerLead / rules.formationRules / rules.troopPower', type: 'object', desc: 'v59: Same authoritative army-preview parameters and template catalog as arena.' },
    { name: 'bestFloor', type: 'number', desc: '已通过的最高层（0 = 还没通过任何一层）。' },
    { name: 'cleared', type: 'boolean', desc: '是否已全部通关（bestFloor 等于总层数）。' },
    { name: 'nextFloor', type: 'number | null', desc: '下一层，即可挑战的层；全部通关为 null。' },
    { name: 'nextBoss', type: 'boolean', desc: '下一层是否 Boss 层（每 10 层一个）。' },
    { name: 'nextEnemies', type: 'Fighter[]', desc: '下一层的敌方阵容（固定 3 名，号位 1/2/3 一一对应，heroId 恒为 null）。name、lead、force、wit、level。' },
    { name: 'nextReward', type: '{ gold, exp } | null', desc: '下一层首通奖励预览：gold 进主城，exp 给阵容里每名武将；全部通关为 null。' },
    { name: 'lineup', type: 'Array<Fighter | null>', desc: '我的阵容（与竞技场共用），3 个号位；空位为 null。自己的武将带 heroId。' },
    { name: 'lineupReady', type: 'boolean', desc: '阵容里是否至少有 1 名武将。' },
    { name: 'hasCity', type: 'boolean', desc: '账号是否有城；没有城不能挑战（首通金币无处入账）。' },
    { name: 'rules', type: 'object', desc: '规则常量：floors（总层数）、bossEvery（Boss 层间隔）、slots（3）、winRounds（2，三局两胜）。' },
  ],
  errors: [],
  examples: [
    {
      caption: '已通过 9 层，下一层是第 10 层 Boss',
      request: { op: Op.GET_STAR_TOWER, seq: 1 },
      responses: [
        {
          op: Op.GET_STAR_TOWER,
          seq: 1,
          ok: true,
          data: {
            bestFloor: 9,
            cleared: false,
            nextFloor: 10,
            nextBoss: true,
            nextEnemies: [
              // 第 10 层 Boss：基础属性 22 + 6 + 12 = 40，等级 round(40 / 3) = 13；幻影名取名将名单
              { heroId: null, name: '徐晃·幻影', lead: 46, force: 37, wit: 37, level: 13 },
              { heroId: null, name: '吕布·幻影', lead: 37, force: 46, wit: 37, level: 13 },
              { heroId: null, name: '马超·幻影', lead: 37, force: 37, wit: 46, level: 13 },
            ],
            nextReward: { gold: 27000, exp: 160 },
            lineup: [
              { heroId: '6b1f3c2e-9a0d-4f7e-8b21-3d5c7e9f1a20', name: '张辽', lead: 52, force: 48, wit: 30, level: 14 },
              null,
              null,
            ],
            lineupReady: true,
            hasCity: true,
            rules: { floors: 100, bossEvery: 10, slots: 3, winRounds: 2 },
          },
        },
      ],
    },
  ],
  agentNote:
    '挑战只打 nextFloor，不能指定层。阵容不可用（lineupReady 为 false）或 hasCity 为 false 时先按提示处理，再挑战。',
};

export const REQUEST_STAR_TOWER_CHALLENGE: RequestOpDoc = {
  kind: 'request',
  name: 'STAR_TOWER_CHALLENGE',
  title: '挑战将星塔下一层',
  preAuth: false,
  summary:
    '（v55，AISLG-146）挑战下一层（无参数）。阵容与敌方按竞技场的三局两胜当场结算，不消耗真实兵力、不改武将状态（重伤、欠饷、外出都不影响）。赢了：第一次通过这一层，发首通奖励（金币进主城，经验给阵容里每名武将，Boss 层翻倍）并推进进度；Boss 层首通全服播报。输了：什么都不扣，可以立刻重打。已通过的层不再发奖励。',
  requestFields: [],
  dataFields: [
    { name: 'match', type: 'Match', desc: '本场战报（结构同 GET_STAR_TOWER_REPORTS 的 reports[]）。' },
    { name: 'floor', type: 'number', desc: '本次挑战的层。' },
    { name: 'won', type: 'boolean', desc: '是否通过本层。' },
    { name: 'bestFloor', type: 'number', desc: '挑战后已通过的最高层。' },
    { name: 'reward', type: '{ gold, exp } | null', desc: '本次首通发放的奖励；输了或重打已通过的层为 null。' },
    { name: 'levelUps', type: 'Array<{ heroId, name, leveledTo }>', desc: '首通后升级的武将；没有为空数组。' },
  ],
  errors: ['STAR_TOWER_CLEARED', 'STAR_TOWER_NO_CITY', 'STAR_TOWER_NO_LINEUP'],
  examples: [
    {
      caption: '通过第 1 层',
      request: { op: Op.STAR_TOWER_CHALLENGE, seq: 2 },
      responses: [
        {
          op: Op.STAR_TOWER_CHALLENGE,
          seq: 2,
          ok: true,
          data: {
            match: {
              id: 41,
              createdAt: '2026-10-12T09:00:00.000Z',
              floor: 1,
              boss: false,
              won: true,
              challengerWins: 2,
              defenderWins: 1,
              rounds: [],
              lineup: [{ heroId: null, name: '张辽', lead: 52, force: 48, wit: 30, level: 14 }, null, null],
              enemies: [
                STAR_TOWER_FIGHTER_EXAMPLE,
                { heroId: null, name: '典韦', lead: 20, force: 29, wit: 20, level: 8 },
                { heroId: null, name: '李典', lead: 20, force: 20, wit: 29, level: 8 },
              ],
            },
            floor: 1,
            won: true,
            bestFloor: 1,
            reward: { gold: 2500, exp: 44 },
            levelUps: [],
          },
        },
      ],
    },
    {
      caption: '已全部通关',
      request: { op: Op.STAR_TOWER_CHALLENGE, seq: 3 },
      responses: [{ op: Op.STAR_TOWER_CHALLENGE, seq: 3, ok: false, error: { code: 'STAR_TOWER_CLEARED', message: '将星塔已经全部通关，没有可挑战的层了' } }],
    },
  ],
  agentNote:
    '没有 entryId 之类的参数，每次都打下一层。won 为 false 时可直接重打同一层（不扣任何东西）；想加强阵容先 SET_ARENA_LINEUP。STAR_TOWER_NO_LINEUP 时先保存阵容。',
};

export const REQUEST_GET_STAR_TOWER_REPORTS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_STAR_TOWER_REPORTS',
  title: '查询将星塔战报',
  preAuth: false,
  summary:
    '（v55，AISLG-146）返回我每次挑战将星塔的战报，按时间从新到旧，每人保留最近 50 条（写入新战报时删掉更旧的）。战报里有我的阵容（匿名）与敌方阵容，以及每一局的结果。翻页：取最后一条的 id 作为 beforeId 再查，直到 hasMore 为 false。',
  requestFields: [
    { name: 'limit', type: 'number', desc: '可选，1..50，默认 20。' },
    { name: 'beforeId', type: 'number', desc: '可选。只取 id 小于它的更早战报。' },
  ],
  dataFields: [
    { name: 'reports', type: 'Match[]', desc: '战报列表：id、createdAt、floor、boss、won、challengerWins、defenderWins、rounds、lineup（我的，匿名）、enemies（敌方）。' },
    { name: 'hasMore', type: 'boolean', desc: '是否还有更早的战报。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '最近一页战报',
      request: { op: Op.GET_STAR_TOWER_REPORTS, seq: 4, data: { limit: 20 } },
      responses: [{ op: Op.GET_STAR_TOWER_REPORTS, seq: 4, ok: true, data: { reports: [], hasMore: false } }],
    },
  ],
  agentNote: '战报只用来复盘，不影响进度与奖励。要看当前能打哪一层，以 GET_STAR_TOWER 为准。',
};

export const STAR_TOWER_OP_DOCS = {
  [Op.GET_STAR_TOWER]: REQUEST_GET_STAR_TOWER,
  [Op.STAR_TOWER_CHALLENGE]: REQUEST_STAR_TOWER_CHALLENGE,
  [Op.GET_STAR_TOWER_REPORTS]: REQUEST_GET_STAR_TOWER_REPORTS,
};
