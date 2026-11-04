// 城池迁移的协议文档（MOVE_CITY op 150，v91，AISLG-220）与 GET_STATE 的 moveCity 字段。
// 数值与道具名称引用真实常量（items.ts / move-city.ts），不在这里手抄。

import { Op } from './protocol';
import type { FieldDoc, RequestOpDoc } from './protocol-doc';
import { MOVE_CITY_ATTACK_LOCK_MS, MOVE_CITY_MIN_GAP } from './move-city';
import { ITEM_DEFS } from './items';

const ITEM_NAME_RANDOM = ITEM_DEFS.find((def) => def.id === 'city_order')?.name ?? '迁城令';
const ITEM_NAME_POINTING = ITEM_DEFS.find((def) => def.id === 'city_order_adv')?.name ?? '高级迁城令';
const LOCK_HOURS = MOVE_CITY_ATTACK_LOCK_MS / (60 * 60 * 1000);

/** GET_STATE 的迁城字段（接入 protocol-doc-ops.ts 的 REQUEST_GET_STATE.dataFields） */
export const MOVE_CITY_STATE_FIELDS: FieldDoc[] = [
  {
    name: 'moveCity',
    type: 'object',
    desc: `（v91，AISLG-220）城池迁移视图：cities[] 逐城给出 { cityId, reasons（不可迁原因，全部列出：MOVE_CITY_FAMOUS / ARMY_OUTSIDE / HAS_ALLY_FORCE / IN_BATTLE，空数组 = 前四条都通过）, moveLockUntil（指定坐标迁后的出征限制截止时刻，仅未结束时给出） }；items.random = { itemId: 'city_order', count }（${ITEM_NAME_RANDOM}持有数），items.pointing = { itemId: 'city_order_adv', count }（${ITEM_NAME_POINTING}持有数）。目标格与近邻条件不在此视图内，以 MOVE_CITY 的 preview 为准。`,
  },
];

