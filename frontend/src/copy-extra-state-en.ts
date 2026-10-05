// copy-extra-state 的英文孪生（AISLG-137）：结构以中文版为基准（satisfies），
// 漏译或函数签名不符在 tsc 报错；标点一律半角，句式按英文语序重排。

import { EXTRA_STATE } from './copy-extra-state';

export const EXTRA_STATE_EN = {
  mapping: {
    unknownBuilding: 'Unknown building',
    unknownTroop: 'Unknown troop',
    wildTerrain: 'Wilderness',
    cityFallback: 'Your city',
    resourceFallback: 'resources',
    targetCityFallback: 'the target city',
    otherCityFallback: 'another city',
    movingTargetLabel: 'moving target',
    ytCampFallback: 'Yellow Turban camp',
    unknownPlayer: 'a player',
    noLoot: '(no loot)',
    noPlunder: '(nothing to carry or nothing to take)',
    // 前置空格：成本 / 返还括号直接拼在词后（queued / ×10），英文需要空格分隔
    paren: (s: string) => ` (${s})`,
    listSep: ', ',
    refundSuffix: (s: string) => `, refunded ${s}`,
  },
  scout: {
    done: (pos: string) => `Scout ${pos} completed`,
    doneRough: (pos: string, summary: string) => `Scout ${pos} completed: ${summary}`,
    doneGarrison: (pos: string, garrison: string, wall: string) => `Scout ${pos} completed: garrison ${garrison}${wall}`,
    wallDefense: (percent: number) => `, wall damage reduction ${percent}%`,
    garrisonNone: 'none',
  },
  build: {
    fromQueue: (name: string, action: string) => `${name} started from the queue (${action})`,
    start: (name: string, action: string, cost: string) => `Started ${name} ${action}${cost}`,
    queued: (name: string, action: string, cost: string) => `${name} ${action} queued${cost}`,
    completed: (name: string, action: string) => `${name} ${action} completed`,
    cancelled: (name: string, action: string, refund: string) => `Cancelled ${name} ${action}${refund}`,
  },
  recruit: {
    fromQueue: (name: string, count: number) => `${name} ×${count} recruiting resumed from the queue`,
    start: (name: string, count: number, cost: string) => `Started recruiting ${name} ×${count}${cost}`,
    queued: (name: string, count: number, cost: string) => `${name} ×${count} added to the recruit queue${cost}`,
    completed: (name: string, count: number) => `${name} ×${count} recruited and garrisoned in the city`,
    cancelled: (name: string, count: number, refund: string) => `Cancelled recruiting ${name} ×${count}${refund}`,
  },
  event: {
    cityRenamed: (from: string, to: string) => `City renamed: ${from} → ${to}`,
    accountReset: 'Account data has been reset to the initial state',
    marchTaskPlunder: ' (plunder)',
    marchTaskOccupy: ' (occupy)',
    marchReturn: (pos: string, clock: string) => `Garrison set out from ${pos} for home, arriving about ${clock}`,
    marchOut: (task: string, pos: string, troops: string, clock: string) =>
      `Army marching out${task} → ${pos} (${troops}), arriving about ${clock}`,
    marchArrived: (pos: string) => `Army arrived at ${pos}`,
    outerCleared: (name: string, pos: string, survivors: string) =>
      `Cleared the outskirts of famous city ${name} ${pos}: outskirts wiped out, assault the keep within the time limit${survivors ? ` (${survivors} survivors returning)` : ''}`,
    pvpSeized: (pos: string, owner: string, survivors: string) =>
      `Seized ${pos} (the wilderness of ${owner}): the tile is now yours${survivors ? `, ${survivors} survivors garrisoning it` : ''}`,
    occupiedBranch: (pos: string, survivors: string) =>
      `Won the battle at ${pos} and occupied it as a branch city${survivors ? `, ${survivors} survivors garrisoned inside` : ''}`,
    wonNotOccupied: (pos: string, reason: string, survivors: string) =>
      `Won the battle at ${pos} but did not occupy it (${reason}); surviving troops are returning${survivors ? ` (${survivors})` : ''}`,
    wonLoot: (pos: string, loot: string, survivors: string) =>
      `Won the battle at ${pos}: loot ${loot}${survivors ? `, ${survivors} survivors` : ''}`,
    pvpCityWhere: (pos: string, owner: string) => `${pos} (the city of ${owner})`,
    plunderWon: (where: string, loot: string, survivors: string) =>
      `Plundered ${where}: loot ${loot}${survivors ? `, ${survivors} survivors returning` : ''}`,
    battleLost: (pos: string, survivors: string) =>
      `Lost the battle at ${pos}${survivors ? `, remnants withdrew (${survivors})` : ', the whole force was wiped out'}`,
    reinforced: (pos: string, troops: string) => `Reinforced ${pos} and joined the garrison (${troops})`,
    returnedGarrison: (troops: string) => `Troops returned home and joined the garrison (${troops})`,
    aborted: (pos: string, cause: string, cargoTail: string) =>
      `Target ${pos} can no longer be attacked${cause}; the troops turned back${cargoTail}`,
    cause: {
      target_gone: ' (target no longer valid)',
      owner_changed: ' (target changed owner)',
      TILE_PROTECTED: ' (tile under owner-change protection)',
      NEWBIE_PROTECTED: ' (target under newbie protection)',
      TARGET_IN_TRUCE: ' (target in truce)',
    } as Record<string, string>,
    wildOccupied: (pos: string, terrain: string, level: string, bonus: string, gather: string) =>
      `Occupied wilderness ${pos}: ${terrain} Lv${level}${bonus}${gather}`,
    wildBonus: (resource: string, rate: number) => `, ${resource} +${rate}/h`,
    wildGather: (rate: number) => ` (gather +${rate}/h)`,
    wildRecall: (pos: string) => `Garrison recalled; wilderness ${pos} given up`,
    wildConquest: (pos: string, by: string) => `Wilderness ${pos} was seized${by ? ` by player ${by}` : ''}; the occupation is lost`,
    wildLost: (pos: string) => `Wilderness ${pos} fell; the occupation is lost`,
    npcCityOccupied: (pos: string, name: string, loot: string) =>
      `Occupied the NPC city ${pos} as a branch city${name ? ` "${name}"` : ''}${loot ? `, stock taken over ${loot}` : ''}`,
    npcRaidRepelled: (pos: string, losses: string) => `NPC raid on ${pos} was repelled${losses ? `, losses: ${losses}` : ''}`,
    npcRaidWiped: (pos: string) => `NPC raid on ${pos}: the garrison was wiped out and the occupation lost`,
    npcWarning: (target: string, arriveAt: string, mins: string, armyMin: string, armyMax: string) =>
      `Scouts spotted an NPC force marching toward ${target}, arriving ${arriveAt}${mins}, army about ${armyMin}-${armyMax}`,
    minutesLeft: (n: number) => `, about ${n} min later`,
    playerWarning: (who: string, where: string, arriveAt: string, mins: string, armyMin: string, armyMax: string) =>
      `Beacon alert: ${who} is marching toward ${where}, arriving ${arriveAt}${mins}, army about ${armyMin}-${armyMax}`,
    playerUnknown: 'a player force',
    playerTargetWild: (pos: string, terrain: string, level: number | null) =>
      `your wilderness ${pos}${terrain ? ` ${terrain}` : ''}${level !== null ? ` Lv${level}` : ''}`,
    playerTargetCity: (pos: string) => `your city ${pos}`,
    pvpUnknown: 'An unknown player',
    pvpRepelled: (who: string, pos: string, losses: string) =>
      `${who} attacked your city ${pos} and was repelled${losses ? `, losses: ${losses}` : ''}`,
    pvpDefenseLine: (before: string, after: string) => `city defense ${before} → ${after}`,
    pvpTransferred: (who: string, pos: string, defense: string) =>
      `${who} broke through your branch city ${pos} — its defense hit zero and the city changed hands (${defense})`,
    pvpTruceUntil: (clock: string) => `, the city is in truce until ${clock}`,
    pvpRamBonus: (ram: number) => `, rams +${ram}`,
    pvpConquestHit: (who: string, defense: string, damage: string, ramTail: string, truce: string) =>
      `${who} breached your city defense (${defense}, −${damage} per hit${ramTail})${truce}`,
    pvpTrucePeriodUntil: (clock: string) => `, the city entered a truce until ${clock}`,
    pvpLooted: (who: string, pos: string, loot: string, truce: string) =>
      `${who} broke into your city ${pos} and looted ${loot}${truce}`,
    pvpNoLoot: 'nothing',
    branchFallback: 'branch city',
    conquestLost: (cityName: string, pos: string, by: string) =>
      `Your branch city "${cityName}" ${pos} was taken over${by ? ` by player ${by}` : ''}: its defense hit zero and it changed hands (the wilderness is ownerless; troops in the field return to the main city)`,
    conquestGained: (from: string, cityName: string, pos: string, until: string) =>
      `Took over${from ? ` ${from}'s` : ' a'} branch city "${cityName}" ${pos}: buildings and resources received, defense fully restored${until}`,
    protectionUntil: (clock: string) => `, protection until ${clock}`,
    truceStarted: (until: string) => `Voluntary truce started, until ${until} (during it nobody can attack you, and you cannot march on players)`,
    newbieCauseGovernment: 'government upgraded',
    newbieCauseAttack: 'you attacked another player',
    newbieEnded: (cause: string) => `Newbie protection ended (${cause}): other players can scout / attack you from now on`,
    agentConnected: 'Agent connected',
    agentDisconnected: 'Agent disconnected',
  },
  broadcast: {
    npcCityEmptied: (actor: string, level: string, pos: string) => `${actor} emptied the NPC city Lv${level} ${pos}`,
    goldMineFirst: (actor: string, pos: string) => `${actor} was the first to occupy the gold mine ${pos}`,
    cityBroken: (actor: string) => `${actor}'s main city was broken by an NPC attack`,
    winStreak: (actor: string, streak: string) => `${actor}'s army won ${streak} battles in a row within an hour`,
    cityConquered: (actor: string, from: string, cityName: string, pos: string) =>
      `${actor} took over${from ? ` ${from}'s` : " another player's"} branch city "${cityName}" ${pos}`,
    headline: (type: string) => `Server event: ${type}`,
  },
  denial: {
    TERRITORY_LIMIT: 'Government occupation limit reached',
    GOVERNMENT_TOO_LOW: 'Main city government below level 3',
    BRANCH_LIMIT: 'Branch city limit reached',
    TARGET_LEVEL_TOO_HIGH: 'Target city level is higher than the origin city government level',
  } as Record<string, string>,
  errorText: {
    heroGoldInsufficient: 'Not enough gold. Recruit cost = 500 + (total of the three attributes) × 20',
    newbieProtected:
      'That player is under newbie protection (first 3 days after signup or before government level 5) and cannot be scouted / attacked; wait for the protection to end',
    targetInTruce: 'That player is in a truce (after being attacked or voluntary) and cannot be attacked for now',
    selfTruceActive: 'Your voluntary truce is active: you cannot attack players (wilderness / NPC targets are unaffected)',
    tileProtected:
      'That wilderness just changed hands and is under protection (about 1 hour baseline, scaled by game speed); it cannot be seized yet',
    movingTargetGone: 'That moving target is gone (defeated or expired); choose another target',
    shortfall: (parts: string, eta: string) => `, still short ${parts}${eta}`,
    populationShortfall: (missing: number, eta: string) => `, still short ${missing} population${eta}`,
  },
  client: {
    connectFailedCode: (code: number) => `Connection failed (close code ${code})`,
    notConnected: 'Not connected',
    requestTimeout: (op: number) => `Request op=${op} timed out`,
    closed: 'Connection closed',
    disconnected: 'Connection lost',
  },
  state: {
    rejectedFallback: 'failed',
    recallNoGarrison: (x: number, y: number) => `Recall (${x},${y}): no garrison on that tile; the occupation is cleared`,
    scoutFailed: 'Failed to start the scout',
    recallMarchFailed: 'Failed to recall the march',
    gsiTimeout: 'Google script loading timed out',
    gsiInitFailed: 'Google script loaded but failed to initialize',
    gsiLoadFailed: 'Failed to load the Google script (network access to Google is required)',
  },
  hero: {
    nameFallback: 'hero',
  },
} satisfies typeof EXTRA_STATE;
