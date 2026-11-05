// 战争迷雾的对外文档（AISLG-224，v92）：推送 PUSH_EXPLORATION_REPORT（探索简报）。
// 地图查询 / 出征 / 聊天 / 迁城的迷雾裁剪说明分别在对应协议的文档里（protocol-doc-ops-world.ts 等）。
import { Op } from './protocol';
import type { PushOpDoc } from './protocol-doc';

export const PUSH_EXPLORATION_REPORT: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_EXPLORATION_REPORT',
  title: '推送：探索简报（v92，AISLG-224）',
  summary: `部队去程结束（到达或撤回）后，如果这一趟新探索了区块，推给本账号一份简报：新探索的区块数、新区块里的东西按类计数（NPC 城分等级、金矿、Lv5 及以上野地、在野名将、其他玩家的城、名城，v93 起还有未领取的遗迹 relics.byKind），以及最多 10 个坐标（优先级：名城 > 遗迹 > 在野名将 > 金矿 > 玩家城 > NPC 城 > 高级野地）。内容与事件 exploration_report 的 detail 一致，可随时用 GET_EVENTS 回看。存量初始化、开局与城池 / 领地带来的新区块不生成简报；返程不生成。`,
  dataFields: [
    { name: 'report', type: 'object', desc: '{ eventId, marchId, chunks, npcCities: { total, byLevel }, goldMines, highWilderness, wildHeroes, playerCities, famous, relics: { total, byKind }, cells: [{ x, y, kind, level? }] }。kind = famous / relic / wild_hero / gold_mine / player_city / npc_city / high_wilderness。' },
  ],
  examples: [
    {
      op: Op.PUSH_EXPLORATION_REPORT,
      push: true,
      data: {
        report: {
          eventId: 1024,
          marchId: '6f1d2c3e-0000-4000-8000-000000000001',
          chunks: 3,
          npcCities: { total: 2, byLevel: { '3': 1, '5': 1 } },
          goldMines: 1,
          highWilderness: 0,
          wildHeroes: 0,
          playerCities: 0,
          famous: 0,
          cells: [{ x: 512, y: 340, kind: 'gold_mine', level: 2 }],
        },
      },
    },
  ],
  agentNote: '收到后可按 cells 坐标用 GET_TILE 查看（已探索的地块返回上次看到的情况，带 seenAt）。',
};
