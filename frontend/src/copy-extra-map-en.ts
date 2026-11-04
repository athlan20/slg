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
  layers: {
    marches: 'Marches',
    yield: 'Yield',
  },
  march: {
    glyph: {
      plunder: 'P',
      occupy: 'O',
      reinforce: 'R',
      attack: 'A',
      scout: 'S',
      transfer: 'T',
      transport: 'C',
      intercept: 'I',
      return: '↩',
      assist: 'D',
    },
    stack: (count: number) => `×${count}`,
    overflow: (count: number) => `+${count}`,
    ambushLeft: (time: string) => `Ambush ${time}`,
    tipTroops: (total: number) => `Troops ${total}`,
    tipTarget: (x: number, y: number) => `Target (${x},${y})`,
    tipLeft: (time: string) => `Left ${time}`,
    stackTitle: (count: number) => `${count} marches in one tile`,
    arrowHint: 'Tap to jump to the march',
    detailHint: 'Tap again for march details',
  },
  fog: {
    unknownTitle: 'Unexplored: black fog here. Send a scout or troops to see it.',
    exploredTitle: (time: string) => `Explored · last seen ${time}`,
    unknownNotice: (x: number, y: number) => `Target (${x}, ${y}) is in the fog. Its situation is unknown.`,
    exploredPercent: (pct: number) => `Explored ${pct}%`,
    reportTitle: 'Exploration report',
    reportSummary: (chunks: number) => `Explored ${chunks} new chunk(s)`,
    reportCells: 'Discoveries (tap to jump)',
    reportClose: 'Close',
    reportKind: {
      famous: 'Famous city',
      wild_hero: 'Wild general',
      gold_mine: 'Gold mine',
      player_city: 'Player city',
      npc_city: 'NPC city',
      high_wilderness: 'High-level wilderness',
    } as Record<string, string>,
    rumor: 'Famous city (approximate location)',
  },
  raid: {
    label: (time: string) => `Raid ${time}`,
    arrowHint: 'Tap to jump to the raided tile',
  },
  territoryLegend: {
    own: 'You',
    ally: 'Allies',
    hostile: 'Hostile',
    other: 'Others',
    cluster: 'Gold edge = cluster bonus',
  },
  yield: {
    glyph: {
      food: 'F',
      wood: 'W',
      stone: 'S',
      iron: 'I',
      gold: 'G',
    },
    rate: (amount: string) => `Yield +${amount}/h`,
    reserveValue: (current: string, cap: string) => `Reserve ${current}/${cap}`,
    etaEmpty: (clock: string) => `empty by ${clock}`,
    etaFull: (clock: string) => `full by ${clock}`,
    tier: {
      ample: 'Reserve ample',
      normal: 'Reserve normal',
      depleted: 'Reserve depleted',
    },
    depletedNote: 'When depleted the occupation bonus stays, gathering drops to the recovery rate',
    aria: (resource: string, amount: string) => `Yield ${resource} +${amount}/h`,
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
