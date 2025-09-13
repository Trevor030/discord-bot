// Discord bot → Crafty API (API Key) + fallback console + debug esteso
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

/* ========= ENV ========= */
const TOKEN     = process.env.DISCORD_TOKEN;
const BASE      = (process.env.CRAFTY_URL || '').replace(/\/+$/, ''); // es: https://192.168.1.82:8443  (senza /panel)
const API_KEY   = process.env.CRAFTY_API_KEY || '';                  // usa token da "Get A Token" o API key
const SERVER_ID = process.env.CRAFTY_SERVER_ID || '';
const INSECURE  = process.env.CRAFTY_INSECURE === '1';

if (!TOKEN)     { console.error('❌ Manca DISCORD_TOKEN'); process.exit(1); }
if (!BASE)      { console.error('❌ Manca CRAFTY_URL'); process.exit(1); }
if (!API_KEY)   { console.error('❌ Manca CRAFTY_API_KEY'); process.exit(1); }
if (!SERVER_ID) { console.error('❌ Manca CRAFTY_SERVER_ID'); process.exit(1); }

process.env.NODE_TLS_REJECT_UNAUTHORIZED = INSECURE ? '0' : '1';

/* ========= Discord ========= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

/* ========= HTTP client ========= */
const AX = axios.create({
  baseURL: BASE,
  timeout: 15000,
  validateStatus: s => s >= 200 && s < 400
});

