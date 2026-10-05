// 文档清单共用的军队示例常量：与 TROOP_KINDS 同步的全零驻军视图。

import { TROOP_KINDS } from './protocol';

/** 城内驻军全零示例（GET_STATE 初始/示例载荷用） */
export const EMPTY_ARMY: Record<string, number> = Object.fromEntries(TROOP_KINDS.map((kind) => [kind, 0]));
