// 协议文档渲染器：把 protocol-doc*.ts 清单渲染为 Markdown 与机器可读 JSON manifest。
// 生成脚本（scripts/gen-agent-api.ts）与 API 文档路由共用本模块；渲染是纯函数、
// 协议号按数字升序、字段按清单书写顺序输出，保证「重新生成 + git diff」可作漂移检查。

import { PROTOCOL_VERSION, TROOP_KINDS, type TroopKind } from './protocol';
import { BUILDING_INFO, INITIAL_RESOURCES } from './rules';
import { TROOP_INFO } from './troops';
import { GUIDE_RUNS, nativeAttackGuide } from './native-guide';
import { OP_DOC } from './protocol-doc-ops';
import { CHANGES_PATH_PREFIX } from './protocol-changelog';
import {
  CONNECTION_RULES,
  DOC_META,
  ERROR_DOC,
  FRAME_EXAMPLES,
  GLOSSARY,
  PROTOCOL_COMPAT_POLICY,
  TIME_SCALE_DOC,
  TROOPS_DOC,
  type FieldDoc,
  type OpDoc,
} from './protocol-doc';
import { WALKTHROUGH } from './protocol-doc-walkthrough';

const AS_OP_DOC = OP_DOC as Record<number, OpDoc>;

function opNumbers(): number[] {
  return Object.keys(OP_DOC).map(Number).sort((a, b) => a - b);
}

function jsonBlock(value: unknown): string {
  return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
}

/** Markdown 表格单元格转义：类型写法里的「|」会截断表格列 */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function fieldTable(fields: FieldDoc[]): string[] {
  if (fields.length === 0) {
    return [];
  }
  const rows = fields.map((f) => `| ${cell(f.name)} | ${cell(f.type)} | ${cell(f.desc)} |`);
  return ['| 字段 | 类型 | 说明 |', '| --- | --- | --- |', ...rows, ''];
}

function renderHeader(): string[] {
  return [
    `# ${DOC_META.title}`,
    '',
    `> 协议版本：**${PROTOCOL_VERSION}** · 兼容策略：只加不改（见「版本与兼容」）`,
    '> 本文档由后端协议定义生成（`npm run gen:api-doc`），请勿手工编辑。',
    `> 运行中的服务提供同版本文档：\`GET ${DOC_META.docMdPath}\`（本文件）与 \`GET ${DOC_META.docJsonPath}\`（机器可读清单）。`,
    '> 给 Agent 的用法：把本文件（或 JSON 清单）连同服务器地址与你本账号的 Agent 令牌一起交给 Agent（你只给它令牌，不要给账号密码——Agent 不能密码登录）；它按第 1、2 节连接，用 LOGIN {token, asAgent: true} 登录（接入步骤见 op 1 的 Agent 提示），不要让它自行注册新账号。',
    '',
    `> **Agent 必读：保持文档最新（v32）**——服务端会持续更新。① 记住本文开头的协议版本号（当前 ${PROTOCOL_VERSION}）；② 每次 LOGIN 都在 data 里带上 \`docVersion\`（即该版本号），响应会返回服务端当前的 \`protocolVersion\`，文档落后时还会附 \`docNotice\`；③ 一旦落后，\`GET ${CHANGES_PATH_PREFIX}/{你的版本号}\` 获取此后每个版本的一句话变更（JSON），按需重新下载 \`${DOC_META.docMdPath}\` 全文，并更新你保存的版本号。每次服务端部署都会断开连接，重连登录时就能发现更新。协议只加不改，旧文档不会导致已有操作出错，只是用不上新功能。`,
    '',
    '> **全局时间缩放（v20）**：' + TIME_SCALE_DOC,
    '',
    '## 1. 连接与会话',
    '',
    ...CONNECTION_RULES.map((rule) => `- ${rule}`),
    '',
    '## 2. 消息帧格式',
    '',
    `所有帧均为 UTF-8 JSON 文本帧，单帧不超过 ${DOC_META.maxFrameBytes / 1024}KB。三种帧：`,
    '',
    '**请求帧（客户端 → 服务端）**：`op` 必填；`seq` 可选（正整数，响应原样带回，用于关联请求）；`data` 可选。',
    '',
    jsonBlock(FRAME_EXAMPLES.request),
    '',
    '**响应帧（服务端 → 客户端）**：`op` 与请求一致；`ok` 表示成败；成功带 `data`，失败带 `error`。',
    '',
    jsonBlock(FRAME_EXAMPLES.responseOk),
    '',
    '**失败响应**：`ok: false` + `error: { code, message }`；个别协议的失败响应附 `data`（如 BUILD 附当前城池状态）。**失败响应不含成功载荷字段**（无 `build` / `recruit` / `march` 等键）——客户端必须先判 `ok`：`ok=false` 时按 `error.code` 处理，不要按成功示例的形状解析 `data`。',
    '',
    jsonBlock(FRAME_EXAMPLES.responseError),
    '',
    '**推送帧（服务端 → 客户端）**：`push: true`，无 `seq`，不属于任何请求的响应。`eventId`（v21）为**推送去重键**：账号维度单调递增，同一次业务事件扇出到该账号多连接时各连接收到相同 eventId——客户端记住已见最大 eventId 即可幂等去重，跳号提示漏推（转 GET_EVENTS 补拉）。eventId 不等于事件 id（GET_EVENTS 的 events[].id），两者不可互换使用。',
    '',
    jsonBlock(FRAME_EXAMPLES.push),
    '',
    '## 3. 协议参考',
    '',
    '字段表中嵌套字段以点号路径表示。任何请求在服务端异常时都可能返回 `INTERNAL`（见第 4 节），不重复列入各协议的错误列表。',
    '',
  ];
}

