// copy-extra-map 的英文孪生（AISLG-137）：结构以中文版为基准（satisfies），
// 漏译或函数签名不符在 tsc 报错；标点一律半角。地图格单字图形字符用 1 字符短码：
// 城 City → C、名 Famous → F、巾 Yellow Turban camp → Y、巢 Lair → L、
// 寇 Bandits → B、商 caravan/Trader → T、敌 Enemy → E、野 Wilderness → W、免 Truce → T。

import { EXTRA_MAP } from './copy-extra-map';

export const EXTRA_MAP_EN = {
  tileGlyphs: {
    city: 'C',
    famous: 'F',
    ytCamp: 'Y',
    ytBoss: 'L',
    bandit: 'B',
    caravan: 'T',
    enemy: 'E',
    wild: 'W',
  },
  truceBadge: {
    glyph: 'T',
  },
  tileTip: {
    ownCity: 'Your city',
    playerCity: 'Player city',
    npcGuard: 'NPC garrison',
    yourCity: 'Your city',
    ownOccupied: 'Occupied by you',
    owner: (name: string) => `Owner: ${name}`,
    ariaSep: (owner: string) => `, ${owner}`,
  },
  zoom: {
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    reset: 'Reset',
    view: (w: number, h: number) => `View ${w}×${h}`,
    atMin: 'Already fully zoomed in',
    atMax: 'Already fully zoomed out',
    zoomInHint: 'Zoom in (Ctrl+scroll up / + / pinch out)',
    zoomOutHint: 'Zoom out (Ctrl+scroll down / - / pinch in)',
  },
  duration: {
    hm: (hours: number, minutes: number) => `${hours}h ${minutes}min`,
    m: (minutes: number) => `${minutes}min`,
  },
  reports: {
    lossesNone: 'none',
    resultGone: 'Vanished',
    resultMissed: 'No contact',
    wallShort: (percent: number) => `Wall ${percent}%`,
  },
} satisfies typeof EXTRA_MAP;
