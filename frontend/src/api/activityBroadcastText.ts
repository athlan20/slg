// 活动 / 玩法节点播报的文案（v112，AISLG-260）：聊天「活动」页签里的几句话。
// 后端只给 type + detail（不写死中文），这里按当前语言拼；命中的类型返回文案，其余返回 null
// （由 api/mapping-world.ts 的 serverBroadcastText 继续走系统播报那套 / 默认兜底）。
// 单独成文件以控制 mapping-world.ts 的行数（与 fogText / stratagemText 同一做法）。

import { getCopy } from '../i18n/bundle';
import { getLang } from '../i18n/lang';
import { tName } from '../i18n/names';
import { formatClock } from './format';

/** 时刻（播报里的「几点」）：缺省给问号，不抛错 */
function clockOf(value: unknown): string {
  return typeof value === 'string' && value ? formatClock(value) : '?';
}

/** 剧本战场剧本名的展示名（detail 里没有 script 的旧记录返回 null，按不显示剧本名降级） */
function battlefieldScriptLabel(script: unknown): string | null {
  const { BATTLEFIELD_COPY } = getCopy();
  return typeof script === 'string' && script in BATTLEFIELD_COPY.scripts
    ? BATTLEFIELD_COPY.scripts[script as keyof typeof BATTLEFIELD_COPY.scripts]
    : null;
}

/** 赤壁风向的展示名 */
function battlefieldWindText(wind: unknown): string {
  const { BATTLEFIELD_COPY } = getCopy();
  return typeof wind === 'string' && wind in BATTLEFIELD_COPY.wind.dir
    ? BATTLEFIELD_COPY.wind.dir[wind as keyof typeof BATTLEFIELD_COPY.wind.dir]
    : String(wind ?? '');
}

/** 洛阳播报（v79 / AISLG-200）：按 detail.phase 拼一句话 */
function luoyangBroadcastText(detail: Record<string, unknown>): string {
  const { LUOYANG_COPY, EXTRA_STATE } = getCopy();
  switch (detail.phase) {
    case 'soon':
      return LUOYANG_COPY.broadcast.soon(clockOf(detail.startAt), clockOf(detail.endAt));
    case 'started':
      return LUOYANG_COPY.broadcast.started(clockOf(detail.endAt));
    case 'ended':
      return LUOYANG_COPY.broadcast.ended();
    case 'holder':
      return LUOYANG_COPY.broadcast.holder(
        String(detail.username ?? EXTRA_STATE.mapping.unknownPlayer),
        typeof detail.allianceName === 'string' && detail.allianceName ? detail.allianceName : null,
      );
    case 'decree': {
      const kind = String(detail.decreeKind ?? '');
      return LUOYANG_COPY.broadcast.decree(
        LUOYANG_COPY.decree.kinds[kind as keyof typeof LUOYANG_COPY.decree.kinds] ?? kind,
        clockOf(detail.until),
      );
    }
    default:
      return EXTRA_STATE.broadcast.headline('luoyang_window');
  }
}

/** 势力名（按界面语言挑；本季没放的那几家在 detail.skipped 里带 name / nameEn） */
function factionName(item: { name?: unknown; nameEn?: unknown }): string {
  const name = typeof item.name === 'string' ? item.name : '';
  const nameEn = typeof item.nameEn === 'string' ? item.nameEn : '';
  return getLang() === 'en' ? nameEn || name : name || nameEn;
}

/** 活动 / 玩法节点播报（v112）：命中返回文案，其余类型返回 null */
export function activityBroadcastText(view: { type: string; detail: Record<string, unknown> }): string | null {
  const { EXTRA_STATE, EXTRA_MAP, BATTLEFIELD_COPY, SEASON_COPY } = getCopy();
  const detail = view.detail;
  switch (view.type) {
    case 'battlefield_signup':
      // 报名开始（detail = { script, signupStartAt, startAt, endAt }；旧记录没有 script）
      return BATTLEFIELD_COPY.broadcast.signup(
        battlefieldScriptLabel(detail.script),
        clockOf(detail.startAt),
        clockOf(detail.endAt),
      );
    case 'battlefield_start_soon':
      // 开战前 1 小时提醒（detail = { script, startAt }）
      return BATTLEFIELD_COPY.broadcast.startSoon(battlefieldScriptLabel(detail.script), clockOf(detail.startAt));
    case 'battlefield_started':
      // 开战（detail = { script, startAt, endAt }；旧记录没有 script）
      return BATTLEFIELD_COPY.broadcast.started(battlefieldScriptLabel(detail.script), clockOf(detail.endAt));
    case 'battlefield_stronghold':
      // v75：据点易手（detail = { username, name, firstCapture }）
      return BATTLEFIELD_COPY.broadcast.stronghold(
        String(detail.username ?? EXTRA_STATE.mapping.unknownPlayer),
        tName(String(detail.name ?? '?')),
        detail.firstCapture === true,
      );
    case 'battlefield_wind':
      // 赤壁风向切换前 30 分钟预告（detail = { script, switchAt, nextWind }）
      return BATTLEFIELD_COPY.broadcast.wind(battlefieldWindText(detail.nextWind), clockOf(detail.switchAt));
    case 'battlefield_finished':
      // v75：收场（detail = { winner, scoreYuan, scoreCao }）
      return BATTLEFIELD_COPY.broadcast.finished(
        detail.winner === 'yuan' || detail.winner === 'cao' ? detail.winner : null,
        Math.floor(Number(detail.scoreYuan ?? 0)),
        Math.floor(Number(detail.scoreCao ?? 0)),
      );
    case 'luoyang_window':
      return luoyangBroadcastText(detail);
    case 'faction_season_started': {
      // 五方势力本季启用（detail = { placed, skipped: [{ key, name, nameEn }] }）
      const skipped = Array.isArray(detail.skipped)
        ? (detail.skipped as Array<{ name?: unknown; nameEn?: unknown }>).map(factionName).filter((name) => name !== '')
        : [];
      return EXTRA_MAP.faction.broadcastSeasonStarted(
        Number(detail.placed ?? 0),
        skipped.join(getLang() === 'en' ? ', ' : '、'),
      );
    }
    case 'season_ending': {
      // 赛季临近结束（detail = { seasonId, seasonName, endAt, stage }）：英文界面按赛季编号，不用中文赛季名
      const stage = SEASON_COPY.broadcastEndingStage[String(detail.stage ?? '')] ?? '';
      return SEASON_COPY.broadcastEnding(Number(detail.seasonId ?? 0), stage, clockOf(detail.endAt));
    }
    default:
      return null;
  }
}