function renderOp(op: number): string[] {
  const doc = AS_OP_DOC[op];
  const lines: string[] = [`### op ${op} · ${doc.name} — ${doc.title}`, ''];
  if (doc.kind === 'request') {
    lines.push(
      '`C→S` 请求-响应 · ' + (doc.preAuth ? '登录前即可发送' : '需登录后发送'),
      '',
      doc.summary,
      '',
      '**请求字段**',
      '',
    );
    if (doc.requestFields.length === 0) {
      lines.push('无请求字段（`data` 可省略）。', '');
    } else {
      lines.push(...fieldTable(doc.requestFields));
    }
    lines.push('**响应 data 字段**', '');
    if (doc.dataFields.length === 0) {
      lines.push('成功响应 `data` 为空对象。', '');
    } else {
      lines.push(...fieldTable(doc.dataFields));
    }
    if (doc.errors.length > 0) {
      lines.push(`**可能错误**：${doc.errors.map((e) => `\`${e}\``).join('、')}（处置建议见第 4 节）`, '');
    }
    if (doc.agentNote) {
      lines.push(`**Agent 提示**：${doc.agentNote}`, '');
    }
    lines.push('**示例**', '');
    for (const group of doc.examples) {
      if (group.caption) {
        lines.push(`**${group.caption}**`, '');
      }
      lines.push('请求：', '', jsonBlock(group.request), '');
      let successIndex = 0;
      const okCount = group.responses.filter((r) => r.ok).length;
      for (const response of group.responses) {
        let label: string;
        if (response.ok) {
          successIndex += 1;
          label = okCount > 1 ? `成功响应 ${successIndex}` : '成功响应';
        } else {
          label = `失败响应（\`${response.error?.code}\`）`;
        }
        lines.push(`${label}：`, '', jsonBlock(response), '');
      }
    }
  } else {
    lines.push('`S→C` 服务端推送 · 无 `seq`', '', doc.summary, '', '**data 字段**', '', ...fieldTable(doc.dataFields));
    if (doc.agentNote) {
      lines.push(`**Agent 提示**：${doc.agentNote}`, '');
    }
    lines.push('**示例**', '');
    doc.examples.forEach((frame) => {
      const marker =
        frame.data.reason !== undefined
          ? String(frame.data.reason)
          : `online=${String((frame.data as { online?: boolean }).online)}`;
      lines.push(`推送（\`${marker}\`）：`, '', jsonBlock(frame), '');
    });
  }
  return lines;
}

