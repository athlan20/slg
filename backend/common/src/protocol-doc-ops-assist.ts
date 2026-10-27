// 盟友协防协议的对外文档（DISMISS_ASSIST，v74，AISLG-194）。
// MARCH task=assist 的说明并入 MARCH 文档；规则与上限见 common/src/city-assist.ts。

import { Op } from './protocol';
import { ASSIST_MAX_PER_CITY } from './city-assist';
import type { RequestOpDoc } from './protocol-doc';

const ASSIST_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

export const REQUEST_DISMISS_ASSIST: RequestOpDoc = {
  kind: 'request',
  name: 'DISMISS_ASSIST',
  title: '召回 / 遣返协防部队（v74，AISLG-194）',
  preAuth: false,
  summary: `让一支驻扎在盟友城里的协防部队回出发城：派出方随时可以召回，城主可以遣返任意一支驻扎在自己城里的协防部队。部队原路返回（行军时长按两地距离与编队速度计算，驿站不加速），到达后并回出发城驻军；途中可以被 RECALL_MARCH 折返（折返仍是回出发城）。每座城最多接收 ${ASSIST_MAX_PER_CITY} 支协防部队，同一账号对同一座城最多 1 支；退盟 / 被踢 / 解散与城主放弃分城时相关协防部队自动遣返（事件 assist_returned，cause = ally_left / city_discarded）；分城被占领要求守方全灭，协防部队随城覆灭，派出方收到 assist_returned（cause = wiped，troops 为空、returning 为 null，没有返程行军）。`,
  requestFields: [
    { name: 'assistId', type: 'string', desc: '必填。协防记录 id：派出方看 GET_STATE 的 city.assistOut，城主看 city.assistIn（盟友看 GET_TILE 详情的 assists）。' },
  ],
  dataFields: [
    { name: 'marchId', type: 'string | null', desc: '返程行军 id（可用 RECALL_MARCH 再折返）；部队已不在（城 / 账号被重置）为 null。' },
    { name: 'assistId', type: 'string', desc: '被召回 / 遣返的协防记录 id。' },
  ],
  errors: ['INVALID_PARAMS', 'ASSIST_NOT_FOUND'],
  examples: [
    {
      caption: '城主遣返一支协防部队（或派出方召回）',
      request: { op: Op.DISMISS_ASSIST, seq: 31, data: { assistId: ASSIST_ID } },
      responses: [{ op: Op.DISMISS_ASSIST, seq: 31, ok: true, data: { assistId: ASSIST_ID, marchId: '2f1e3d4c-5b6a-4978-8c9d-0a1b2c3d4e5f' } }],
    },
  ],
  agentNote: '协防部队占派出城的校场出征名额、耗粮由派出城按野外部队 2 倍承担；守城战时与城主驻军合并参战，伤亡按开战时各兵种数量比例分摊（余数归城主）。战斗后派出方会收到一份带 assistLosses 的战报。',
};
