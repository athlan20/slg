// 建造 / 征兵队首激活的共用写法（AISLG-190）。在建 / 征募条目结束（Worker 到点完成，或玩家取消）
// 让出位置后，把各城最早的排队条目转入进行中并按现在重算时间。Worker（queue-tick.ts）与 API 的取消
// 共用本文件，避免两处各写一套规则。调用方须已持有对应城池的行锁（锁序 builds / recruits → cities）。

import type pg from 'pg';
import { MAX_ACTIVE_BUILDS, buildTimeBasis } from './rules';
import { MAX_ACTIVE_RECRUITS } from './troops';
import { getTimeScale } from './time-scale';

/**
 * 把排队建造转入在建（每城最多 MAX_ACTIVE_BUILDS 条）。cityId 为 null 时覆盖全部城（Worker 用）；
 * 时长按条目区分：建造（level=1）用建造时长，升级（level>1）= 建造时长 × 当前等级；
 * 全局缩放与 1 秒下限作用于总时长（与 rules.upgradeSeconds 同口径）。
 */
export async function activateQueuedBuilds<T = Record<string, unknown>>(client: pg.PoolClient, cityId: string | null): Promise<T[]> {
  const buildBasis = buildTimeBasis();
  const act = await client.query(
    `UPDATE builds b SET status = 'building',
        started_at = clock_timestamp(),
        due_at = clock_timestamp() + make_interval(secs => GREATEST(1, FLOOR(
          $1::float8 * (CASE
            WHEN b.level <= 10 THEN (CASE WHEN b.level > 1 THEN b.level - 1 ELSE 1 END)
            ELSE 9 * power(1.3::float8, b.level - 10) END) / $3::float8)))
     WHERE b.id IN (
       SELECT id FROM (
         SELECT q.id, row_number() OVER (PARTITION BY q.city_id ORDER BY q.started_at, q.id) AS rn
         FROM builds q
         WHERE q.status = 'queued'
           AND ($4::uuid IS NULL OR q.city_id = $4::uuid)
           AND NOT EXISTS (
             SELECT 1 FROM builds a WHERE a.city_id = q.city_id AND a.status = 'building'
           )
       ) ranked WHERE ranked.rn <= $2
     )
     RETURNING *`,
    [buildBasis.seconds, MAX_ACTIVE_BUILDS, buildBasis.scale, cityId],
  );
  return act.rows as T[];
}

/**
 * 把排队征兵转入征募中（每城最多 MAX_ACTIVE_RECRUITS 条）。cityId 为 null 时覆盖全部城。
 * 征募时长 = max(1, 基准单兵 × 数量 ÷ time_scale)——下限作用于总时长（unit_seconds 快照为未缩放基准）；
 * 显式 RECRUIT_UNIT_SECONDS 覆盖时不缩放。
 */
export async function activateQueuedRecruits<T = Record<string, unknown>>(client: pg.PoolClient, cityId: string | null): Promise<T[]> {
  const recruitScale = Number.isFinite(Number(process.env.RECRUIT_UNIT_SECONDS)) ? 1 : getTimeScale();
  const act = await client.query(
    `UPDATE recruits r SET status = 'recruiting',
        started_at = clock_timestamp(),
        due_at = clock_timestamp() + make_interval(secs => GREATEST(1, FLOOR(r.unit_seconds * r.count / $1::float8)))
     WHERE r.id IN (
       SELECT id FROM (
         SELECT q.id, row_number() OVER (PARTITION BY q.city_id ORDER BY q.started_at, q.id) AS rn
         FROM recruits q
         WHERE q.status = 'queued'
           AND ($3::uuid IS NULL OR q.city_id = $3::uuid)
           AND NOT EXISTS (
             SELECT 1 FROM recruits a WHERE a.city_id = q.city_id AND a.status = 'recruiting'
           )
       ) ranked WHERE ranked.rn <= $2
     )
     RETURNING *`,
    [recruitScale, MAX_ACTIVE_RECRUITS, cityId],
  );
  return act.rows as T[];
}
