// 运维脚本：公告的列表、发布、修改、撤回（AISLG-162，v60）。没有后台页面，所有操作走这里。
// 生效中的公告立即推送给在线玩家与 Agent（PUSH_ANNOUNCEMENT）；--chat 时同时在全服播报里发一句标题。
// 修改与撤回不推送。撤回只是隐藏（记录保留）。正文按受限 Markdown 过滤：分段、**加粗**、[文字](https 链接)。
//
// 运行（在 backend/ 目录）：
//   npx tsx --env-file=.env scripts/announcement.ts list [--all]
//   npx tsx --env-file=.env scripts/announcement.ts publish --category system --title-zh "周日停服维护" --body-zh-file notice.md --strong on --pinned on
//   npx tsx --env-file=.env scripts/announcement.ts publish --category event --title-zh "金秋福利" --body-zh "签到双倍" --title-en "Autumn bonus" --body-en "Double sign-in" --ends-at 2026-10-31T23:59:59+08:00
//   npx tsx --env-file=.env scripts/announcement.ts edit 12 --ends-at none
//   npx tsx --env-file=.env scripts/announcement.ts withdraw 12
//
// 选项：
//   --category system|event   分类，缺省 system（系统公告 / 活动公告）
//   --title-zh / --body-zh / --body-zh-file   中文标题与正文（publish 必填，正文二选一）
//   --title-en / --body-en / --body-en-file   英文（标题与正文须成对给出；没填则显示中文）
//   --pinned on|off           置顶，缺省 off
//   --strong on|off           强提醒（玩家进主界面弹窗，点「知道了」才算已读），缺省 off
//   --host <域名>              站点定向，如 slg.yuntianyou.cc；缺省全站
//   --starts-at <ISO 时间>     生效时间，缺省现在；将来的时间不推送，到点后玩家拉取列表时出现
//   --ends-at <ISO 时间>|none  结束时间，过了自动进入往期；none 清空（edit 用）
//   --chat                    同时全服播报标题（publish 专用；只能即时生效且全站）

import { readFileSync } from 'node:fs';
import { createPool, ensureSchema } from '../common/src/db';
import { normalizeAnnouncementBody, normalizeAnnouncementTitle } from '../common/src/announcement-body';
import {
  listAnnouncementsForOps,
  publishAnnouncement,
  updateAnnouncement,
  withdrawAnnouncement,
  type AnnouncementDraft,
  type AnnouncementPatch,
  type OpsAnnouncementRow,
} from '../common/src/announcement-publish';
import { ANNOUNCEMENT_CATEGORIES, type AnnouncementCategory } from '../common/src/protocol-announcement';

const USAGE = '用法：announcement.ts list [--all] | publish ... | edit <id> ... | withdraw <id>（见文件头注释）';

type Options = Map<string, string>;
const FLAG_ONLY = new Set(['--chat', '--all']);

function parseArgs(argv: string[]): { positional: string[]; options: Options; flags: Set<string> } {
  const positional: string[] = [];
  const options: Options = new Map();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    if (FLAG_ONLY.has(arg)) {
      flags.add(arg);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`选项 ${arg} 缺少取值`);
    }
    options.set(arg, value);
    i += 1;
  }
  return { positional, options, flags };
}

/** 读取中文或英文正文：--xx 与 --xx-file 二选一；都没有返回 undefined */
function readBody(options: Options, name: string): string | undefined {
  const inline = options.get(`--${name}`);
  const file = options.get(`--${name}-file`);
  if (inline !== undefined && file !== undefined) {
    throw new Error(`--${name} 与 --${name}-file 只能给一个`);
  }
  return file !== undefined ? readFileSync(file, 'utf8') : inline;
}

function onOff(options: Options, name: string): boolean | undefined {
  const value = options.get(name);
  if (value === undefined) {
    return undefined;
  }
  if (value !== 'on' && value !== 'off') {
    throw new Error(`${name} 只接受 on 或 off`);
  }
  return value === 'on';
}

