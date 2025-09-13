// Discord bot → Crafty API (API Key) + fallback console + debug esteso + permscheck
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

/* ========= ENV ========= */
const TOKEN     = process.env.DISCORD_TOKEN;
const BASE      = (process.env.CRAFTY_URL || '').replace(/\/+$/, ''); // es: https://IP:8443  (senza /panel)
const API_KEY   = process.env.CRAFTY_API_KEY || '';                  // token da "Get A Token" (JWT) o API key accettata
const SERVER_ID = process.env.CRAFTY_SERVER_ID || '';               // UUID del server
const INSECURE  = process.env.CRAFTY_INSECURE === '1';

if (!TOKEN)     { console.error('❌ Manca DISCORD_TOKEN'); process.exit(1); }
if (!BASE)      { console.error('❌ Manca CRAFTY_URL'); process.exit(1); }
if (!API_KEY)   { console.error('❌ Manca CRAFTY_API_KEY'); process.exit(1); }
if (!SERVER_ID) { console.error('❌ Manca CRAFTY_SERVER_ID'); process.exit(1); }

// self-signed ok (solo LAN/test)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = INSECURE ? '0' : '1';

/* ========= Discord ========= */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

/* ========= HTTP client ========= */
const AX = axios.create({
  baseURL: BASE,
  timeout: 15000,
  maxRedirects: 0,                  // non seguire redirect verso /login
  validateStatus: s => s >= 200 && s < 300
});

// Varianti auth accettate da build diverse
const HEADERS_VARIANTS = [
  { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
  { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  { 'Authorization': `Token ${API_KEY}`, 'Content-Type': 'application/json' },
  { 'Authorization': `Api-Key ${API_KEY}`, 'Content-Type': 'application/json' },
];

// helper
const looksHtml = (data, headers) => {
  const ct = headers?.['content-type'] || headers?.['Content-Type'] || '';
  return (typeof data === 'string' && data.trim().startsWith('<!DOCTYPE')) || ct.includes('text/html');
};
const withKeyQuery = (url) => `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(API_KEY)}`;

async function tryMany(reqBuilders, label) {
  let last;
  for (const build of reqBuilders) {
    const { method, url, data, headers } = build();
    try {
      const r = await AX.request({ method, url, data, headers });
      if (r.status >= 300 && r.status < 400) { last = new Error(`REDIRECT ${r.status} @ ${url}`); continue; }
      if (looksHtml(r.data, r.headers))      { last = new Error(`HTML @ ${url}`); continue; }
      const tag = headers?.['X-Api-Key'] ? 'X-Api-Key'
                : (headers?.['Authorization'] ? 'Authorization' : 'headers');
      console.log(`✔️ ${label}: ${method.toUpperCase()} ${url} [ok with ${tag}]`);
      return r;
    } catch (e) { last = e; }
  }
  throw last || new Error(`${label}: nessuna risposta valida`);
}

/* ========= Endpoint sets ========= */
const listPaths = [
  '/panel/api/v3/servers','/panel/api/v2/servers',
  '/api/v3/servers','/api/v2/servers','/api/servers'
];

// 🔝 prova prima /state e /stats, poi i dettagli
const statusPaths = id => [
  `/panel/api/v3/servers/${id}/state`,
  `/api/v3/servers/${id}/state`,
  `/panel/api/v2/servers/${id}/state`,
  `/api/v2/servers/${id}/state`,
  `/panel/api/v3/servers/${id}/stats`,
  `/api/v3/servers/${id}/stats`,
  `/panel/api/v2/servers/${id}/stats`,
  `/api/v2/servers/${id}/stats`,
  `/panel/api/v3/servers/${id}`,
  `/panel/api/v2/servers/${id}`,
  `/api/v3/servers/${id}`,
  `/api/v2/servers/${id}`,
  `/api/servers/${id}`,
];

const powerBuilders = (id, action) => [
  () => ({ method:'post', url:`/panel/api/v3/servers/${id}/power`, data:{ action } }),
  () => ({ method:'post', url:`/api/v3/servers/${id}/power`,       data:{ action } }),
  () => ({ method:'post', url:`/panel/api/v2/servers/${id}/power/${action}` }),
  () => ({ method:'post', url:`/api/v2/servers/${id}/power/${action}` }),
  () => ({ method:'post', url:`/panel/api/servers/${id}/power/${action}` }),
  () => ({ method:'post', url:`/api/servers/${id}/power/${action}` }),
];

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

// Parser stato: guarda prima dentro d.data, poi d/result
function parseStatusPayload(d) {
  const dd = (d && typeof d === 'object' && d.data && typeof d.data === 'object') ? d.data : d;
  const candidates = [
    dd?.running, dd?.online, dd?.state, dd?.status, dd?.power,
    dd?.server_state, dd?.power_state, dd?.current_state, dd?.is_online,
    d?.result?.running, d?.result?.status, d?.result?.state
  ];
  for (const v of candidates) {
    if (v === true)  return 'running';
    if (v === false) return 'stopped';
    if (typeof v === 'number') return v ? 'running' : 'stopped';
    if (typeof v === 'string') return v.toLowerCase();
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
      return m.channel.send(`📦 Raw dallo stato (${path || 'n/d'}):\n\`\`\`json\n${JSON.stringify(raw, null, 2).slice(0, 1800)}\n\`\`\``);
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.channel.send(`❌ Errore rawstatus: \`${msg}\``);
    }
  }

  // ====== Permscheck rapido ======
  if (t.toLowerCase() === '!server permscheck') {
    const results = [];
    async function tryOne(label, fn) {
      try { await fn(); results.push(`${label}: OK`); }
      catch (e) { results.push(`${label}: ${e.response?.status ? 'HTTP '+e.response.status : (e.code || e.message)}`); }
    }
    await tryOne('POWER start',   () => power(SERVER_ID, 'start'));
    await tryOne('POWER stop',    () => power(SERVER_ID, 'stop'));
    await tryOne('POWER restart', () => power(SERVER_ID, 'restart'));
    await tryOne('CONSOLE say',   () => sendConsoleCommand(SERVER_ID, 'say permscheck'));
    return m.channel.send('🔎 Permscheck:\n```\n' + results.join('\n') + '\n```');
  }

  if (['!server on','!server off','!server restart'].includes(t.toLowerCase())) {
    const map = { on:'start', off:'stop', restart:'restart' };
    const action = map[t.toLowerCase().split(' ').pop()];
    try {
      await power(SERVER_ID, action);
      return m.channel.send(
        action === 'start' ? '🚀 Avvio richiesto.' :
        action === 'stop'  ? '⏹️ Arresto richiesto.' :
                             '🔄 Riavvio richiesto.'
      );
    } catch (e) {
      const code = e.response?.status || e.code || e.message || 'errore';
      console.log(`⚠️ POWER ${action} fallito:`, code);

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
