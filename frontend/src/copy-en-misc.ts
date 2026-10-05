// 英文文案孪生（AISLG-137）：copy.ts 的 Agent / 事件 / 登录 / 皮肤 / 错误 / 会话 / 来袭预警 / 免战段。
// 各常量用 satisfies 对应中文 section 的类型做索引校验（import { COPY } from './copy'），
// 漏译成员、签名不一致都会在 tsc 报错。

import { COPY } from './copy';

export const AGENT_PANEL_EN = {
  offline: 'Offline',
  rowScope: 'Delegation scope',
  rowScopeValue: 'All (phase 1 default)',
  rowConnection: 'Connection',
  connectionsOnline: (count: number) => `Online · ${count} connection${count === 1 ? '' : 's'}`,
  querying: 'Querying…',
  rowLastOnline: 'Last online',
  rowLastAction: 'Last action',
  none: '—',
  planNext: 'Next step',
  planOverall: 'Overall plan',
  planEmpty: 'No plan reported by the Agent yet',
  planSectionTitle: 'Plan reported by the Agent',
  docSection: 'Ready-made docs for your AI',
  docButton: 'Copy for AI',
  docCopied: 'Copied — paste the whole prompt to your AI',
  docFailed: 'Copy failed, please retry',
  docTokenHint: 'The prompt contains your token — only send it to your own Agent.',
  // MCP plugin config: paste into Claude Desktop / Cursor so the AI can play the game directly.
  // JSON structure, commands, keys and the ${token}/${wsUrl} interpolation stay verbatim.
  mcpButton: 'Copy MCP config',
  mcpCopied: "Copied — paste it into your AI tool's MCP config",
  mcpFailed: 'Copy failed, please retry',
  mcpPrompt: (wsUrl: string, token: string) =>
    `Add the config below to your AI tool's MCP settings (Claude Desktop: Settings → Developer → Edit Config; Cursor: ~/.cursor/mcp.json, same structure) and I can play SLG directly:\n` +
    `{\n` +
    `  "mcpServers": {\n` +
    `    "slg": {\n` +
    `      "command": "npx",\n` +
    `      "args": ["-y", "slg-mcp"],\n` +
    `      "env": {\n` +
    `        "SLG_TOKEN": "${token}",\n` +
    `        "SLG_SERVER": "${wsUrl}"\n` +
    `      }\n` +
    `    }\n` +
    `  }\n` +
    `}\n` +
    `Requires Node.js >= 20. Once it is set up, tell me "help me play the Three Kingdoms". The config contains your Agent token — keep it only in config files on your own machine.`,
  docPrompt: (docUrl: string, wsUrl: string, token: string) =>
    `I am delegating to you the connection to the SLG game's Agent API. Fetch and read the integration doc yourself:\n` +
    `1. Fetch the integration doc (Markdown) with HTTP GET: ${docUrl}\n` +
    `2. After reading it, open a WebSocket connection as the doc describes, log in with the token below (LOGIN {token, asAgent: true}), and complete the first request (the protocol version is the version field in the doc).\n` +
    `Server address (WebSocket): ${wsUrl}\n` +
    `Agent token (token): ${token}`,
} satisfies typeof COPY['agentPanel'];

export const EVENTS_PANEL_EN = {
  title: 'Recent events',
  empty: 'No events yet. Results of logins, builds and server pushes will appear here.',
  loadingOlder: 'Loading earlier events…',
  noMore: 'All events loaded',
  // Battle events carry a reportId: the chip opens the matching battle report dialog.
  viewReport: 'Report',
  // Scout events carry intel: the chip opens the scout report dialog.
  viewScoutReport: 'Scout',
} satisfies typeof COPY['eventsPanel'];

export const LOGIN_EN = {
  title: 'Account',
  booting: 'Auto-login in progress',
  loggedOut: 'Not logged in',
  bootingBody: 'Signing in automatically with your saved session…',
  username: 'Username',
  usernamePlaceholder: 'Enter username',
  password: 'Password',
  passwordPlaceholder: '6..64 characters',
  busy: 'Signing in…',
  submit: 'Log in',
  note:
    'Login goes over WebSocket (protocol: docs/agent-api.md). Username and password are only for existing accounts — password login no longer registers new accounts (create one with Google or GitHub). The browser only stores the session token issued by the server.',
  noteInternational:
    'This is the international site; log in with Google or GitHub. Legacy accounts: log in with your password on the domestic site and bind Google / GitHub once, then the same account works here.',
  thirdPartyUnavailable: 'Google / GitHub login is temporarily unavailable on this site. Please try again later.',
  repoLink: 'Open source · GitHub',
} satisfies typeof COPY['login'];

export const THEME_EN = {
  label: 'Theme',
} satisfies typeof COPY['theme'];