function isoTime(options: Options, name: string): Date | undefined {
  const value = options.get(name);
  if (value === undefined || value === 'none') {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} 不是合法的时间：${value}`);
  }
  return date;
}

function category(options: Options): AnnouncementCategory | undefined {
  const value = options.get('--category');
  if (value === undefined) {
    return undefined;
  }
  if (!(ANNOUNCEMENT_CATEGORIES as readonly string[]).includes(value)) {
    throw new Error(`--category 只接受 ${ANNOUNCEMENT_CATEGORIES.join(' / ')}`);
  }
  return value as AnnouncementCategory;
}

function host(options: Options): string | null | undefined {
  const value = options.get('--host');
  if (value === undefined) {
    return undefined;
  }
  if (value === 'none') {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(normalized)) {
    throw new Error(`--host 不是合法的域名：${value}`);
  }
  return normalized;
}

/** 英文成对校验：标题与正文要么都给，要么都不给（清空用 edit 的 none 另行处理） */
function englishPair(options: Options): { titleEn: string | null; bodyEn: string | null } | undefined {
  const titleRaw = options.get('--title-en');
  const bodyRaw = readBody(options, 'body-en');
  if (titleRaw === undefined && bodyRaw === undefined) {
    return undefined;
  }
  if (titleRaw === undefined || bodyRaw === undefined) {
    throw new Error('英文标题与英文正文须成对给出');
  }
  const titleEn = normalizeAnnouncementTitle(titleRaw);
  const bodyEn = normalizeAnnouncementBody(bodyRaw);
  if (!titleEn) {
    throw new Error('英文标题不合法（非空，不超过 30 字）');
  }
  if (!bodyEn) {
    throw new Error('英文正文过滤后为空，或超过 4000 字');
  }
  return { titleEn, bodyEn };
}

function buildDraft(options: Options, flags: Set<string>): AnnouncementDraft {
  const titleZh = normalizeAnnouncementTitle(options.get('--title-zh') ?? '');
  if (!titleZh) {
    throw new Error('--title-zh 必填，且非空、不超过 30 字');
  }
  const bodyZh = normalizeAnnouncementBody(readBody(options, 'body-zh') ?? '');
  if (!bodyZh) {
    throw new Error('--body-zh 或 --body-zh-file 必填，过滤后非空且不超过 4000 字');
  }
  const en = englishPair(options);
  const startsAt = isoTime(options, '--starts-at') ?? new Date();
  const endsAt = isoTime(options, '--ends-at') ?? null;
  if (endsAt && endsAt <= startsAt) {
    throw new Error('结束时间必须晚于生效时间');
  }
  return {
    category: category(options) ?? 'system',
    titleZh,
    bodyZh,
    titleEn: en?.titleEn ?? null,
    bodyEn: en?.bodyEn ?? null,
    pinned: onOff(options, '--pinned') ?? false,
    strongRemind: onOff(options, '--strong') ?? false,
    host: host(options) ?? null,
    startsAt,
    endsAt,
    chat: flags.has('--chat'),
  };
}

function buildPatch(options: Options): AnnouncementPatch {
  const patch: AnnouncementPatch = {};
  const cat = category(options);
  if (cat) patch.category = cat;
  const titleZh = options.get('--title-zh');
  if (titleZh !== undefined) {
    patch.titleZh = normalizeAnnouncementTitle(titleZh) ?? throwError('--title-zh 不合法（非空，不超过 30 字）');
  }
  const bodyZh = readBody(options, 'body-zh');
  if (bodyZh !== undefined) {
    patch.bodyZh = normalizeAnnouncementBody(bodyZh) ?? throwError('--body-zh 过滤后为空，或超过 4000 字');
  }
  if (options.get('--title-en') === 'none' || readBody(options, 'body-en') === 'none') {
    patch.titleEn = null;
    patch.bodyEn = null;
  } else {
    const en = englishPair(options);
    if (en) {
      patch.titleEn = en.titleEn;
      patch.bodyEn = en.bodyEn;
    }
  }
  const pinned = onOff(options, '--pinned');
  if (pinned !== undefined) patch.pinned = pinned;
  const strong = onOff(options, '--strong');
  if (strong !== undefined) patch.strongRemind = strong;
  const h = host(options);
  if (h !== undefined) patch.host = h;
  const startsAt = isoTime(options, '--starts-at');
  if (startsAt) patch.startsAt = startsAt;
  if (options.has('--ends-at')) patch.endsAt = isoTime(options, '--ends-at') ?? null;
  return patch;
}

function throwError(message: string): never {
  throw new Error(message);
}

function statusText(row: OpsAnnouncementRow): string {
  if (row.status === 'withdrawn') return '已撤回';
  if (!row.started) return '未生效';
  if (row.ended) return '已过期';
  return '生效中';
}

function formatRow(row: OpsAnnouncementRow): string {
  const flags = [row.pinned ? '置顶' : null, row.strongRemind ? '强提醒' : null, row.host ? `站点=${row.host}` : null]
    .filter(Boolean)
    .join(' ');
  const window = `${row.startsAt} ~ ${row.endsAt ?? '不过期'}`;
  return `#${row.id} [${statusText(row)}] [${row.category}] ${row.titleZh}${flags ? ` (${flags})` : ''}  ${window}`;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, options, flags } = parseArgs(rest);
  if (!command) {
    throw new Error(USAGE);
  }
  const pool = createPool('announcement', 2);
  try {
    // announcements / announcement_reads 由 ensureSchema 幂等补齐，脚本可独立运行
    await ensureSchema(pool);
    if (command === 'list') {
      const rows = await listAnnouncementsForOps(pool, { all: flags.has('--all') });
      console.log(rows.length ? rows.map(formatRow).join('\n') : '（没有公告）');
      return;
    }
    if (command === 'publish') {
      const result = await publishAnnouncement(pool, buildDraft(options, flags));
      const status = result.live ? '已生效，推送已发出' : result.ended ? '已过结束时间，不推送' : '未到生效时间，不推送';
      console.log(`已发布公告 #${result.id}：${status}${result.broadcast ? '；已全服播报' : ''}`);
      return;
    }
    const id = Number(positional[0]);
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`${command} 需要公告 id：${USAGE}`);
    }
    if (command === 'edit') {
      if (flags.has('--chat')) {
        throw new Error('edit 不支持 --chat（修改不推送、不播报）');
      }
      const patch = buildPatch(options);
      if (Object.keys(patch).length === 0) {
        throw new Error('没有要修改的字段');
      }
      const ok = await updateAnnouncement(pool, id, patch);
      console.log(ok ? `已修改公告 #${id}（修改不重新推送）` : `公告 #${id} 不存在`);
      return;
    }
    if (command === 'withdraw') {
      const ok = await withdrawAnnouncement(pool, id);
      console.log(ok ? `已撤回公告 #${id}（玩家列表与推送中立即消失，记录保留）` : `公告 #${id} 不存在或已撤回`);
      return;
    }
    throw new Error(`未知命令 ${command}：${USAGE}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