function renderErrors(): string[] {
  const rows = Object.entries(ERROR_DOC).map(
    ([code, doc]) => `| \`${code}\` | ${cell(doc.desc)} | ${cell(doc.action)} |`,
  );
  return [
    '## 4. 错误码参考',
    '',
    '所有错误响应的 `error.message` 为人读文案（中文），程序逻辑应依据 `error.code` 判断。',
    '',
    '| 错误码 | 含义 | Agent 处置建议 |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ];
}

function renderWalkthrough(): string[] {
  const lines: string[] = ['## 5. 完整示例会话', '', '同一账号的两条连接（玩家 / Agent），seq 各自独立递增。', ''];
  for (const step of WALKTHROUGH) {
    lines.push(`### ${step.title}`, '', step.explain, '');
    lines.push(...walkthroughFrameLabels(step.frames));
  }
  return lines;
}

function walkthroughFrameLabels(frames: Array<{ kind: string; conn: string; frame: unknown }>): string[] {
  const lines: string[] = [];
  for (const { kind, conn, frame } of frames) {
    const verb = kind === 'request' ? '发送请求' : kind === 'response' ? '收到响应' : '收到推送';
    lines.push(`**${conn} · ${verb}**：`, '', jsonBlock(frame), '');
  }
  return lines;
}

/** 新号开局能凑出的义兵数（扣军营建造成本后按五资源逐项取最小） */
function newbieLine(): string {
  const cost = BUILDING_INFO.barracks.cost;
  const unit = TROOP_INFO.militia.cost;
  let count = Infinity;
  for (const key of ['gold', 'wood', 'food', 'stone', 'iron'] as const) {
    if (unit[key] > 0) {
      count = Math.min(count, Math.floor((INITIAL_RESOURCES[key] - cost[key]) / unit[key]));
    }
  }
  const lv1 = nativeAttackGuide().filter((r) => r.level === 1);
  const nets = lv1.map((r) => r.expectedNet);
  return `新号开局五资源各 ${INITIAL_RESOURCES.gold}，建军营后约可征 ${count} 名义兵——足以稳赢 Lv1 野地（守军义兵 8，带 ${lv1[0].multiple * 8}~${lv1[1].multiple * 8} 名义兵单次净赚约 ${nets[0]}~${nets[1]} 金当量）。`;
}

function renderNativeGuide(): string[] {
  const label = (troops: Partial<Record<TroopKind, number>>): string =>
    TROOP_KINDS.filter((k) => (troops[k] ?? 0) > 0).map((k) => `${TROOP_INFO[k].label} ${troops[k]}`).join(' + ');
  return [
    '### 野地进攻口径（v24，AISLG-48）',
    '',
    '打 Lv N 野地要带多少兵？下表由战斗引擎固定种子模拟生成（每组 ' + GUIDE_RUNS + ' 局），数值调整后随文档重新生成。推荐兵力 = 守军人数的 2 倍 / 3 倍；净收益 = 战利品（受幸存部队负重封顶，四资源按集市 4:1 折金）− 战损成本，单位金当量。守军取**基准编成**；每块野地实际守军在基准上固定 ±20%，出征前建议先 SCOUT 看具体数量，被打残的野地每小时恢复基准的 25%，可趁虚再打。长枪兵 / 弓箭兵需军营 3 / 5 级。',
    '',
    '| 野地等级 | 守军（基准） | 推荐兵力 | 推荐编成 | 胜率 | 单次期望净收益 |',
    '|---|---|---|---|---|---|',
    ...nativeAttackGuide().map(
      (r) => `| Lv${r.level} | ${label(r.garrison)} | ${r.multiple} 倍 | ${label(r.army)} | ${Math.round(r.winRate * 100)}% | ${r.expectedNet >= 0 ? '+' : ''}${r.expectedNet} |`,
    ),
    '',
    newbieLine(),
    '',
  ];
}

function renderTroops(): string[] {
  return [
    '## 6. 兵种与战斗属性',
    '',
    `${TROOPS_DOC.length} 个兵种的单兵战斗属性（v18 起公开；v33 起含二期的铁骑兵 / 辎重车 / 床弩 / 冲车及克制关系）。相对关系可用于编队搭配与出征评估：射程决定能否攻击到目标（近战 10、弓箭 70——纯近战对守方远程可能全场打不到），战斗速度决定行动先后与接敌快慢。伤害与判定的具体算法不对外公开（机制概览见术语表「战斗」）；战报提供逐回合的双方伤害与损失统计。`,
    '',
    '| 兵种 | kind | 生命 | 攻击 | 防御 | 战斗速度 | 射程 | 行军速度系数 | 军营 | 负重 | 人口 | 克制 / 抗性 / 特性 |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...TROOPS_DOC.map(
      (t) =>
        `| ${t.label} | ${t.kind} | ${t.hp} | ${t.atk} | ${t.def} | ${t.speed} | ${t.range} | ${t.marchSpeed} | Lv${t.barracksLevel} | ${t.carry} | ${t.population} | ${t.counter} |`,
    ),
    '',
    '二期兵种定位（v33）：**铁骑兵**军营 11 级解锁的后期重装主力（贵、高粮耗，受长枪克制）；**辎重车**军营 3 级解锁的纯后勤——负重 5000（民夫的 10 倍）、攻击 0，出征 / 运输计入负重，必须有战斗部队护送；**床弩**军营 7 级解锁、射程 95 的反弓箭器械，脆而慢、需近战掩护，**打不到箭塔**（箭塔是不会被消灭的固定输出）；**冲车**军营 8 级解锁、行军最慢（0.6）、负重 0，只在攻城战削弱城墙减伤——冲车每占攻方存活总兵数 1%，守方城墙减伤相对降低 8%，最多降 80%，每回合按当时存活的冲车重新计算，战报 wallBreak 给出开战时的「原减伤 → 破墙后」（例：70% 墙、冲车占 5% → 42%）；野地、流寇等非攻城战斗中冲车只是肉厚攻低的单位。克制倍率表（长枪兵打骑兵 ×1.2、刀盾兵受弓箭兵 / 床弩 ×0.8）在共享规则里，新兵种统一查表。校准记录见 docs/battle-calibration.md「二期兵种」。',
    '',
    '### 编队指南（v21，AISLG-30）',
    '',
    '射程与速度决定接敌节奏：近战（射程 10）需推进 2~3 回合才能接敌，弓箭兵（射程 70）从远端持续输出——**纯近战编成对上含远程的对手时，全程够不到对方远程位，会单方面挨打**。实测反例（v19 线上战报）：守方 22 义兵（全近战）对袭击方 15 义兵 + 2 弓箭兵，守方每单位输出约为对方的 0.61 倍、折损 95%；同引擎批量模拟显示，把袭击方换成纯近战后，守方每单位输出反升至攻方的约 1.3 倍。可操作结论：',
    '',
    '- 编队至少混编 1/4 弓箭兵（远程输出位），或以纯近战只打「确认无远程」的目标（先 SCOUT 侦察 NPC 城与野地编成）；',
    '- 前排承伤（义兵 / 长枪兵 / 刀盾兵）+ 远程输出（弓箭兵）+ 高速反远程（轻骑兵）是通用结构；',
    '- 防守同理：驻军全近战时，来袭方的弓箭兵几乎无风险输出——驻军建议同样混编远程。',
    '',
    ...renderNativeGuide(),
    '战报汇总字段里 `maxRange`（单兵射程最大值）与 `rangedUnits`（远程单位数，射程 > 10）直接给出对方的远程威胁规模；`avgRange` 是数量加权平均，「近战为主 + 少量远程」时会被稀释（如义兵 20 + 弓箭兵 4 的 avgRange 只有 20，而真正的威胁是射程 70 的弓箭兵），不要用它判断克制关系。',
    '',
  ];
}