// Varianti auth accettate da diverse build
const HEADERS_VARIANTS = [
  { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
  { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  { 'Authorization': `Token ${API_KEY}`, 'Content-Type': 'application/json' },
  { 'Authorization': `Api-Key ${API_KEY}`, 'Content-Type': 'application/json' },
];

function withKeyQuery(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}key=${encodeURIComponent(API_KEY)}`;
}

async function tryMany(reqBuilders, label) {
  let last;
  for (const build of reqBuilders) {
    const { method, url, data, headers } = build();
    try {
      const r = await AX.request({ method, url, data, headers });
      if (r.status >= 200 && r.status < 300) {
        const tag = headers?.['X-Api-Key'] ? 'X-Api-Key'
                  : (headers?.['Authorization'] ? 'Authorization' : 'headers');
        console.log(`✔️ ${label}: ${method.toUpperCase()} ${url} [ok with ${tag}]`);
        return r;
      }
      last = new Error(`HTTP ${r.status} @ ${url}`);
    } catch (e) { last = e; }
  }
  throw last || new Error(`${label}: nessuna risposta valida`);
}

/* ========= Endpoint sets ========= */
const listPaths   = [
  '/panel/api/v3/servers','/panel/api/v2/servers',
  '/api/v3/servers','/api/v2/servers','/api/servers'
];
const statusPaths = id => [
  // dettagli server
  `/panel/api/v3/servers/${id}`, `/panel/api/v2/servers/${id}`,
  `/api/v3/servers/${id}`, `/api/v2/servers/${id}`, `/api/servers/${id}`,
  // endpoint di stato dedicati (alcune build)
  `/panel/api/v3/servers/${id}/state`,  `/api/v3/servers/${id}/state`,
  `/panel/api/v2/servers/${id}/state`,  `/api/v2/servers/${id}/state`,
  `/panel/api/v3/servers/${id}/stats`,  `/api/v3/servers/${id}/stats`,
  `/panel/api/v2/servers/${id}/stats`,  `/api/v2/servers/${id}/stats`
];
const powerBuilders = (id, action) => [
  // v3 JSON body
  () => ({ method:'post', url:`/panel/api/v3/servers/${id}/power`, data:{ action } }),
  () => ({ method:'post', url:`/api/v3/servers/${id}/power`,       data:{ action } }),
  // v2 style (no body)
  () => ({ method:'post', url:`/panel/api/v2/servers/${id}/power/${action}` }),
  () => ({ method:'post', url:`/api/v2/servers/${id}/power/${action}` }),
  // generic
  () => ({ method:'post', url:`/panel/api/servers/${id}/power/${action}` }),
  () => ({ method:'post', url:`/api/servers/${id}/power/${action}` }),
];

// console command (per fallback stop/restart)
const commandBuilders = (id, command) => [
  () => ({ method:'post', url:`/panel/api/v3/servers/${id}/command`, data:{ command } }),
  () => ({ method:'post', url:`/api/v3/servers/${id}/command`,       data:{ command } }),
  () => ({ method:'post', url:`/panel/api/v2/servers/${id}/command`, data:{ command } }),
  () => ({ method:'post', url:`/api/v2/servers/${id}/command`,       data:{ command } }),
  () => ({ method:'post', url:`/panel/api/servers/${id}/command`,    data:{ command } }),
  () => ({ method:'post', url:`/api/servers/${id}/command`,          data:{ command } }),
];

/* ========= Wrappers ========= */
async function listServers() {
  const reqs = [];
  for (const p of listPaths) {
    for (const H of HEADERS_VARIANTS) reqs.push(() => ({ method:'get', url:p, headers:H }));
    reqs.push(() => ({ method:'get', url: withKeyQuery(p), headers:{ 'Content-Type':'application/json' } }));
  }
  const res = await tryMany(reqs, 'LIST');
  return res.data;
}

function parseStatusPayload(d) {
  const candidates = [
    d?.state, d?.status, d?.power, d?.running, d?.online,
    d?.server?.state, d?.server?.status, d?.server?.running, d?.server?.online,
    d?.data?.state, d?.data?.status, d?.data?.running, d?.data?.online,
    d?.result?.status, d?.result?.state, d?.result?.running,
    d?.server_state, d?.power_state, d?.current_state, d?.is_online
  ];
  for (const v of candidates) {
    if (v === true)  return 'running';
    if (v === false) return 'stopped';
    if (typeof v === 'string') return v.toLowerCase();
    if (typeof v === 'number') return v ? 'running' : 'stopped';
  }
  return 'unknown';
}

async function getStatus(id) {
  const reqs = [];
  for (const p of statusPaths(id)) {
    for (const H of HEADERS_VARIANTS) reqs.push(() => ({ method:'get', url:p, headers:H }));
    reqs.push(() => ({ method:'get', url: withKeyQuery(p), headers:{ 'Content-Type':'application/json' } }));
  }
  const res = await tryMany(reqs, 'STATUS');
  return { status: parseStatusPayload(res.data || {}), raw: res.data, path: res.request?.path || '' };
}

async function power(id, action) {
  const reqs = [];
  for (const b of powerBuilders(id, action)) {
    for (const H of HEADERS_VARIANTS) {
      const built = b();
      reqs.push(() => ({ ...built, headers: H }));
    }
    const built = b();
    reqs.push(() => ({ method: built.method || 'post', url: withKeyQuery(built.url), data: built.data, headers:{ 'Content-Type':'application/json' } }));
  }
  await tryMany(reqs, `POWER:${action}`);
}

async function sendConsoleCommand(id, command) {
  const reqs = [];
  for (const b of commandBuilders(id, command)) {
    for (const H of HEADERS_VARIANTS) reqs.push(() => ({ ...b(), headers:H }));
    const built = b();
    reqs.push(() => ({ method:'post', url: withKeyQuery(built.url), data: built.data, headers:{ 'Content-Type':'application/json' } }));
  }
  await tryMany(reqs, `COMMAND:${command}`);
}

/* ========= Bot commands ========= */
client.on('messageCreate', async (m) => {
  if (m.author.bot) return;
  const t = m.content.trim();

  if (t.toLowerCase() === '!server debug') {
    try {
      const whoPaths = ['/panel/api/v3/whoami','/api/v3/whoami','/panel/api/whoami','/api/whoami'];
      const reqs = [];
      for (const p of whoPaths) {
        for (const H of HEADERS_VARIANTS) reqs.push(() => ({ method:'get', url:p, headers:H }));
        reqs.push(() => ({ method:'get', url: withKeyQuery(p), headers:{ 'Content-Type':'application/json' } }));
      }
      let me = {};
      try { me = (await tryMany(reqs, 'WHOAMI')).data; } catch { me = { error:'whoami failed' }; }
      const data = await listServers();
      return m.channel.send('✅ API ok.\n**whoami:**```json\n' + JSON.stringify(me, null, 2).slice(0, 800) + '```\n**servers:**```json\n' + JSON.stringify(data, null, 2).slice(0, 800) + '```');
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.channel.send(`❌ API errore: \`${msg}\` — base: ${BASE}`);
    }
  }

  if (t.toLowerCase() === '!server status') {
    try {
      const { status } = await getStatus(SERVER_ID);
      return m.channel.send(`ℹ️ Stato server: **${status}**`);
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.channel.send(`❌ Errore status: \`${msg}\``);
    }
  }

  if (t.toLowerCase().startsWith('!server console ')) {
    const cmd = t.slice('!server console '.length).trim();
    if (!cmd) return m.channel.send('Uso: `!server console <comando>`');
    try {
      await sendConsoleCommand(SERVER_ID, cmd);
      return m.channel.send(`📝 Comando console inviato: \`${cmd}\``);
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.channel.send(`❌ Errore console: \`${msg}\``);
    }
  }

  if (t.toLowerCase() === '!server rawstatus') {
    try {
      const { raw, path } = await getStatus(SERVER_ID);
      return m.channel.send(`📦 Raw dallo status (${path || 'n/d'}):\n\`\`\`json\n${JSON.stringify(raw, null, 2).slice(0, 1800)}\n\`\`\``);
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.channel.send(`❌ Errore rawstatus: \`${msg}\``);
    }
  }

  if (['!server on','!server off','!server restart'].includes(t.toLowerCase())) {
    const map = { on:'start', off:'stop', restart:'restart' };
    const action = map[t.toLowerCase().split(' ').pop()];
    try {
      // 1) tenta API power
      await power(SERVER_ID, action);
      return m.channel.send(
        action === 'start' ? '🚀 Avvio richiesto.' :
        action === 'stop'  ? '⏹️ Arresto richiesto.' :
                             '🔄 Riavvio richiesto.'
      );
    } catch (e) {
      const code = e.response?.status || e.code || e.message || 'errore';
      console.log(`⚠️ POWER ${action} fallito:`, code);

      // 2) Fallback via console per stop/restart
      if (action === 'stop' || action === 'restart') {
        try {
          await sendConsoleCommand(SERVER_ID, action === 'stop' ? 'stop' : 'restart');
          return m.channel.send(`📝 Fallback console: inviato \`${action === 'stop' ? 'stop' : 'restart'}\`.`);
        } catch (e2) {
          const msg = e2.response?.status ? `HTTP ${e2.response.status}` : (e2.code || e2.message);
          return m.channel.send(`❌ Errore power e fallback console: \`${msg}\``);
        }
      }

      if (action === 'start') {
        // l'avvio via console non è possibile se il server è spento
        return m.channel.send('❌ Avvio non consentito via console. Serve che l’API accetti **Server Start**.');
      }
    }
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`BASE=${BASE} | INSECURE=${INSECURE?1:0} | SERVER_ID=${SERVER_ID}`);
});

client.login(TOKEN);
