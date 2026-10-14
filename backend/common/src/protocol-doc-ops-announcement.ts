// 公告的协议文档（v60，AISLG-162）：GET_ANNOUNCEMENTS / GET_ANNOUNCEMENT / READ_ANNOUNCEMENT 与推送 PUSH_ANNOUNCEMENT。
// 玩家与 Agent 同一套规则（Agent 用令牌登录后可读）。从 protocol-doc-ops.ts 拆出以控制单文件行数。

import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { STARTED_AT } from './protocol-doc-shared';
import { ANNOUNCEMENT_BODY_MAX_CHARS, ANNOUNCEMENT_TITLE_MAX_CHARS } from './protocol-announcement';

const ANNOUNCEMENT_VIEW_EXAMPLE = {
  id: 12,
  category: 'system',
  title: '周日 22:00 停服维护 30 分钟',
  pinned: true,
  strongRemind: true,
  read: false,
  expired: false,
  publishedAt: STARTED_AT,
  startsAt: STARTED_AT,
  endsAt: null,
};

export const REQUEST_GET_ANNOUNCEMENTS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_ANNOUNCEMENTS',
  title: '查询公告列表（v60，AISLG-162）',
  preAuth: false,
  summary: `列出本站可见的公告。默认返回生效中的公告：置顶在前，其余按发布时间倒序，最多 limit 条（1..50，缺省 20，不分页）。history=true 改为返回往期（已过结束时间的公告，按发布时间倒序，用 beforeId 取比它更早的一页）。列表不含正文，正文用 GET_ANNOUNCEMENT。unreadCount 为生效中且未读的公告数（红点用，不受 limit 影响）。lang 取 zh（缺省）或 en：英文没填的公告回落到中文。已撤回、未到生效时间、他站定向的公告不出现。`,
  requestFields: [
    { name: 'lang', type: "'zh' | 'en'", desc: '标题语言，缺省 zh；en 时没填英文的公告显示中文标题。' },
    { name: 'history', type: 'boolean', desc: '缺省 false（生效中）；true 返回往期（已过结束时间）。' },
    { name: 'limit', type: 'number', desc: '1..50，缺省 20。' },
    { name: 'beforeId', type: 'number', desc: '仅 history=true 时有效：只取 id 小于它的公告（翻页）。' },
  ],
  dataFields: [
    { name: 'announcements', type: 'array', desc: '公告列表（AnnouncementView，见下方示例）：id、category（system 系统 / event 活动）、title、pinned、strongRemind、read、expired、publishedAt、startsAt、endsAt（null 表示不过期）。' },
    { name: 'unreadCount', type: 'number', desc: '生效中且本账号未读的公告数。' },
  ],
  errors: [],
  examples: [
    {
      caption: '生效中的公告（一条置顶的强提醒维护公告，一条未置顶的活动公告）',
      request: { op: Op.GET_ANNOUNCEMENTS, seq: 50, data: { lang: 'zh' } },
      responses: [
        {
          op: Op.GET_ANNOUNCEMENTS,
          seq: 50,
          ok: true,
          data: {
            announcements: [
              ANNOUNCEMENT_VIEW_EXAMPLE,
              { ...ANNOUNCEMENT_VIEW_EXAMPLE, id: 11, category: 'event', title: '金秋福利：签到双倍', pinned: false, strongRemind: false, read: true },
            ],
            unreadCount: 1,
          },
        },
      ],
    },
  ],
  agentNote: `新公告到达时服务端推送 PUSH_ANNOUNCEMENT（只带标题与分类，不带正文）；断线期间的用本协议补拉。标题为 ${ANNOUNCEMENT_TITLE_MAX_CHARS} 字以内的短句。需要正文时再调 GET_ANNOUNCEMENT。`,
};

