// 运维脚本：聊天禁言（AISLG-138，v51）。禁言截止时刻存在 accounts.chat_muted_until，
// 发言时实时读取，设置后立即生效、到点自动恢复，无需重启；禁言期间世界与私聊都发不出去（读不受影响）。
//
// 运行（在 backend/ 目录）：
//   npx tsx --env-file=.env scripts/chat-mute.ts <用户名>            # 查看当前禁言状态
//   npx tsx --env-file=.env scripts/chat-mute.ts <用户名> 60         # 从现在起禁言 60 分钟
//   npx tsx --env-file=.env scripts/chat-mute.ts <用户名> 0          # 解除禁言

import { createPool, ensureSchema } from '../common/src/db';

/** 单次禁言的上限（分钟）：一年，防止误输入造成永久禁言 */
const MAX_MINUTES = 60 * 24 * 365;

async function main(): Promise<void> {
  const username = process.argv[2];
  const minutesArg = process.argv[3];
  if (!username) {
    throw new Error('用法：chat-mute.ts <用户名> [禁言分钟数，0 = 解除]');
  }
  const minutes = minutesArg === undefined ? undefined : Number(minutesArg);
  if (minutes !== undefined && (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MINUTES)) {
    throw new Error(`禁言分钟数必须是 0 到 ${MAX_MINUTES} 之间的整数`);
  }

  const pool = createPool('chat-mute', 1);
  try {
    // chat_muted_until 列由 ensureSchema 幂等补齐（与 API / Worker 启动同一套 DDL），脚本可独立运行
    await ensureSchema(pool);
    const account = await pool.query(
      `SELECT id, username, chat_muted_until FROM accounts WHERE username = $1`,
      [username],
    );
    if (!account.rowCount) {
      throw new Error(`账号不存在：${username}`);
    }
    const row = account.rows[0] as { id: string; username: string; chat_muted_until: Date | null };

    if (minutes === undefined) {
      const until = row.chat_muted_until;
      const muted = until !== null && until.getTime() > Date.now();
      console.log(muted ? `${username} 禁言中，截止 ${until!.toISOString()}` : `${username} 未禁言`);
      return;
    }
    if (minutes === 0) {
      await pool.query(`UPDATE accounts SET chat_muted_until = NULL WHERE id = $1`, [row.id]);
      console.log(`${username} 已解除禁言`);
      return;
    }
    const res = await pool.query(
      `UPDATE accounts SET chat_muted_until = now() + make_interval(mins => $2) WHERE id = $1 RETURNING chat_muted_until`,
      [row.id, minutes],
    );
    const until = (res.rows[0] as { chat_muted_until: Date }).chat_muted_until;
    console.log(`${username} 已禁言 ${minutes} 分钟，截止 ${until.toISOString()}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
