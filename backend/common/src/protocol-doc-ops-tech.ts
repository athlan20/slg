// 科技研究协议的对外文档（GET_TECHS / RESEARCH_TECH / CANCEL_RESEARCH / PUSH_TECH_STATE，v27，AISLG-77）。
// 数值引用 common/src/tech.ts 的真实常量，保证文档与服务端一致；共用示例常量见 protocol-doc-shared.ts。

import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { CITY_ID, STARTED_AT } from './protocol-doc-shared';
import { atBaseTimeScale } from './time-scale';
import {
  MAX_TECH_LEVEL,
  SCOUT_EXACT_LEVEL,
  SCOUT_KINDS_LEVEL,
  TECH_INFO,
  TECH_KINDS,
  researchSeconds,
  techCost,
} from './tech';

const RESEARCH_ID = '7c1d4b52-9e0a-4f6b-8a35-2b1c3d4e5f60';
const FIRST_SECONDS = atBaseTimeScale(() => researchSeconds(1));
const DUE_AT = new Date(Date.parse(STARTED_AT) + FIRST_SECONDS * 1000).toISOString();

const RESEARCH_VIEW = {
  id: RESEARCH_ID,
  cityId: CITY_ID,
  tech: 'farming',
  level: 1,
  status: 'researching',
  initiator: 'player',
  cost: techCost('farming', 1),
  startedAt: STARTED_AT,
  dueAt: DUE_AT,
  completedAt: null,
} as const;

const TECH_TABLE = TECH_KINDS.map((kind) => `${TECH_INFO[kind].label}（${kind}）：${TECH_INFO[kind].effect}`).join('；');

const ENTRY_EXAMPLE = {
  kind: 'farming',
  label: TECH_INFO.farming.label,
  level: 0,
  maxLevel: MAX_TECH_LEVEL,
  percentPerLevel: TECH_INFO.farming.percentPerLevel,
  effect: TECH_INFO.farming.effect,
  currentPercent: 0,
  next: { level: 1, cost: techCost('farming', 1), seconds: FIRST_SECONDS, academyRequired: 1, academyOk: true },
} as const;

export const REQUEST_GET_TECHS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_TECHS',
  title: '查询科技状态（v27，AISLG-77）',
  preAuth: false,
  summary: `查询账号的科技研究：六项科技（${TECH_TABLE}）各自的当前等级、每级效果、下一级的成本 / 耗时 / 书院门槛，以及进行中的研究。科技是**账号共享**的——全账号所有城都生效，只需在任意一座有书院的城研究；同一时间账号只研究一项。每项最高 ${MAX_TECH_LEVEL} 级，第 N 级要求发起研究的城书院（academy 建筑）≥ N 级。可选 data.cityId（缺省主城）指定用哪座城的书院判定 academyOk。成本 = 基础 × 目标等级；耗时 = 建造基准 × 2 × 目标等级，随全局时间缩放。数值均为占位，上线后按数据调整。`,
  requestFields: [
    { name: 'cityId', type: 'string', desc: '可选。指定城池（缺省主城），仅影响 academyLevel 与 academyOk 的判定。' },
  ],
  dataFields: [
    { name: 'academyLevel', type: 'number', desc: '查询城的书院等级（0 = 未建）。' },
    { name: 'techs', type: 'array', desc: '六项科技，每项 { kind, label, level 当前等级, maxLevel, percentPerLevel 每级效果百分数（侦察为 0）, effect 效果说明, currentPercent 当前累计加成百分数, next 下一级信息或 null（满级） }。' },
    { name: 'techs[].next', type: 'object | null', desc: '{ level 目标等级, cost 成本（五资源）, seconds 耗时（秒，已按全局时间缩放折算）, academyRequired 要求的书院等级（= 目标等级）, academyOk 查询城书院是否满足 }；满级为 null。' },
    { name: 'research', type: 'object | null', desc: '账号进行中的研究 { id, cityId 扣资源的城, tech, level 完成后的目标等级, status, initiator, cost 成本快照, startedAt, dueAt, completedAt }；没有为 null。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '开号初始：已建书院 1 级、没有任何科技',
      request: { op: Op.GET_TECHS, seq: 12, data: {} },
      responses: [{ op: Op.GET_TECHS, seq: 12, ok: true, data: { academyLevel: 1, techs: [ENTRY_EXAMPLE, '（其余五项同结构）'], research: null } }],
    },
  ],
  agentNote: `科技规划：书院等级是研究的硬门槛（第 N 级要书院 ≥ N 级），先升书院再研究高级科技。农耕 / 储存直接放大经济，负重 / 行军服务掠夺与出征，侦察决定侦察报告的详细度（Lv${SCOUT_KINDS_LEVEL} 起兵种明细、Lv${SCOUT_EXACT_LEVEL} 起精确数量，之前只有总兵力约数——想精确评估野地 / NPC 城守军先点侦察），城防只加主城守城。研究完成会收到 PUSH_TECH_STATE（reason=research_completed）。`,
};

