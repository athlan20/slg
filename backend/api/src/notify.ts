// 跨进程完成通知：API 与 Worker 是不同进程，完成消息经 PostgreSQL 传递。
// 主通道是 LISTEN/NOTIFY（Worker 提交后 pg_notify）；另设低频轮询兜底，
// 覆盖 API 重连监听或漏收通知的情况。两路都收敛到同一个 poll()。
// 水位线取数据库时钟；启动前的历史完成不补推，客户端按需查询（第一期约定）。

import pg from 'pg';
import { NOTIFY_CHANNEL, readDbConfig } from '../../common/src/db';
import { Op } from '../../common/src/protocol';
import { loadBattleReport } from '../../common/src/battle-db';
import type { ConnectionRegistry } from './connections';
import { buildView, marchView, recruitView, type BuildRow, type MarchRow, type RecruitRow } from './views';
import { loadWorldWindow } from './views-world';

/** 兜底轮询周期；第一期望延迟与 DB 压力的折中，未做负载评估 */
const POLL_FALLBACK_MS = 5000;
const POLL_BATCH = 200;
const LISTEN_RETRY_MS = 3000;

export class CompletionNotifier {
  private listener: pg.Client | null = null;
  private fallbackTimer: NodeJS.Timeout | null = null;
  /**
   * 完成推送的水位线，保存为 timestamptz 的**文本形式**（微秒精度）。
   * 不能存 JS Date：pg 把 timestamptz 解析成毫秒精度的 Date，列里的微秒尾数被截断后，
   * `completed_at > 水位线` 会对最新一行永远成立——完成推送就会每个兜底周期重复一次
   * （2026-09-27 实测过的缺陷）。文本原样回传 `$1::timestamptz` 比较即精确。
   */
  private watermark: string | null = null;
  /** 征兵完成的独立水位线（timestamptz 文本，微秒精确；理由同 build 水位线） */
  private recruitWatermark: string | null = null;
  /** 行军结算的独立水位线（同上） */
  private marchWatermark: string | null = null;
  private polling = false;
  private pollAgain = false;
  private stopped = false;

  constructor(
    private readonly pool: pg.Pool,
    private readonly registry: ConnectionRegistry,
  ) {}

  async start(): Promise<void> {
    const nowRes = await this.pool.query('SELECT now()::text AS t');
    this.watermark = nowRes.rows[0].t as string;
    this.recruitWatermark = nowRes.rows[0].t as string;
    this.marchWatermark = nowRes.rows[0].t as string;
    await this.connectListener();
    this.fallbackTimer = setInterval(() => {
      void this.poll();
    }, POLL_FALLBACK_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.fallbackTimer) {
      clearInterval(this.fallbackTimer);
    }
    if (this.listener) {
      const listener = this.listener;
      this.listener = null;
      await listener.end().catch(() => undefined);
    }
  }

