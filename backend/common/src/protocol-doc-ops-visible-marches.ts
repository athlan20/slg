// 视野内他人部队的对外文档（AISLG-230，v96）：GET_VISIBLE_MARCHES（op 152）。
// 迷雾相关推送见 protocol-doc-ops-fog.ts；地图查询的迷雾裁剪见 protocol-doc-ops-world.ts。
import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import { DEFAULT_MAP_WINDOW, MAX_MAP_WINDOW, WORLD_SIZE } from './world';
import { STARTED_AT } from './protocol-doc-shared';
import { VISIBLE_MARCH_LARGE_MIN, VISIBLE_MARCH_LIMIT, VISIBLE_MARCH_MEDIUM_MIN } from './protocol-world';

const ENEMY_MARCH_ID = 'e5f2cc35-f086-47a1-9b3c-2d4e5f6a7b8c';

export const REQUEST_GET_VISIBLE_MARCHES: RequestOpDoc = {
  kind: 'request',
  name: 'GET_VISIBLE_MARCHES',
  title: '查询视野内的他人部队（v96，AISLG-230）',
  preAuth: false,
  summary: `查询窗口内、你的**实时视野**里的其他玩家部队（战争迷雾第三步，受 fog_enabled 控制）。请求给窗口左上角 (x, y) 与宽高 (w, h)，含义与限制同 GET_WORLD_MAP：缺省以主城为中心取 ${DEFAULT_MAP_WINDOW}×${DEFAULT_MAP_WINDOW}，w/h 须为 1..${MAX_MAP_WINDOW} 的整数，非法或越界取缺省值，窗口起点按世界边界钳制。返回 marches[]：每支其他账号、status = marching 的部队，若其当前位置（四舍五入到整格）落在**你自己的**实时视野内就出现，走出视野后下一次查询就消失。实时视野只有自己的来源：主城 12 格、分城 8 格、占领的野地 3 格（**丘陵上的野地 +2 = 5 格**，AISLG-233）、行军中的部队 3 格、含斥候的部队 5 / 6 / 7 格（侦察科技决定）；**盟友的视野不共享**，盟友的部队也要进你自己的视野才看得到。下列情形不上图：自己的部队（本协议不返回，避免重复显示）、侦察部队（purpose = scout，或编队里只有斥候，去程返程都算，保留侦察的隐蔽性）、已过埋伏时刻（ambushAt）正在埋伏的截击部队（保留埋伏玩法）、已到达的部队与剧本战场的小队（战场有自己的地图）。流寇 / 商队 / 黄巾营地不受影响（见 GET_MOVING_TARGETS / GET_YELLOW_TURBAN）。盲打（fog_denied）与撤回中的部队正常上图，撤回的按实际回程位置算。返回最多 ${VISIBLE_MARCH_LIMIT} 支，离窗口中心由近到远，超出部分不返回。fog_enabled 关闭时 marches 为空数组（不报错，与上线前一致）。玩家与 Agent 走同一接口、同一套裁剪。`,
  requestFields: [
    { name: 'x', type: 'number', desc: `可选。窗口左上角 x，0..${WORLD_SIZE - 1}；缺省按主城居中折算，超出部分按边界钳制。` },
    { name: 'y', type: 'number', desc: `可选。窗口左上角 y，0..${WORLD_SIZE - 1}；缺省按主城居中折算，超出部分按边界钳制。` },
    { name: 'w', type: 'number', desc: `可选。窗口宽度，1..${MAX_MAP_WINDOW} 的整数；缺省、非法或越界取 ${DEFAULT_MAP_WINDOW}。` },
    { name: 'h', type: 'number', desc: `可选。窗口高度，1..${MAX_MAP_WINDOW} 的整数；缺省、非法或越界取 ${DEFAULT_MAP_WINDOW}。` },
  ],
  dataFields: [
    { name: 'serverTime', type: 'string', desc: '快照时刻（ISO 8601）：客户端以收到响应的本地时刻为基准用 vx / vy 外推，不必依赖两端时钟一致。' },
    { name: 'marches', type: 'array', desc: `窗口内视野里的他人部队，离窗口中心由近到远，最多 ${VISIBLE_MARCH_LIMIT} 支；迷雾关闭时为空数组。` },
    { name: 'marches[].id', type: 'string', desc: '行军 id（UUID）：用来和来袭预警 PUSH_ATTACK_WARNING 的 marchId 对上——敌军打进你的视野时界面据此把图标转红并连线到被攻击格。' },
    { name: 'marches[].x / marches[].y', type: 'number', desc: '部队当前所在位置（世界格坐标，保留 1 位小数）。' },
    { name: 'marches[].vx / marches[].vy', type: 'number', desc: '速度（每秒格数，正负表示方向），只用来让图标平滑移动；两次采样本来也能算出方向，因此不算泄露。' },
    { name: 'marches[].returning', type: 'boolean', desc: 'true = 返程（往出发城走），false = 去程。' },
    { name: 'marches[].scale', type: "'small' | 'medium' | 'large'", desc: `规模档位（按编队总人数，不给精确兵力）：small 1–${VISIBLE_MARCH_MEDIUM_MIN - 1} 小股 / medium ${VISIBLE_MARCH_MEDIUM_MIN}–${VISIBLE_MARCH_LARGE_MIN - 1} 中军 / large ${VISIBLE_MARCH_LARGE_MIN} 及以上大军。` },
    { name: 'marches[].owner.username', type: 'string', desc: '所属玩家名（中立玩家也给）。' },
    { name: 'marches[].owner.allianceName', type: 'string | null', desc: '所属联盟名；没有联盟为 null。' },
    { name: 'marches[].owner.relation', type: "'ally' | 'friendly' | 'hostile' | 'neutral'", desc: '与你（请求账号）的关系，与地块 owner.relation 同一口径：ally 同盟 / friendly 友盟（含解除友好后的冷却期）/ hostile 敌对联盟 / neutral 中立。界面按它上色：同盟友盟绿色、中立灰色、敌对橙色、正在来袭自己红色（后者由 marchId 与来袭预警匹配得出）。' },
  ],
  errors: [],
  examples: [
    {
      caption: '视野里有 1 支敌军（地图打开时每 5 秒一次）',
      request: { op: Op.GET_VISIBLE_MARCHES, seq: 9, data: { x: 10, y: 12, w: 10, h: 10 } },
      responses: [
        {
          op: Op.GET_VISIBLE_MARCHES,
          seq: 9,
          ok: true,
          data: {
            serverTime: STARTED_AT,
            marches: [
              {
                id: ENEMY_MARCH_ID,
                x: 14.3,
                y: 17.6,
                vx: 0.0667,
                vy: 0,
                returning: false,
                scale: 'medium',
                owner: { username: 'zhangfei', allianceName: '桃园', relation: 'hostile' },
              },
            ],
          },
        },
      ],
    },
    {
      caption: '迷雾关闭（或视野里什么都没有）',
      request: { op: Op.GET_VISIBLE_MARCHES, seq: 10, data: { x: 10, y: 12, w: 10, h: 10 } },
      responses: [{ op: Op.GET_VISIBLE_MARCHES, seq: 10, ok: true, data: { serverTime: STARTED_AT, marches: [] } }],
    },
  ],
  agentNote: `这里只有**你的视野内**的他人部队，看不到不代表没有：目标可能就在迷雾里、或者离你的城池太远。别把「marches 为空」当成安全信号。判断有没有部队打自己仍然以来袭预警（PUSH_ATTACK_WARNING / 事件 player_attack_warning，含目标格与到达时刻）为准；本协议给的是位置、方向、去返程、规模档位与主人关系，**没有**目标格、出发城、出发 / 到达时间与兵力明细，所以用它算不出对手要去哪。盟友的视野不共享，盟友看到的部队你看不到。第一版只能看、不能截击（MARCH 的 targetId 截击只支持流寇 / 商队这类移动目标）。`,
};
