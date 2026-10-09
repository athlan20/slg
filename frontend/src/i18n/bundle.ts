// 文案取用层（AISLG-137）：把中文文案（copy*.ts）与英文孪生（copy-*-en.ts）按当前语言
// 打成同构的 Bundle。组件用 useCopy()（语言切换即重渲染），非组件代码（api 拼装、
// 状态层事件文字）用 getCopy()。英文那份逐文件 satisfies 对应中文模块的类型，漏译在
// tsc 就报错；这里再用 Bundle 类型兜底整体结构一致。

import { useSyncExternalStore } from 'react';
import { getLang, subscribeLang, type Lang } from './lang';
import {
  BUILDING_DESC, BUILDING_LABEL, COPY, IDENTITY_LABEL, RESOURCE_LABEL, TERRAIN_LABEL,
  TILE_KIND_LABEL, TROOP_LABEL, buildActionText,
} from '../copy';
import { COPY_EN, BUILDING_DESC_EN, BUILDING_LABEL_EN, IDENTITY_LABEL_EN, RESOURCE_LABEL_EN, TERRAIN_LABEL_EN, TILE_KIND_LABEL_EN, TROOP_LABEL_EN, buildActionText_EN } from '../copy-en';
import { HERO_COPY } from '../copy-hero';
import { HERO_COPY_EN } from '../copy-hero-en';
import { ARMY_COPY, BOARD_COPY, CITY_PAGE_COPY, INTEL_COPY, MAPUI_COPY, OVERVIEW_COPY, SUMMARY_COPY, TARGET_COPY, WARN_COPY } from '../copy-pages';
import { ARMY_COPY_EN, BOARD_COPY_EN, CITY_PAGE_COPY_EN, INTEL_COPY_EN, MAPUI_COPY_EN, OVERVIEW_COPY_EN, SUMMARY_COPY_EN, TARGET_COPY_EN, WARN_COPY_EN } from '../copy-pages-en';
import { CITY_COPY } from '../copy-cities';
import { CITY_COPY_EN } from '../copy-cities-en';
import { YT_COPY } from '../copy-yt';
import { YT_COPY_EN } from '../copy-yt-en';
import { DEFENSE_COPY } from '../copy-defense';
import { DEFENSE_COPY_EN } from '../copy-defense-en';
import { MOVING_COPY } from '../copy-moving';
import { MOVING_COPY_EN } from '../copy-moving-en';
import { WECHAT_COPY } from '../copy-wechat';
import { WECHAT_COPY_EN } from '../copy-wechat-en';
import { TECH_COPY } from '../copy-tech';
import { TECH_COPY_EN } from '../copy-tech-en';
import { FOOT_COPY, MODAL_COPY, NAV_COPY, PAGED_COPY, TOP_COPY } from '../copy-ui';
import { FOOT_COPY_EN, MODAL_COPY_EN, NAV_COPY_EN, PAGED_COPY_EN, TOP_COPY_EN } from '../copy-ui-en';
import { GITHUB_COPY } from '../copy-github';
import { GITHUB_COPY_EN } from '../copy-github-en';
import { GOOGLE_COPY } from '../copy-google';
import { GOOGLE_COPY_EN } from '../copy-google-en';
import { STARVE_COPY } from '../copy-starvation';
import { STARVE_COPY_EN } from '../copy-starvation-en';
import { EXTRA_AUTH } from '../copy-extra-auth';
import { EXTRA_AUTH_EN } from '../copy-extra-auth-en';
import { EXTRA_MAP } from '../copy-extra-map';
import { EXTRA_MAP_EN } from '../copy-extra-map-en';
import { EXTRA_PANEL } from '../copy-extra-panel';
import { EXTRA_PANEL_EN } from '../copy-extra-panel-en';
import { EXTRA_STATE } from '../copy-extra-state';
import { EXTRA_STATE_EN } from '../copy-extra-state-en';
import { CHAT_COPY } from '../copy-chat';
import { CHAT_COPY_EN } from '../copy-chat-en';

