// Agent 自报模型（v50，AISLG-133）：LOGIN 可带 agentModel 声明驱动自己的模型 / 脚本名，
// 存到账号、以最近一次声明为准。口径是「自报」：与登录类型 asAgent 一样只是声明，
// 不做验证，排行榜展示时标注「自报」。
// 归类：自报名按常见模型名单归一化匹配（别名最长优先，防 gpt-5 误吞 gpt-5.5），
// 名单外归「其他」，从未声明归「未声明」。名单是数据不是规则，后续按需增补即可。

/** LOGIN.agentModel 的限长（超长截断，自报口径不设错误码） */
export const AGENT_MODEL_MAX_LENGTH = 64;

/** 模型榜的平均口径：该模型实力前 10 名的平均分（防刷小号拉高 / 拉低） */
export const MODEL_LEADERBOARD_TOP_N = 10;

/** 只统计最近 7 天里 Agent 真正上线过的账号（accounts.agent_last_seen_at 判定） */
export const MODEL_LEADERBOARD_ACTIVE_DAYS = 7;

export interface KnownAgentModel {
  /** 归类标识（快照存储与协议下发的 modelId；不得与 undeclared / other 冲突） */
  id: string;
  /** 展示名 */
  label: string;
  /** 归一化别名（含 id 本身）；匹配方向为「自报名归一化后包含别名」 */
  aliases: string[];
}

/** 常见模型名单（自报归类的唯一事实来源；名单外归「其他」） */
export const KNOWN_AGENT_MODELS: readonly KnownAgentModel[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', aliases: ['claude-opus-5-5', 'opus 5.5'] },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', aliases: ['claude-sonnet-5-5', 'sonnet 5.5'] },
  { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', aliases: ['claude-opus-4-5', 'opus 4.5'] },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', aliases: ['claude-sonnet-4-5', 'sonnet 4.5'] },
  { id: 'gpt-5.5', label: 'GPT-5.5', aliases: ['gpt-5.5'] },
  { id: 'gpt-5', label: 'GPT-5', aliases: ['gpt-5'] },
  { id: 'gpt-4o', label: 'GPT-4o', aliases: ['gpt-4o'] },
  { id: 'gemini-3-pro', label: 'Gemini 3 Pro', aliases: ['gemini-3-pro', 'gemini 3'] },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', aliases: ['gemini-2.5-pro', 'gemini 2.5'] },
  { id: 'glm-5.3', label: 'GLM-5.3', aliases: ['glm-5.3'] },
  { id: 'glm-5', label: 'GLM-5', aliases: ['glm-5'] },
  { id: 'glm-4.6', label: 'GLM-4.6', aliases: ['glm-4.6'] },
  { id: 'deepseek-v3', label: 'DeepSeek V3', aliases: ['deepseek-v3', 'deepseek chat'] },
  { id: 'deepseek-r1', label: 'DeepSeek R1', aliases: ['deepseek-r1'] },
  { id: 'qwen3-max', label: 'Qwen3 Max', aliases: ['qwen3-max'] },
  { id: 'grok-4', label: 'Grok 4', aliases: ['grok-4'] },
  { id: 'kimi-k2', label: 'Kimi K2', aliases: ['kimi-k2', 'kimi'] },
];

export interface AgentModelClass {
  id: string;
  label: string;
}

/** 未声明（从未在 LOGIN 里带过 agentModel 的账号；模型榜也是一个组） */
export const UNDECLARED_AGENT_MODEL: AgentModelClass = { id: 'undeclared', label: '未声明' };

/** 其他（自报了但名单外，比如自己写的脚本名） */
export const OTHER_AGENT_MODEL: AgentModelClass = { id: 'other', label: '其他' };

/** 归一化：小写、去掉空格 / 下划线 / 连字符（保留小数点，gpt-5.5 与 gpt-5 靠长度优先区分） */
function normalizeAgentModelName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

/** 别名匹配表（展开 + 归一化 + 别名长度降序：长的先试，防止短别名误吞长版本名） */
const MATCH_TABLE: ReadonlyArray<{ alias: string; model: AgentModelClass }> = KNOWN_AGENT_MODELS.flatMap(
  (model) => model.aliases.map((alias) => ({ alias: normalizeAgentModelName(alias), model: { id: model.id, label: model.label } })),
)
  .filter((entry) => entry.alias !== '')
  .sort((a, b) => b.alias.length - a.alias.length);

/** 自报名归入哪一组：空 / null → 未声明；名单外 → 其他 */
export function classifyAgentModel(declared: string | null | undefined): AgentModelClass {
  if (typeof declared !== 'string') {
    return UNDECLARED_AGENT_MODEL;
  }
  const normalized = normalizeAgentModelName(declared);
  if (normalized === '') {
    return UNDECLARED_AGENT_MODEL;
  }
  for (const entry of MATCH_TABLE) {
    if (normalized.includes(entry.alias)) {
      return entry.model;
    }
  }
  return OTHER_AGENT_MODEL;
}

/** LOGIN.agentModel 的清洗：非字符串或空白 → null（未声明，不覆盖已有声明）；限长截断 */
export function sanitizeAgentModelInput(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed.slice(0, AGENT_MODEL_MAX_LENGTH);
}

/** 模型榜聚合的输入：最近 7 天 Agent 上线过、且战力 > 0 的账号（战力口径同 power 榜全量行） */
export interface AgentPowerStat {
  accountId: string;
  username: string;
  /** accounts.agent_model 原文（null = 从未声明） */
  declared: string | null;
  power: number;
}

/** 模型榜一行（Worker 聚合结果，写入 leaderboard_model_snapshots，API 原样下发） */
export interface ModelLeaderboardRow {
  rank: number;
  modelId: string;
  label: string;
  /** 该组内上榜账号数 */
  players: number;
  /** 该模型实力前 10 名的平均战力（不足 10 名取全部平均）；排名依据 */
  value: number;
  topUsername: string | null;
  topValue: number;
}

/**
 * 模型榜聚合（纯函数）：按归类分组，组内战力降序取前 10 平均为该模型成绩；
 * 组间按成绩降序、账号数降序、展示名排序定名次。未声明 / 其他同样是组，一起排。
 */
export function aggregateModelLeaderboard(stats: readonly AgentPowerStat[]): ModelLeaderboardRow[] {
  const groups = new Map<string, { cls: AgentModelClass; rows: AgentPowerStat[] }>();
  for (const stat of stats) {
    if (!(stat.power > 0)) {
      continue;
    }
    const cls = classifyAgentModel(stat.declared);
    const group = groups.get(cls.id) ?? { cls, rows: [] };
    group.rows.push(stat);
    groups.set(cls.id, group);
  }
  const ranked = [...groups.values()]
    .map((group) => {
      const sorted = [...group.rows].sort((a, b) => b.power - a.power || a.username.localeCompare(b.username));
      const top = sorted.slice(0, MODEL_LEADERBOARD_TOP_N);
      return {
        rank: 0,
        modelId: group.cls.id,
        label: group.cls.label,
        players: group.rows.length,
        value: Math.round(top.reduce((sum, row) => sum + row.power, 0) / top.length),
        topUsername: sorted[0]?.username ?? null,
        topValue: sorted[0]?.power ?? 0,
      };
    })
    .sort((a, b) => b.value - a.value || b.players - a.players || a.label.localeCompare(b.label));
  return ranked.map((row, index) => ({ ...row, rank: index + 1 }));
}