  private async connectListener(): Promise<void> {
    if (this.stopped) {
      return;
    }
    const client = new pg.Client({ ...readDbConfig(), application_name: 'slg-api-listener' });
    client.on('notification', (msg) => {
      if (msg.channel !== NOTIFY_CHANNEL) {
        return;
      }
      // 载荷区分各类通知：build_completed / recruit_completed 走水位线轮询批量推送；
      // build_started / recruit_started / march_resolved（行军结算）/ tile_changed
      // （地块归属或驻军变化）/ battle_report（v13 战报生成）单条直推——漏收时客户端
      // 也会在按需查询里拿到最新状态
      let payload: {
        reason?: string;
        accountId?: string;
        buildId?: string;
        recruitId?: string;
        marchId?: string;
        reportId?: number;
        x?: number;
        y?: number;
        tileReason?: string;
        /** reason='server_broadcast'（v23 AISLG-60）时的播报视图 */
        broadcast?: import('../../common/src/server-broadcast').ServerBroadcastCreated;
        /** reason='npc_warning'（v23 AISLG-57）时的预警载荷（完整推送 data） */
        data?: Record<string, unknown>;
      } = {};
      try {
        payload = msg.payload ? JSON.parse(msg.payload) : {};
      } catch {
        // 兼容非 JSON 载荷：按完成通知处理
      }
      if (payload.reason === 'server_broadcast' && payload.broadcast) {
        // 全服播报（v23 AISLG-60）：广而告之所有在线连接
        this.registry.broadcastAll({
          op: Op.PUSH_SERVER_BROADCAST,
          push: true,
          data: { broadcast: payload.broadcast },
        });
        return;
      }
      if (payload.reason === 'npc_warning' && payload.accountId && payload.data) {
        // NPC 袭击预警（v23 AISLG-57）：推给被袭击账号的全部在线连接（含 Agent 连接）
        this.registry.broadcast(payload.accountId, {
          op: Op.PUSH_NPC_ATTACK_WARNING,
          push: true,
          data: payload.data as Record<string, unknown>,
        });
        return;
      }
      if (payload.reason === 'starvation' && payload.accountId && payload.data) {
        // 断粮预警 / 哗变（v34 AISLG-107）：推给该账号的全部在线连接（含 Agent）
        this.registry.broadcast(payload.accountId, {
          op: Op.PUSH_STARVATION_STATE,
          push: true,
          data: payload.data as Record<string, unknown>,
        });
        return;
      }
      if (payload.reason === 'yt_state' && payload.data) {
        // 黄巾之乱起事 / 进度 / 老巢出现 / 收场（v29 AISLG-76）：全服广播
        this.registry.broadcastAll({
          op: Op.PUSH_YELLOW_TURBAN_STATE,
          push: true,
          data: payload.data as Record<string, unknown>,
        });
        return;
      }
      if (payload.reason === 'moving_target' && payload.data) {
        // 移动目标刷出 / 被截获 / 消失（v28 AISLG-78）：全服广播，客户端据此重拉列表
        this.registry.broadcastAll({
          op: Op.PUSH_MOVING_TARGET_STATE,
          push: true,
          data: payload.data as Record<string, unknown>,
        });
        return;
      }
      if (payload.reason === 'tech_state' && payload.accountId && payload.data) {
        // 科技研究完成（v27，AISLG-77）：推给账号全部在线连接，客户端据此重拉科技与城池状态
        this.registry.broadcast(payload.accountId, {
          op: Op.PUSH_TECH_STATE,
          push: true,
          data: payload.data as Record<string, unknown>,
        });
        return;
      }
      if (payload.reason === 'hero_state' && payload.accountId && payload.data) {
        // 武将状态变化（v36，AISLG-114/115/116：欠饷 / 恢复 / 重伤 / 经验 / 名将授予）：
        // 推给账号全部在线连接（含 Agent），客户端据此重拉 GET_HEROES
        this.registry.broadcast(payload.accountId, {
          op: Op.PUSH_HERO_STATE,
          push: true,
          data: payload.data as Record<string, unknown>,
        });
        return;
      }
      if (payload.reason === 'build_started' && payload.accountId && payload.buildId) {
        void this.pushActivatedBuild(payload.accountId, payload.buildId);
        return;
      }
      if (payload.reason === 'recruit_started' && payload.accountId && payload.recruitId) {
        void this.pushActivatedRecruit(payload.accountId, payload.recruitId);
        return;
      }
      if (payload.reason === 'march_resolved' && payload.accountId && payload.marchId) {
        void this.pushResolvedMarch(payload.accountId, payload.marchId);
        return;
      }
      if (payload.reason === 'battle_report' && payload.accountId) {
        // reportId 在 JSON 里可能是数字或数字字符串（历史 bigserial 序列化差异），统一归一化
        const reportId = Number(payload.reportId);
        if (Number.isInteger(reportId) && reportId > 0) {
          void this.pushBattleReport(payload.accountId, reportId);
          return;
        }
      }
      if (
        payload.reason === 'tile_changed' &&
        payload.accountId &&
        Number.isInteger(payload.x) &&
        Number.isInteger(payload.y) &&
        payload.tileReason
      ) {
        void this.pushTileChanged(payload.accountId, payload.x as number, payload.y as number, payload.tileReason);
        return;
      }
      // build_completed 与 recruit_completed 各走各的水位线轮询
      void this.poll();
    });
    client.on('error', (err) => {
      console.error('listener error, retrying:', err.message);
      this.scheduleReconnect();
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
      this.listener = client;
    } catch (err) {
      console.error('listener connect failed, retrying:', err instanceof Error ? err.message : err);
      await client.end().catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  /** 队列激活直推：按 id 取已激活为 building 的建造并广播 build_started */
  private async pushActivatedBuild(accountId: string, buildId: string): Promise<void> {
    if (this.stopped) {
      return;
    }
    try {
      const res = await this.pool.query(
        `SELECT * FROM builds WHERE id = $1 AND status = 'building'`,
        [buildId],
      );
      if (res.rowCount) {
        this.registry.broadcast(accountId, {
          op: Op.PUSH_BUILD_STATE,
          push: true,
          data: { reason: 'build_started', build: buildView(res.rows[0] as BuildRow) },
        });
      }
    } catch (err) {
      console.error('push activated build failed:', err instanceof Error ? err.message : err);
    }
  }

  /** 行军结算直推：按 id 取已结算的行军并广播到达 / 回城（漏收由水位线轮询兜底） */
  private async pushResolvedMarch(accountId: string, marchId: string): Promise<void> {
    if (this.stopped) {
      return;
    }
    try {
      const res = await this.pool.query(
        `SELECT * FROM marches WHERE id = $1 AND status IN ('arrived', 'returned')`,
        [marchId],
      );
      if (res.rowCount) {
        this.pushMarchRow(accountId, res.rows[0] as MarchRow);
      }
    } catch (err) {
      console.error('push resolved march failed:', err instanceof Error ? err.message : err);
    }
  }

  /** 地块变化直推：取最新地块视图广播（PUSH_TILE_STATE） */
  private async pushTileChanged(
    accountId: string,
    x: number,
    y: number,
    tileReason: string,
  ): Promise<void> {
    if (this.stopped) {
      return;
    }
    try {
      const tiles = await loadWorldWindow(this.pool, x, y, 1, 1, accountId);
      if (tiles.length > 0) {
        this.registry.broadcast(accountId, {
          op: Op.PUSH_TILE_STATE,
          push: true,
          data: { reason: tileReason, tile: tiles[0] },
        });
      }
    } catch (err) {
      console.error('push tile changed failed:', err instanceof Error ? err.message : err);
    }
  }

  /** 战报生成直推：按 id 取战报并广播 PUSH_BATTLE_REPORT（v13；漏收由按需查询覆盖） */
  private async pushBattleReport(accountId: string, reportId: number): Promise<void> {
    if (this.stopped) {
      return;
    }
    try {
      const report = await loadBattleReport(this.pool, accountId, reportId);
      if (report) {
        this.registry.broadcast(accountId, {
          op: Op.PUSH_BATTLE_REPORT,
          push: true,
          data: { report },
        });
      } else {
        console.error('push battle report skipped: report not found', accountId, reportId);
      }
    } catch (err) {
      console.error('push battle report failed:', err instanceof Error ? err.message : err);
    }
  }

  private marchPushReason(row: MarchRow): 'march_arrived' | 'march_returned' {
    return row.status === 'returned' ? 'march_returned' : 'march_arrived';
  }

  /**
   * 行军结算推送去重（AISLG-51）：march_resolved 既有 notify 直推、又有水位线轮询
   * 兜底，两路都会覆盖同一条结算——各自 broadcast 会生成不同 eventId，客户端按
   * eventId 去重时一次到达/返程被当成两次。同一 (marchId, resolved_at) 只广播一次；
   * Map 按插入序淘汰，容量只需覆盖一个轮询周期内可能结算的行军量。
   */
  private readonly marchPushedKeys = new Map<string, true>();
  private static readonly MARCH_PUSH_KEY_CAP = 1024;

  private pushMarchRow(accountId: string, row: MarchRow): void {
    const key = `${row.id}:${row.resolved_at ? row.resolved_at.getTime() : ''}`;
    if (this.marchPushedKeys.has(key)) {
      this.marchPushedKeys.delete(key);
      return;
    }
    this.marchPushedKeys.set(key, true);
    if (this.marchPushedKeys.size > CompletionNotifier.MARCH_PUSH_KEY_CAP) {
      const oldest = this.marchPushedKeys.keys().next().value;
      if (oldest !== undefined) {
        this.marchPushedKeys.delete(oldest);
      }
    }
    this.registry.broadcast(accountId, {
      op: Op.PUSH_MARCH_STATE,
      push: true,
      data: { reason: this.marchPushReason(row), march: marchView(row) },
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }
    if (this.listener) {
      const listener = this.listener;
      this.listener = null;
      void listener.end().catch(() => undefined);
    }
    setTimeout(() => {
      void this.connectListener();
    }, LISTEN_RETRY_MS).unref?.();
  }

  /** 队列激活直推：按 id 取已激活为 recruiting 的征兵并广播 recruit_started */
  private async pushActivatedRecruit(accountId: string, recruitId: string): Promise<void> {
    if (this.stopped) {
      return;
    }
    try {
      const res = await this.pool.query(
        `SELECT * FROM recruits WHERE id = $1 AND status = 'recruiting'`,
        [recruitId],
      );
      if (res.rowCount) {
        this.registry.broadcast(accountId, {
          op: Op.PUSH_RECRUIT_STATE,
          push: true,
          data: { reason: 'recruit_started', recruit: recruitView(res.rows[0] as RecruitRow) },
        });
      }
    } catch (err) {
      console.error('push activated recruit failed:', err instanceof Error ? err.message : err);
    }
  }

  /** 查询水位线之后完成的建造并推送给账号在线连接。单飞：并发触发时只跑一次，结束后补跑。 */
  async poll(): Promise<void> {
    if (this.stopped || !this.watermark) {
      return;
    }
    if (this.polling) {
      this.pollAgain = true;
      return;
    }
    this.polling = true;
    try {
      let again = true;
      while (again && !this.stopped) {
        // 显式标注结果类型：循环内会把 this.watermark 回写为行字段，隐式推断会成环（TS7022）
        const res: pg.QueryResult<BuildRow & { completed_at_text: string }> = await this.pool.query(
          `SELECT *, completed_at::text AS completed_at_text FROM builds
           WHERE status = 'completed' AND completed_at IS NOT NULL AND completed_at > $1::timestamptz
           ORDER BY completed_at ASC
           LIMIT $2`,
          [this.watermark, POLL_BATCH],
        );
        for (const row of res.rows) {
          this.registry.broadcast(row.account_id, {
            op: Op.PUSH_BUILD_STATE,
            push: true,
            data: { reason: 'build_completed', build: buildView(row) },
          });
          this.watermark = row.completed_at_text;
        }
        again = res.rows.length === POLL_BATCH || this.pollAgain;
        this.pollAgain = false;
      }
      await this.pollCompletedRecruits();
      await this.pollResolvedMarches();
    } catch (err) {
      console.error('completion poll failed:', err instanceof Error ? err.message : err);
    } finally {
      this.polling = false;
    }
  }

  /** 征兵完成轮询（与建造共用单飞；水位线独立、同样取微秒精确文本） */
  private async pollCompletedRecruits(): Promise<void> {
    if (this.stopped || !this.recruitWatermark) {
      return;
    }
    let again = true;
    while (again && !this.stopped) {
      const res: pg.QueryResult<RecruitRow & { completed_at_text: string }> = await this.pool.query(
        `SELECT *, completed_at::text AS completed_at_text FROM recruits
         WHERE status = 'completed' AND completed_at IS NOT NULL AND completed_at > $1::timestamptz
         ORDER BY completed_at ASC
         LIMIT $2`,
        [this.recruitWatermark, POLL_BATCH],
      );
      for (const row of res.rows) {
        this.registry.broadcast(row.account_id, {
          op: Op.PUSH_RECRUIT_STATE,
          push: true,
          data: { reason: 'recruit_completed', recruit: recruitView(row) },
        });
        this.recruitWatermark = row.completed_at_text;
      }
      again = res.rows.length === POLL_BATCH || this.pollAgain;
      this.pollAgain = false;
    }
  }

  /** 行军结算轮询（与建造 / 征兵共用单飞；水位线独立、同样取微秒精确文本） */
  private async pollResolvedMarches(): Promise<void> {
    if (this.stopped || !this.marchWatermark) {
      return;
    }
    let again = true;
    while (again && !this.stopped) {
      const res: pg.QueryResult<MarchRow & { resolved_at_text: string }> = await this.pool.query(
        `SELECT *, resolved_at::text AS resolved_at_text FROM marches
         WHERE resolved_at IS NOT NULL AND resolved_at > $1::timestamptz
         ORDER BY resolved_at ASC
         LIMIT $2`,
        [this.marchWatermark, POLL_BATCH],
      );
      for (const row of res.rows) {
        this.pushMarchRow(row.account_id, row);
        this.marchWatermark = row.resolved_at_text;
      }
      again = res.rows.length === POLL_BATCH || this.pollAgain;
      this.pollAgain = false;
    }
  }
}