export const ERRORS_EN = {
  // Resource / population shortfall suffix appended after the INSUFFICIENT_* messages.
  shortfall: {
    eta: (duration: string) => `(about ${duration} to save up)`,
    // Net production is zero or negative (e.g. troops eat more food than produced).
    noRate: '(Net production cannot save it up right now — disband troops to cut upkeep or exchange at the Market)',
    // Population growth is 0 when there are no Houses.
    populationNoGrowth: '(Population is not growing right now — build Houses to restore growth)',
  },
  login: {
    invalidCredentials: 'Incorrect username or password',
    // Password login for an unknown username (registration channel is closed).
    signupClosed: 'That username does not exist: password login no longer registers new accounts — create your account with Google / GitHub login',
    invalidParams: 'Username needs 1..32 characters, password needs 6..64 characters',
    sessionInvalid: 'Your session has expired, please log in again',
    // An Agent trying to log in with account credentials.
    agentPasswordLogin: 'Agents cannot log in with username and password — use the Agent token provided by the player (see the "Copy for AI" prompt)',
    // Password login is disabled on the international site.
    passwordLoginDisabled: 'Password login is disabled on this site — use Google / GitHub login',
    fallback: 'Login failed',
  },
  agent: {
    fallback: 'Operation failed, please retry',
  },
  build: {
    insufficientResources: 'Not enough resources for the build or upgrade (current resources in the top bar)',
    queueFull: 'Build queue is full — wait for the first item to finish before starting another',
    buildingExists: 'A building of this type already exists or is under construction/upgrade — you cannot start another one',
    buildingNotBuilt: 'This building type is not built yet — build it first, then upgrade',
    buildingLevelMax: 'The building has reached its level cap and cannot be upgraded further',
    buildNotCancellable: 'Only queued build tasks can be cancelled',
    invalidParams: 'Invalid building type',
    fallback: 'Failed to start the build',
  },
  rename: {
    invalidParams: 'The name must be 1..24 characters after trimming leading and trailing whitespace',
    fallback: 'Rename failed',
  },
  reset: {
    fallback: 'Failed to reset the account',
  },
  recruit: {
    troopNotAvailable: 'This troop type requires a higher-level Barracks',
    insufficientResources: 'Not enough resources for this recruitment (current resources in the top bar)',
    insufficientPopulation: 'Not enough population to recruit that many (population grows over time; Houses raise the cap)',
    queueFull: 'Recruit queue is full — wait for the first task to finish before queueing another',
    notCancellable: 'Only queued recruit tasks can be cancelled',
    invalidParams: 'Invalid recruit parameters (unknown troop type or out-of-range count)',
    fallback: 'Failed to start recruitment',
  },
  exchange: {
    insufficientResources: 'Not enough of that resource for this exchange',
    invalidParams: 'The amount must be a positive integer, and at least 4 units are needed to yield 1 gold',
    fallback: 'Exchange failed, please retry',
  },
  world: {
    targetNotAttackable: 'This target cannot be marched against yet (player cities and tiles occupied by others; PvP opens in a later phase)',
    insufficientTroops: 'Not enough troops in the city for this formation (troops on the march are not in the city)',
    tileNotOccupied: 'This tile is not occupied by your account, so its garrison cannot be recalled',
    invalidParams: 'Invalid march parameters (coordinates out of bounds, empty formation, or invalid task value)',
    plunderCooldown: 'This tile was just plundered successfully and is in plunder cooldown (occupying is not limited by the cooldown)',
    taskInvalidForTarget: 'This task does not apply to that target (NPC cities support plunder only)',
    territoryLimit: 'Wilderness occupancy has reached the cap set by your Government level (upgrade the Government or recall a tile before occupying another)',
    fallback: 'Operation failed',
  },
} satisfies typeof COPY['errors'];

