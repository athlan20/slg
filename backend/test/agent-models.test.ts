// Agent 自报模型（v50，AISLG-133）的纯函数单测：LOGIN.agentModel 清洗、自报名归类
// （别名最长优先，防 gpt-5 误吞 gpt-5.5）、模型榜聚合口径（前 10 名平均、未声明 /
// 其他同样成组、零战力不进统计、并列名次规则）。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_MODEL_MAX_LENGTH,
  aggregateModelLeaderboard,
  classifyAgentModel,
  sanitizeAgentModelInput,
  UNDECLARED_AGENT_MODEL,
  OTHER_AGENT_MODEL,
  type AgentPowerStat,
} from '../common/src/agent-models';

test('sanitize：非字符串与空白视为未声明（null，不覆盖已有声明），限长截断', () => {
  assert.equal(sanitizeAgentModelInput(undefined), null);
  assert.equal(sanitizeAgentModelInput(123), null);
  assert.equal(sanitizeAgentModelInput('   '), null);
  assert.equal(sanitizeAgentModelInput('  claude-opus-5-5  '), 'claude-opus-5-5');
  assert.equal(sanitizeAgentModelInput('x'.repeat(80)).length, AGENT_MODEL_MAX_LENGTH);
});

test('归类：null / 空串归「未声明」', () => {
  assert.equal(classifyAgentModel(null).id, UNDECLARED_AGENT_MODEL.id);
  assert.equal(classifyAgentModel(undefined).id, UNDECLARED_AGENT_MODEL.id);
  assert.equal(classifyAgentModel('   ').id, UNDECLARED_AGENT_MODEL.id);
});

test('归类：大小写 / 空格 / 连字符 / 下划线的写法归成同一个模型', () => {
  assert.equal(classifyAgentModel('claude-opus-5-5').id, 'claude-opus-5-5');
  assert.equal(classifyAgentModel('Claude Opus 5.5').id, 'claude-opus-5-5');
  assert.equal(classifyAgentModel('CLAUDE_OPUS_5_5').id, 'claude-opus-5-5');
  assert.equal(classifyAgentModel('  opus 5.5 ').id, 'claude-opus-5-5');
  assert.equal(classifyAgentModel('GPT-5 Turbo').id, 'gpt-5');
});

test('归类：别名最长优先，短版本名不误吞长版本名', () => {
  assert.equal(classifyAgentModel('gpt-5.5').id, 'gpt-5.5', 'gpt-5.5 不能被 gpt-5 抢走');
  assert.equal(classifyAgentModel('glm-5.3').id, 'glm-5.3', 'glm-5.3 不能被 glm-5 抢走');
  assert.equal(classifyAgentModel('glm-5').id, 'glm-5');
  assert.equal(classifyAgentModel('gemini 3 flash').id, 'gemini-3-pro', 'gemini 3 家族别名');
});

test('归类：名单外（自写脚本、未知模型）归「其他」，乱填不影响登录语义', () => {
  assert.equal(classifyAgentModel('自己写的脚本').id, OTHER_AGENT_MODEL.id);
  assert.equal(classifyAgentModel('my-crawler-v2').id, OTHER_AGENT_MODEL.id);
  assert.equal(classifyAgentModel('gpt-9').id, OTHER_AGENT_MODEL.id);
});

function stat(accountId: string, username: string, declared: string | null, power: number): AgentPowerStat {
  return { accountId, username, declared, power };
}

test('聚合：按归类分组，「未声明」与「其他」同样是组', () => {
  const rows = aggregateModelLeaderboard([
    stat('a1', 'alice', 'claude-opus-5-5', 1000),
    stat('a2', 'bob', null, 900),
    stat('a3', 'carol', 'my-script', 800),
  ]);
  assert.deepEqual(
    rows.map((row) => row.modelId).sort(),
    ['claude-opus-5-5', 'other', 'undeclared'],
  );
});

test('聚合：排名 = 该模型实力前 10 名的平均战力（超过 10 个只取前 10）', () => {
  const stats: AgentPowerStat[] = [];
  for (let i = 1; i <= 12; i += 1) {
    stats.push(stat(`g${i}`, `glm-${i}`, 'glm-5.3', i * 100)); // 100..1200，前 10 = 300..1200
  }
  stats.push(stat('u1', 'solo', 'gpt-5', 700));
  const rows = aggregateModelLeaderboard(stats);
  const glm = rows.find((row) => row.modelId === 'glm-5.3');
  assert.equal(glm?.players, 12);
  assert.equal(glm?.value, (300 + 400 + 500 + 600 + 700 + 800 + 900 + 1000 + 1100 + 1200) / 10);
  assert.equal(glm?.topUsername, 'glm-12');
  assert.equal(glm?.topValue, 1200);
  // glm-5.3 组前 10 平均 750 > gpt-5 组单人 700，排在前
  assert.equal(rows[0].modelId, 'glm-5.3');
  assert.equal(rows[0].rank, 1);
});

test('聚合：不足 10 名取全部平均；四舍五入取整', () => {
  const rows = aggregateModelLeaderboard([
    stat('a1', 'alice', 'kimi', 100),
    stat('a2', 'bob', 'kimi-k2', 101),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].modelId, 'kimi-k2');
  assert.equal(rows[0].players, 2);
  assert.equal(rows[0].value, Math.round((100 + 101) / 2));
});

test('聚合：零战力账号不进统计（没兵力的活跃 Agent 不稀释平均、不计数）', () => {
  const rows = aggregateModelLeaderboard([
    stat('a1', 'alice', 'gpt-5', 500),
    stat('a2', 'newbie', 'gpt-5', 0),
  ]);
  assert.equal(rows[0].players, 1);
  assert.equal(rows[0].value, 500);
  assert.equal(rows[0].topUsername, 'alice');
});

test('聚合：并列按账号数降序、展示名排序定名次，rank 连续', () => {
  const rows = aggregateModelLeaderboard([
    stat('a1', 'alice', 'gpt-5', 400),
    stat('b1', 'bob', 'glm-5', 400),
    stat('b2', 'brian', 'glm-5', 400),
  ]);
  assert.equal(rows[0].modelId, 'glm-5', '平均分并列（都 400）时账号多者在前');
  assert.equal(rows[0].value, 400);
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[1].modelId, 'gpt-5');
  assert.deepEqual(
    rows.map((row) => row.rank),
    [1, 2],
  );
});