/** 中文文案全集（结构基准）：英文 Bundle 必须与之同构 */
const ZH = {
  COPY,
  BUILDING_LABEL,
  BUILDING_DESC,
  TROOP_LABEL,
  RESOURCE_LABEL,
  TERRAIN_LABEL,
  TILE_KIND_LABEL,
  IDENTITY_LABEL,
  buildActionText,
  HERO_COPY,
  MAPUI_COPY,
  TARGET_COPY,
  SUMMARY_COPY,
  CITY_PAGE_COPY,
  ARMY_COPY,
  INTEL_COPY,
  WARN_COPY,
  BOARD_COPY,
  OVERVIEW_COPY,
  CITY_COPY,
  YT_COPY,
  DEFENSE_COPY,
  MOVING_COPY,
  WECHAT_COPY,
  TECH_COPY,
  PAGED_COPY,
  MODAL_COPY,
  NAV_COPY,
  TOP_COPY,
  FOOT_COPY,
  GITHUB_COPY,
  GOOGLE_COPY,
  STARVE_COPY,
  EXTRA_STATE,
  EXTRA_AUTH,
  EXTRA_MAP,
  EXTRA_PANEL,
  CHAT_COPY,
};

export type Bundle = typeof ZH;

/** 英文文案全集：类型上要求与中文同构，少一块或函数签名不符都过不了编译 */
const EN: Bundle = {
  COPY: COPY_EN,
  BUILDING_LABEL: BUILDING_LABEL_EN,
  BUILDING_DESC: BUILDING_DESC_EN,
  TROOP_LABEL: TROOP_LABEL_EN,
  RESOURCE_LABEL: RESOURCE_LABEL_EN,
  TERRAIN_LABEL: TERRAIN_LABEL_EN,
  TILE_KIND_LABEL: TILE_KIND_LABEL_EN,
  IDENTITY_LABEL: IDENTITY_LABEL_EN,
  buildActionText: buildActionText_EN,
  HERO_COPY: HERO_COPY_EN,
  MAPUI_COPY: MAPUI_COPY_EN,
  TARGET_COPY: TARGET_COPY_EN,
  SUMMARY_COPY: SUMMARY_COPY_EN,
  CITY_PAGE_COPY: CITY_PAGE_COPY_EN,
  ARMY_COPY: ARMY_COPY_EN,
  INTEL_COPY: INTEL_COPY_EN,
  WARN_COPY: WARN_COPY_EN,
  BOARD_COPY: BOARD_COPY_EN,
  OVERVIEW_COPY: OVERVIEW_COPY_EN,
  CITY_COPY: CITY_COPY_EN,
  YT_COPY: YT_COPY_EN,
  DEFENSE_COPY: DEFENSE_COPY_EN,
  MOVING_COPY: MOVING_COPY_EN,
  WECHAT_COPY: WECHAT_COPY_EN,
  TECH_COPY: TECH_COPY_EN,
  PAGED_COPY: PAGED_COPY_EN,
  MODAL_COPY: MODAL_COPY_EN,
  NAV_COPY: NAV_COPY_EN,
  TOP_COPY: TOP_COPY_EN,
  FOOT_COPY: FOOT_COPY_EN,
  GITHUB_COPY: GITHUB_COPY_EN,
  GOOGLE_COPY: GOOGLE_COPY_EN,
  STARVE_COPY: STARVE_COPY_EN,
  EXTRA_STATE: EXTRA_STATE_EN,
  EXTRA_AUTH: EXTRA_AUTH_EN,
  EXTRA_MAP: EXTRA_MAP_EN,
  EXTRA_PANEL: EXTRA_PANEL_EN,
  CHAT_COPY: CHAT_COPY_EN,
};

const BUNDLES: Record<Lang, Bundle> = { zh: ZH, en: EN };

/** 非组件代码用（api 拼装 / 状态层事件文字）：取当前语言的文案包 */
export function getCopy(): Bundle {
  return BUNDLES[getLang()];
}

/** 组件用：当前界面语言（语言变化时触发重渲染） */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang);
}

/** 组件用：语言变化时触发重渲染的文案包（即时切换不刷新的机制所在） */
export function useCopy(): Bundle {
  return BUNDLES[useSyncExternalStore(subscribeLang, getLang)];
}