export const REQUEST_RESEARCH_TECH: RequestOpDoc = {
  kind: 'request',
  name: 'RESEARCH_TECH',
  title: '发起科技研究（v27，AISLG-77）',
  preAuth: false,
  summary: `研究某项科技的下一级：校验通过后立即从发起城扣除成本（可选 data.cityId，缺省主城；书院等级按该城判定），写入研究记录，到期由后台 Worker 完成并让等级账号共享、全城生效。校验顺序：科技已满级 → TECH_LEVEL_MAX；账号已有进行中的研究 → RESEARCH_IN_PROGRESS；发起城书院 < 目标等级 → ACADEMY_TOO_LOW（失败 data 附 academyRequired / academyLevel）；资源不足 → INSUFFICIENT_RESOURCES。失败响应附 city（当前城池状态）。研究生效瞬间，全账号所有城的产量与储量上限按旧等级结算到到期时刻、此后按新等级走（与建筑完工同口径的产量切分）。`,
  requestFields: [
    { name: 'tech', type: `'${TECH_KINDS.join("' | '")}'`, desc: '必填。科技类型；缺失或不是已知类型返回 INVALID_PARAMS。' },
    { name: 'cityId', type: 'string', desc: '可选。发起研究 / 扣资源的城（缺省主城）；非本账号的城返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'research', type: 'object', desc: '新建的研究记录（结构同 GET_TECHS 的 research，status=researching）。' },
  ],
  errors: ['INVALID_PARAMS', 'TECH_LEVEL_MAX', 'RESEARCH_IN_PROGRESS', 'ACADEMY_TOO_LOW', 'INSUFFICIENT_RESOURCES'],
  examples: [
    {
      caption: `研究农耕 Lv1（约 ${FIRST_SECONDS}s 后完成）`,
      request: { op: Op.RESEARCH_TECH, seq: 13, data: { tech: 'farming' } },
      responses: [{ op: Op.RESEARCH_TECH, seq: 13, ok: true, data: { research: RESEARCH_VIEW } }],
    },
    {
      caption: '书院等级不够（研究农耕 Lv2 需要书院 ≥ 2，当前 1 级）',
      request: { op: Op.RESEARCH_TECH, seq: 14, data: { tech: 'farming' } },
      responses: [
        {
          op: Op.RESEARCH_TECH,
          seq: 14,
          ok: false,
          error: { code: 'ACADEMY_TOO_LOW', message: '发起研究的城书院等级不足：第 N 级科技要求书院 ≥ N 级（未建书院按 0 级）' },
          data: { city: '（当前城池状态）', academyRequired: 2, academyLevel: 1 },
        },
      ],
    },
  ],
  agentNote: '同一时间只研究一项：想换研究方向用 CANCEL_RESEARCH（全额返还）。资源不足时按 shortfall 思路自行推算（科技成本 = 基础 × 目标等级）。研究期间别重复发起。',
};

export const REQUEST_CANCEL_RESEARCH: RequestOpDoc = {
  kind: 'request',
  name: 'CANCEL_RESEARCH',
  title: '取消科技研究（v27，AISLG-77）',
  preAuth: false,
  summary: '取消账号进行中的研究并把发起时的成本**全额返还**到发起城（返还不钳储量上限，与建造取消一致）。已到期等待 Worker 结算的研究不可取消（返回 RESEARCH_NOT_CANCELLABLE）。取消成功后同账号其他在线连接收到 PUSH_TECH_STATE（reason=research_cancelled）。',
  requestFields: [
    { name: 'researchId', type: 'string', desc: '可选。研究记录 id；缺省取进行中的那一项。格式非法返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'research', type: 'object', desc: '被取消的研究记录（status=cancelled）。' },
  ],
  errors: ['INVALID_PARAMS', 'RESEARCH_NOT_CANCELLABLE'],
  examples: [
    {
      caption: '取消进行中的研究',
      request: { op: Op.CANCEL_RESEARCH, seq: 15, data: {} },
      responses: [{ op: Op.CANCEL_RESEARCH, seq: 15, ok: true, data: { research: { ...RESEARCH_VIEW, status: 'cancelled' } } }],
    },
  ],
};

export const PUSH_TECH_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_TECH_STATE',
  title: '推送：科技研究状态变化（v27，AISLG-77）',
  summary: '科技研究发起 / 完成 / 取消时推送给账号全部在线连接（发起与取消不回推给发起连接本身——它已经拿到了响应）。完成推送触发后，建议重新 GET_STATE：产量 / 储量上限 / 守城减伤随科技等级即时变化。',
  dataFields: [
    { name: 'reason', type: "'research_started' | 'research_completed' | 'research_cancelled'", desc: '发起 / 完成（等级已生效）/ 取消返还。' },
    { name: 'research', type: 'object', desc: '研究记录视图（结构同 GET_TECHS 的 research）。' },
    { name: 'level', type: 'number', desc: '该科技当前等级（research_completed 时为新等级）。' },
  ],
  examples: [
    { op: Op.PUSH_TECH_STATE, push: true, data: { reason: 'research_completed', research: { ...RESEARCH_VIEW, status: 'completed', completedAt: DUE_AT }, level: 1 } },
  ],
  agentNote: '研究完成事件同时写入事件流（GET_EVENTS 的 research_completed；断线期间的完成用 sinceId 补读）。',
};