export const REQUEST_GET_ANNOUNCEMENT: RequestOpDoc = {
  kind: 'request',
  name: 'GET_ANNOUNCEMENT',
  title: '查询公告正文（v60，AISLG-162）',
  preAuth: false,
  summary: `返回一条公告的详情（列表视图 + 正文 body）。正文为受限 Markdown 子集：段落之间以空行分隔，段内换行保留，**加粗**，[文字](https 链接)；图片、HTML 标签与脚本已在服务端去掉，非 http(s) 链接只保留文字。body 按 lang 取对应语言，英文没填时回落到中文。可以读往期公告（expired=true）；已撤回、未生效或他站的公告返回 ANNOUNCEMENT_NOT_FOUND。读取本身不计已读，需要标记时调 READ_ANNOUNCEMENT。`,
  requestFields: [
    { name: 'id', type: 'number', desc: '公告 id（来自 GET_ANNOUNCEMENTS 或 PUSH_ANNOUNCEMENT）。' },
    { name: 'lang', type: "'zh' | 'en'", desc: '正文语言，缺省 zh。' },
  ],
  dataFields: [
    { name: 'announcement', type: 'object', desc: `公告详情：列表视图各字段 + body（正文，过滤后不超过 ${ANNOUNCEMENT_BODY_MAX_CHARS} 字）。` },
  ],
  errors: ['ANNOUNCEMENT_NOT_FOUND'],
  examples: [
    {
      caption: '读取一条维护公告的正文',
      request: { op: Op.GET_ANNOUNCEMENT, seq: 51, data: { id: 12 } },
      responses: [
        {
          op: Op.GET_ANNOUNCEMENT,
          seq: 51,
          ok: true,
          data: {
            announcement: {
              ...ANNOUNCEMENT_VIEW_EXAMPLE,
              body: '本周日 22:00 至 22:30 停服维护，维护期间各城产出与行军暂停。\n\n**请提前把行军回城**，维护结束后正常开放。',
            },
          },
        },
      ],
    },
    {
      caption: '公告已撤回或不存在',
      request: { op: Op.GET_ANNOUNCEMENT, seq: 52, data: { id: 999 } },
      responses: [
        { op: Op.GET_ANNOUNCEMENT, seq: 52, ok: false, error: { code: 'ANNOUNCEMENT_NOT_FOUND', message: '公告不存在、已撤回或尚未生效' } },
      ],
    },
  ],
  agentNote: '读正文不会改变已读状态；需要标记时再调 READ_ANNOUNCEMENT。运营公告以正文为准，玩家问到规则细节时照原文转述，不要自行补充。',
};

export const REQUEST_READ_ANNOUNCEMENT: RequestOpDoc = {
  kind: 'request',
  name: 'READ_ANNOUNCEMENT',
  title: '标记公告已读（v60，AISLG-162）',
  preAuth: false,
  summary: '把一条公告标记为本账号已读（幂等，重复调用无副作用）。已读后 GET_ANNOUNCEMENTS 的 read 为 true，unreadCount 相应减少。红点与强提醒弹窗都以已读为准。仅能标记本站可见的公告，否则返回 ANNOUNCEMENT_NOT_FOUND。',
  requestFields: [{ name: 'id', type: 'number', desc: '公告 id。' }],
  dataFields: [
    { name: 'id', type: 'number', desc: '公告 id。' },
    { name: 'unreadCount', type: 'number', desc: '标记后生效中且未读的公告数。' },
  ],
  errors: ['ANNOUNCEMENT_NOT_FOUND'],
  examples: [
    {
      caption: '读完维护公告后标记已读',
      request: { op: Op.READ_ANNOUNCEMENT, seq: 53, data: { id: 12 } },
      responses: [{ op: Op.READ_ANNOUNCEMENT, seq: 53, ok: true, data: { id: 12, unreadCount: 0 } }],
    },
  ],
  agentNote: '只在确实读过（或已把内容告知玩家）之后再标记，不要为了清红点而批量标记。',
};

export const PUSH_ANNOUNCEMENT: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_ANNOUNCEMENT',
  title: '推送：新公告（v60，AISLG-162）',
  summary: '运营发布一条已生效的公告时，推送给本站全部在线连接（玩家连接与 Agent 连接都收到）。只带标题与分类，不带正文；正文用 GET_ANNOUNCEMENT 读取。定时生效（生效时间在将来）的公告不推送，下次拉取列表时出现。站点定向的公告只推给对应站点。',
  dataFields: [
    { name: 'id', type: 'number', desc: '公告 id。' },
    { name: 'category', type: "'system' | 'event'", desc: '分类：系统公告 / 活动公告。' },
    { name: 'titleZh', type: 'string', desc: '中文标题。' },
    { name: 'titleEn', type: 'string | null', desc: '英文标题，没填为 null。' },
    { name: 'pinned', type: 'boolean', desc: '是否置顶。' },
    { name: 'strongRemind', type: 'boolean', desc: '是否强提醒（玩家端会弹窗，需点确认才算已读）。' },
    { name: 'publishedAt', type: 'string', desc: '发布时间（ISO 8601）。' },
  ],
  examples: [
    {
      op: Op.PUSH_ANNOUNCEMENT,
      push: true,
      data: {
        id: 12,
        category: 'system',
        titleZh: '周日 22:00 停服维护 30 分钟',
        titleEn: null,
        pinned: true,
        strongRemind: true,
        publishedAt: STARTED_AT,
      },
    },
  ],
  agentNote: '收到推送后调 GET_ANNOUNCEMENT 读正文，再决定是否告知玩家；strongRemind 为 true 时玩家端会弹窗，别重复催促。',
};

export const ANNOUNCEMENT_OP_DOCS = {
  [Op.GET_ANNOUNCEMENTS]: REQUEST_GET_ANNOUNCEMENTS,
  [Op.GET_ANNOUNCEMENT]: REQUEST_GET_ANNOUNCEMENT,
  [Op.READ_ANNOUNCEMENT]: REQUEST_READ_ANNOUNCEMENT,
  [Op.PUSH_ANNOUNCEMENT]: PUSH_ANNOUNCEMENT,
};