// Session-level notices and local event lines (used by useGameSession).
export const SESSION_EN = {
  disconnected: 'Connection lost, reconnecting automatically…',
  reconnected: 'Reconnected',
  tokenLost: 'Your login credentials are lost — please log in again',
  sessionExpired: 'Your session has expired, please log in again',
  loginSuccess: 'Logged in as the player',
  autoLoginSuccess: (username: string) => `Auto-logged in with saved credentials (${username})`,
  autoLoginFailed: (message: string) => `Auto-login failed: ${message}`,
  connectFailed: 'Could not connect to the server',
  buildQueued: (name: string, action: string) => `${name} ${action} queued`,
  buildStarted: (name: string, action: string, dueClock: string) => `Started ${name} ${action}, due ${dueClock}`,
  // Chain upgrade: one upfront cost, level by level; dueClock is the first level's deadline.
  buildChainQueued: (name: string, toLevel: number, count: number) =>
    `${name} chain-upgrade to Lv ${toLevel} (${count} levels) queued`,
  buildChainStarted: (name: string, toLevel: number, count: number, totalSeconds: number, dueClock: string) =>
    `Started ${name} chain-upgrade to Lv ${toLevel} (${count} levels, ${totalSeconds}s for the full chain), first level due ${dueClock}`,
  buildRejected: (message: string) => `Request rejected (${message})`,
  buildFailedFallback: 'Failed to start the build',
  buildCancelled: (name: string, action: string) => `Cancelled ${name} ${action}, cost fully refunded`,
  cancelRejected: (message: string) => `Cancellation rejected (${message})`,
  cancelFailedFallback: 'Failed to cancel the build',
  recruitStarted: (name: string, count: number, dueClock: string) =>
    `Started recruiting ${name} ×${count}, due ${dueClock}`,
  recruitQueued: (name: string, count: number) => `${name} ×${count} queued for recruitment`,
  recruitCancelled: (name: string, count: number) => `Cancelled recruiting ${name} ×${count}, resources and population fully refunded`,
  recruitRejected: (message: string) => `Recruitment rejected (${message})`,
  recruitFailedFallback: 'Failed to start recruitment',
  cancelRecruitRejected: (message: string) => `Recruit cancellation rejected (${message})`,
  cancelRecruitFailedFallback: 'Failed to cancel recruitment',
  marchStarted: (x: number, y: number, dueClock: string) => `Troops marching out → (${x},${y}), due ${dueClock}`,
  recallStarted: (x: number, y: number, dueClock: string) =>
    `Garrison departing (${x},${y}) for home, due ${dueClock}; occupation abandoned`,
  scoutStarted: (x: number, y: number, count: number, dueClock: string) =>
    `Scouts ×${count} scouting (${x},${y}), due ${dueClock} (intel arrives with the event feed)`,
  exchanged: (resourceLabel: string, amount: number, gold: number) =>
    `Market exchange: ${resourceLabel} ${amount} → gold ${gold}`,
  marchRecalled: (dueClock: string) => `Troops en route have turned back, due home ${dueClock}`,
  marchRejected: (message: string) => `March rejected (${message})`,
  marchFailedFallback: 'Failed to start the march',
  recallRejected: (message: string) => `Recall rejected (${message})`,
  recallFailedFallback: 'Failed to recall the garrison',
} satisfies typeof COPY['session'];

// Incoming-attack warning dialog (NPC and player attackers share one dialog): pops up immediately
// so there is time to reinforce or pull back.
export const NPC_WARNING_EN = {
  titlePlayer: '⚔ Incoming player attack',
  title: '⚠ Incoming NPC attack',
  closeAria: 'Close warning',
  targetLabel: 'Target:',
  targetCity: 'Your Main City',
  attackerLabel: 'Attacker:',
  attackerRow: (username: string, cityName: string) => `${username} (attacking from ${cityName})`,
  targetWild: (x: number, y: number, terrain: string, level: number) =>
    `Your wilderness tile (${x},${y})${terrain ? ` ${terrain}` : ''} Lv${level}`,
  arriveLabel: 'ETA:',
  arriveLeft: (left: string) => `(${left} left)`,
  armyLabel: 'Enemy forces:',
  // Strength is a ±20% estimate; the exact composition is in the battle report afterwards.
  armyNote: '(estimated)',
  adviceCity: 'If your Main City falls its resources can be plundered (it then enters Truce). If there is still time: upgrade the Wall and keep a solid garrison in the city.',
  advicePlayer:
    'The attacker is a player force: if there is time, move troops from another city to reinforce (select your own city and dispatch troops — that is a transfer) and spend your resources (building / recruiting locks them up). Even if the defense fails the city cannot be occupied — once it falls it enters Truce.',
  adviceWild:
    'If you can reinforce in time, select the wilderness tile and send troops (reinforcement does not fight — the troops merge into the garrison); if it cannot be held, select the tile and use "Recall all garrison" — recalling abandons the occupation and voids the incoming attack.',
  acknowledge: 'Got it',
} satisfies typeof COPY['npcWarning'];

// Voluntary Truce Shield action and status copy.
export const TRUCE_COPY_EN = {
  startedText: (until: string | null) =>
    until
      ? `Truce Shield enabled until ${until} (while it is on, no one can attack you and you cannot attack players)`
      : 'Truce Shield enabled',
  errAlreadyActive: 'Truce Shield is already active — no need to enable it again',
  errWeeklyUsed: "This week's Truce Shield has already been used (one free use per week)",
  errWeeklyUsedLeft: (seconds: number) => {
    const hours = Math.ceil(seconds / 3600);
    return `This week's Truce Shield has been used (once per week) — you can enable it again in about ${hours} hours`;
  },
  errFallback: 'Failed to enable Truce Shield, please try again later',
} satisfies typeof COPY['truce'];