function renderGlossary(): string[] {
  return [
    '## 7. 术语表',
    '',
    ...GLOSSARY.map((g) => `- **${g.term}**：${g.desc}`),
    '',
  ];
}

function renderVersion(): string[] {
  return [
    '## 8. 版本与兼容',
    '',
    ...PROTOCOL_COMPAT_POLICY.map((p) => `- ${p}`),
    `- 协议版本随对外协议内容的每次变化递增；当前为 ${PROTOCOL_VERSION}。`,
    '- Agent 可在启动时请求 `GET /agent-api.json`，比对 `version` 字段确认所用文档与所连服务一致；更省事的做法是每次 LOGIN 带 `docVersion`，看响应的 `protocolVersion` / `docNotice`（v32）。',
    `- 增量变更：\`GET ${CHANGES_PATH_PREFIX}/{since}\`（也接受 \`?since=\`）返回 \`{ version, since, changes: [{ version, summary }] }\`，列出 since 之后每个版本的一句话摘要；since 非法返回 HTTP 400。`,
    '',
  ];
}

/** 渲染 Markdown 文档（docs/agent-api.md 的内容） */
export function renderAgentApiMarkdown(): string {
  const lines: string[] = [...renderHeader()];
  for (const op of opNumbers()) {
    lines.push(...renderOp(op));
  }
  lines.push(...renderErrors(), ...renderWalkthrough(), ...renderTroops(), ...renderGlossary(), ...renderVersion());
  return lines.join('\n') + '\n';
}

/** 构建机器可读清单对象（GET /agent-api.json 与 docs/agent-api.json 的内容） */
export function buildAgentApiManifest(): Record<string, unknown> {
  return {
    version: PROTOCOL_VERSION,
    title: DOC_META.title,
    compatPolicy: PROTOCOL_COMPAT_POLICY,
    timeScale: TIME_SCALE_DOC,
    endpoints: {
      websocket: DOC_META.wsPath,
      health: DOC_META.healthPath,
      docMarkdown: DOC_META.docMdPath,
      docJson: DOC_META.docJsonPath,
    },
    limits: {
      authTimeoutMsDefault: DOC_META.authTimeoutMsDefault,
      maxFrameBytes: DOC_META.maxFrameBytes,
    },
    troops: TROOPS_DOC,
    connectionRules: CONNECTION_RULES,
    frames: FRAME_EXAMPLES,
    ops: opNumbers().map((op) => ({ op, ...AS_OP_DOC[op] })),
    errorCodes: ERROR_DOC,
    glossary: GLOSSARY,
    walkthrough: WALKTHROUGH,
  };
}

/** 渲染 JSON manifest 字符串 */
export function renderAgentApiManifest(): string {
  return JSON.stringify(buildAgentApiManifest(), null, 2) + '\n';
}
