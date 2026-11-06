import WebSocket from './backend/node_modules/ws/index.js';
const API = 'ws://127.0.0.1:8081/ws';
let seq = 0;
function connect(): Promise<{ ws: WebSocket; call: (op: number, data?: unknown) => Promise<any>; close: () => void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(API);
    const pending = new Map();
    ws.on('open', () => resolve({
      ws,
      call: (op: number, data?: unknown) => new Promise((res2) => {
        const s = ++seq;
        pending.set(s, res2);
        ws.send(JSON.stringify({ op, seq: s, data: data ?? {} }));
        setTimeout(() => { if (pending.has(s)) { pending.delete(s); res2({ ok: false, error: { code: 'TIMEOUT' } }); } }, 5000);
      }),
      close: () => ws.close(),
    }));
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.seq && pending.has(frame.seq)) { pending.get(frame.seq)(frame); pending.delete(frame.seq); }
    });
    ws.on('error', reject);
  });
}
const LOGIN = 1, GET_AGENT_TOKEN = 64;
const CREATE_ALLIANCE = 101, GET_ALLIANCE = 102, LIST_ALLIANCES = 103;
const ALLIANCE_KICK = 109, ALLIANCE_SET_ROLE = 110, ALLIANCE_SET_NOTICE = 111, ALLIANCE_LEAVE = 107, ALLIANCE_DISBAND = 108;
const ALLIANCE_APPLY = 104, ALLIANCE_INVITE = 105, ALLIANCE_RESPOND = 106;

const player = await connect();
const login = await player.call(LOGIN, { username: 'bk_l', password: 'e2e-pass-123', asAgent: false });
if (!login.ok) { console.error('玩家登录失败', JSON.stringify(login.error)); process.exit(1); }
const tokRes = await player.call(GET_AGENT_TOKEN);
if (!tokRes.ok) { console.error('取令牌失败', JSON.stringify(tokRes.error)); process.exit(1); }
const token = tokRes.data.token ?? tokRes.data.agentToken;
console.log('✓ 玩家登录成功,Agent 令牌:', String(token).slice(0, 8) + '…');
player.close();

const agent = await connect();
const agentLogin = await agent.call(LOGIN, { token, asAgent: true });
console.log(agentLogin.ok ? '✓ Agent 令牌登录成功 role=' + agentLogin.data?.role : '✗ Agent 登录失败 ' + JSON.stringify(agentLogin.error));

const manageOps: [string, number, unknown][] = [
  ['CREATE_ALLIANCE', CREATE_ALLIANCE, { name: 'agent盟' }],
  ['ALLIANCE_APPLY', ALLIANCE_APPLY, { allianceId: '00000000-0000-0000-0000-000000000000' }],
  ['ALLIANCE_INVITE', ALLIANCE_INVITE, { username: 'bk_m1' }],
  ['ALLIANCE_RESPOND', ALLIANCE_RESPOND, { kind: 'request', id: '00000000-0000-0000-0000-000000000000', accept: true }],
  ['ALLIANCE_LEAVE', ALLIANCE_LEAVE, {}],
  ['ALLIANCE_DISBAND', ALLIANCE_DISBAND, {}],
  ['ALLIANCE_KICK', ALLIANCE_KICK, { username: 'bk_m1' }],
  ['ALLIANCE_SET_ROLE', ALLIANCE_SET_ROLE, { username: 'bk_m1', role: 'member' }],
  ['ALLIANCE_SET_NOTICE', ALLIANCE_SET_NOTICE, { notice: 'agent 改公告' }],
];
for (const [name, op, data] of manageOps) {
  const r = await agent.call(op, data);
  const code = r.error?.code;
  console.log((code === 'AGENT_FORBIDDEN' ? '✓' : '✗') + ` ${name}: ${code ?? JSON.stringify(r).slice(0, 150)}`);
}
const g = await agent.call(GET_ALLIANCE, {});
const ga = g.data?.alliance ?? g.data;
console.log((g.ok ? '✓' : '✗') + ` GET_ALLIANCE: ${g.ok ? '联盟=' + (ga?.name ?? JSON.stringify(ga).slice(0,80)) : JSON.stringify(g.error)}`);
const l = await agent.call(LIST_ALLIANCES, {});
console.log((l.ok ? '✓' : '✗') + ` LIST_ALLIANCES: ${l.ok ? '返回=' + JSON.stringify(l.data).slice(0, 100) : JSON.stringify(l.error)}`);
agent.close();
process.exit(0);