export const REQUEST_MOVE_CITY: RequestOpDoc = {
  kind: 'request',
  name: 'MOVE_CITY',
  title: '迁城（v91，AISLG-220）',
  preAuth: false,
  summary: `把账号名下的一座城（主城或分城，名城除外）迁到地图上的一块空野地。mode = random 随机迁：消耗 1 张${ITEM_NAME_RANDOM}（city_order），系统按注册落位同一算法选址，不需要坐标；mode = pointing 指定坐标迁：消耗 1 张${ITEM_NAME_POINTING}（city_order_adv），x / y 必填，目标须为无主、无 NPC 的空野地，且离其他账号的城池格（分城、名城含在内）至少 ${MOVE_CITY_MIN_GAP} 格（Chebyshev 距离）。道具用 BUY_ITEM 以礼金购买，GET_ITEMS 查看持有数。\n\n拦截顺序（前四条即 GET_STATE moveCity 的 reasons）：名城 MOVE_CITY_FAMOUS → 本城有部队在外（本城发出的行军含返程 / 运输 / 调兵，或派去别人城里的协防）MOVE_CITY_ARMY_OUTSIDE（附 count）→ 盟友协防本城 MOVE_CITY_HAS_ALLY_FORCE（附 count；迁城不会自动遣返，须对方召回或城主 DISMISS_ASSIST）→ 本城或其名下野地有敌情 MOVE_CITY_IN_BATTLE（只看这一座城）→ 目标格不合法 MOVE_CITY_TILE_INVALID / 太近 MOVE_CITY_TOO_CLOSE / 随机选址无空地 MOVE_CITY_NO_SPACE → 道具不足 INSUFFICIENT_ITEM（附 itemId、count）→ 执行时目标被抢先 MOVE_CITY_TILE_TAKEN。以上任何一条失败都不扣道具、不改任何数据。\n\n迁后：新格变成本城（等级 0，同注册落位）；城的建筑、驻军、资源、武将、科技、队列、名下野地与城防 / 免战、联盟、爵位、保护状态全部保留。旧格：主城变回空野地（地形不变，等级按世界生成同口径重新抽取）；分城回归 NPC 城池（等级 = 来源等级，并写入与放弃分城同口径的占回冷却，冷却内不能再占这一格的 NPC 城）。\n\n指定坐标迁（pointing）后 ${LOCK_HOURS} 小时内（按时间缩放），这座城只能运输、调兵、召回、增援自己名下的野地；掠夺、占领、侦察、派协防以及其他攻击类出征都返回 MOVE_CITY_ATTACK_LOCK（附 retryAfterSeconds）。随机迁没有这个限制。迁城不中断也不延长新手保护 / 免战，迁后没有额外保护期。\n\n预览：preview = true 时不改任何数据，返回要消耗的道具、已有数量、目标格、距离、旧格去向与出征限制时长；条件不满足时预览同样返回对应错误码（附原因数据），不会只返回 ok。执行必须携带 confirm = true。`,
  requestFields: [
    { name: 'cityId', type: 'string', desc: '必填。要迁的城 UUID（GET_STATE 的 cities[].id，主城或分城，名城除外）。非本账号名下的城或格式不对返回 INVALID_PARAMS。' },
    { name: 'mode', type: 'string', desc: '必填。random（随机迁，消耗迁城令）或 pointing（指定坐标迁，消耗高级迁城令）；其他值返回 INVALID_PARAMS。' },
    { name: 'x / y', type: 'number', desc: 'mode = pointing 时必填的整数坐标（0..999 范围内，越界返回 INVALID_PARAMS）；random 时忽略。' },
    { name: 'confirm', type: 'boolean', desc: '执行时必填，必须为 true（缺失或不为 true 返回 INVALID_PARAMS）；preview = true 时不需要。' },
    { name: 'preview', type: 'boolean', desc: '可选。true = 只预览，不改任何数据（见 summary）。' },
  ],
  dataFields: [
    { name: 'cityId', type: 'string', desc: '迁走的城 UUID。' },
    { name: 'mode', type: 'string', desc: 'random 或 pointing。' },
    { name: 'from / to', type: 'object', desc: '旧坐标与新坐标 { x, y }。' },
    { name: 'distance', type: 'number', desc: '旧坐标到新坐标的 Chebyshev 距离（不影响消耗，供参考）。' },
    { name: 'itemId', type: 'string', desc: '消耗的道具 id（city_order 或 city_order_adv）。' },
    { name: 'left', type: 'number', desc: '消耗后该道具的剩余数量。' },
    { name: 'oldTile', type: 'string', desc: '旧格去向：wilderness（主城，变空野地）或 npc_city（分城，回归 NPC 城）。' },
    { name: 'moveLockUntil', type: 'string | null', desc: 'pointing 迁后的出征限制截止时刻（ISO 8601）；random 为 null。' },
  ],
  errors: [
    'INVALID_PARAMS',
    'MOVE_CITY_FAMOUS',
    'MOVE_CITY_ARMY_OUTSIDE',
    'MOVE_CITY_HAS_ALLY_FORCE',
    'MOVE_CITY_IN_BATTLE',
    'MOVE_CITY_TILE_INVALID',
    'MOVE_CITY_TILE_TAKEN',
    'MOVE_CITY_TOO_CLOSE',
    'MOVE_CITY_NO_SPACE',
    'INSUFFICIENT_ITEM',
  ],
  examples: [
    {
      caption: '预览指定坐标迁城（主城迁到 (420, 388)，有 1 张高级迁城令）',
      request: { op: Op.MOVE_CITY, seq: 70, data: { cityId: '0b7e5c1a-3d2f-4e8a-9c61-2f4a8d9e1b07', mode: 'pointing', x: 420, y: 388, preview: true } },
      responses: [
        {
          op: Op.MOVE_CITY,
          seq: 70,
          ok: true,
          data: {
            preview: true,
            cityId: '0b7e5c1a-3d2f-4e8a-9c61-2f4a8d9e1b07',
            mode: 'pointing',
            itemId: 'city_order_adv',
            count: 1,
            need: 1,
            from: { x: 512, y: 300 },
            to: { x: 420, y: 388 },
            distance: 92,
            oldTile: 'wilderness',
            attackLockSeconds: 43200,
          },
        },
      ],
    },
    {
      caption: '执行随机迁城（分城回归 NPC 城）',
      request: { op: Op.MOVE_CITY, seq: 71, data: { cityId: '5d1f0c2e-8a6b-4f3d-b7e9-0c2a1d4e6f81', mode: 'random', confirm: true } },
      responses: [
        {
          op: Op.MOVE_CITY,
          seq: 71,
          ok: true,
          data: {
            cityId: '5d1f0c2e-8a6b-4f3d-b7e9-0c2a1d4e6f81',
            mode: 'random',
            from: { x: 300, y: 512 },
            to: { x: 745, y: 129 },
            distance: 445,
            itemId: 'city_order',
            left: 4,
            oldTile: 'npc_city',
            moveLockUntil: null,
          },
        },
      ],
    },
    {
      caption: '离他人城池太近：拒绝，不扣令',
      request: { op: Op.MOVE_CITY, seq: 72, data: { cityId: '0b7e5c1a-3d2f-4e8a-9c61-2f4a8d9e1b07', mode: 'pointing', x: 421, y: 390, confirm: true } },
      responses: [
        { op: Op.MOVE_CITY, seq: 72, ok: false, error: { code: 'MOVE_CITY_TOO_CLOSE', message: '离其他玩家城池太近（需至少间隔 3 格）' } },
      ],
    },
  ],
  agentNote:
    '先 GET_STATE 看 moveCity：reasons 为空且对应道具持有数 ≥ 1 才可迁。指定坐标前先 GET_WORLD_MAP 找空野地，再用 preview = true 预览（看 to、distance、attackLockSeconds），玩家确认后才带 confirm = true 执行。收到 INSUFFICIENT_ITEM 时先 GET_ITEMS，由玩家决定是否 BUY_ITEM。pointing 迁后 12 小时内不要派攻击类部队（会返回 MOVE_CITY_ATTACK_LOCK）；运输、调兵与增援自己的野地不受限。',
};
