/** 首期页面用到的视图模型。
 *
 *  这里只描述界面自己需要的形状，不是协议定义：
 *  协议号、消息字段与请求关联方式由前后端共同约定后再落到 src/api/。
 *  身份的人读名称等界面文案集中在 src/copy.ts。 */

/** 本次连接声明的登录类型。它是来源标记，不是可独立验证的身份。 */
export type Identity = 'player' | 'agent';

/** 事件发起者：连接声明的身份，或服务端自身（例如 Worker 完成建造）。 */
export type Actor = Identity | 'system';

export interface SessionEvent {
  id: number;
  at: string;
  actor: Actor;
  text: string;
  /** 关联战报 id（战斗类事件的 detail.reportId，v13 起；有值即可打开战报弹窗） */
  reportId?: number;
  /** 侦察情报快照（march_completed 且 outcome='scouted' 事件的 detail.intel，
   *  v23 AISLG-62；有值即可打开侦察报告弹窗） */
  scoutIntel?: import('./api/protocol').ScoutIntel;
}
