// Discord bot → Crafty API (API Key) + fallback console
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// ====== ENV ======
const TOKEN     = process.env.DISCORD_TOKEN;
const BASE      = (process.env.CRAFTY_URL || '').replace(/\/+$/, ''); // es: https://192.168.1.82:8443  (senza /panel)
const API_KEY   = process.env.CRAFTY_API_KEY || '';                  // usa la chiave/token preso da "Get A Token"
const SERVER_ID = process.env.CRAFTY_SERVER_ID || '';
const INSECURE  = process.env.CRAFTY_INSECURE === '1';

if (!TOKEN)     { console.error('❌ Manca DISCORD_TOKEN'); process.exit(1); }
if (!BASE)      { console.error('❌ Manca CRAFTY_URL'); process.exit(1); }
if (!API_KEY)   { console.error('❌ Manca CRAFTY_API_KEY'); process.exit(1); }
if (!SERVER_ID) { console.error('❌ Manca CRAFTY_SERVER_ID'); process.exit(1); }

// self-signed ok se INSECURE=1 (LAN)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = INSECURE ? '0' : '1';

// ====== Discord client ======
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ====== HTTP client & auth variants ======
const AX = axios.create({
  baseURL: BASE,
  timeout: 15000,
  validateStatus: s => s >= 200 && s < 400
});

// Prova vari header (alcune build vogliono Bearer <TOKEN>; altre X-Api-Key)
const HEADERS_VARIANTS = [
  { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
  { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  { 'Authorization': `Token ${API_KEY}`, 'Content-Type': 'application/json' },
  { 'Authorization': `Api-Key ${API_KEY}`, 'Content-Type': 'application/json' },
];

// Utility per testare più richieste finché una va
async function tryMany(reqBuilders, label) {
  let last;
  for (const build of reqBuilders) {
    const { method, url, data, headers } = build();
    try {
      const r = await AX.request({ method, url, data, headers });
      if (r.status >= 200 && r.status < 300) {
        const tag = headers['X-Api-Key'] ? 'X-Api-Key'
                  : (headers['Authorization'] ? 'Authorization' : 'headers');
        console.log(`✔️ ${label}: ${method.toUpperCase()} ${url} [ok with ${tag}]`);
        return r;
      }
      last = new Error(`HTTP ${r.status} @ ${url}`);
    } catch (e) { last = e; }
  }
  throw last || new Error(`${label}: nessuna risposta valida`);
}

// Alcune build accettano ?key=<API_KEY> in query
function withKeyQuery(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}key=${encodeURIComponent(API_KEY)}`;
}

// ====== Endpoint paths ======
const listPaths   = [
  '/panel/api/v3/servers','/panel/api/v2/servers',
  '/api/v3/servers','/api/v2/servers','/api/servers'
];
const statusPaths = id => [
  `/panel/api/v3/servers/${id}`,`/panel/api/v2/servers/${id}`,
  `/api/v3/servers/${id}`,`/api/v2/servers/${id}`,`/api/servers/${id}`
];
const powerBuilders = (id, action) => [
  // v3 JSON body
  () => ({ method:'post', url:`/panel/api/v3/servers/${id}/power`, data:{ action } }),
  () => ({ method:'post', url:`/api/v3/servers/${id}/power`, data:{ action } }),
  // v2 style (no body)
  () => ({ method:'post', url:`/panel/api/v2/servers/${id}/power/${action}` }),
  () => ({ method:'post', url:`/api/v2/servers/${id}/power/${action}` }),
  // generic
  () => ({ method:'post', url:`/panel/api/servers/${id}/power/${action}` }),
  () => ({ method:'post', url:`/api/servers/${id}/power/${action}` }),
];

// ====== API wrappers ======
async function listServers() {
  const reqs = [];
  for (const p of listPaths) {
    for (const H of HEADERS_VARIANTS) reqs.push(() => ({ method:'get', url:p, headers:H }));
    reqs.push(() => ({ method:'get', url: withKeyQuery(p), headers:{ 'Content-Type':'application/json' } }));
  }
  const res = await tryMany(reqs, 'LIST');
  return res.data;
}

async function getStatus(id) {
  const reqs = [];
  for (const p of statusPaths(id)) {
    for (const H of HEADERS_VARIANTS) reqs.push(() => ({ method:'get', url:p, headers:H }));
    reqs.push(() => ({ method:'get', url: withKeyQuery(p), headers:{ 'Content-Type':'application/json' } }));
  }
  const res = await tryMany(reqs, 'STATUS');
  const d = res.data || {};
  const c = [d.state,d.status,d.power,d.running,d.online,d?.server?.state,d?.server?.status,d?.data?.state,d?.data?.status,d?.result?.status];
  for (const v of c) {
    if (v === true)  return 'running';
    if (v === false) return 'stopped';
    if (typeof v === 'string') return v.toLowerCase();
  }
  if (typeof d?.result?.running === 'boolean') return d.result.running ? 'running' : 'stopped';
  return 'unknown';
}

async function power(id, action) {
  const reqs = [];
  for (const b of powerBuilders(id, action)) {
    for (const H of HEADERS_VARIANTS) {
      const built = b();
      reqs.push(() => ({ ...built, headers: H }));
    }
    // variante ?key=
    const built = b();
    reqs.push(() => ({ method: built.method || 'post', url: withKeyQuery(built.url), data: built.data, headers:{ 'Content-Type':'application/json' } }));
  }
  await tryMany(reqs, `POWER:${action}`);
}

// ====== FALLBACK: console command (stop/restart) ======
async function sendConsoleCommand(id, command) {
  const variants = [
    () => ({ method:'post', url:`/panel/api/v3/servers/${id}/command`, data:{ command } }),
    () => ({ method:'post', url:`/api/v3/servers/${id}/command`,       data:{ command } }),
    () => ({ method:'post', url:`/panel/api/v2/servers/${id}/command`, data:{ command } }),
    () => ({ method:'post', url:`/api/v2/servers/${id}/command`,       data:{ command } }),
    () => ({ method:'post', url:`/panel/api/servers/${id}/command`,    data:{ command } }),
    () => ({ method:'post', url:`/api/servers/${id}/command`,          data:{ command } }),
  ];
  const reqs = [];
  for (const build of variants) {
    for (const H of HEADERS_VARIANTS) {
      const b = build();
      reqs.push(() => AX.request({ ...b, headers: H }));
    }
    const b = variants[0]();
    reqs.push(() => AX.request({ method:'post', url: withKeyQuery(b.url), data: b.data, headers:{ 'Content-Type':'application/json' } }));
  }
  await tryMany(reqs, `COMMAND:${command}`);
}

// ====== Bot commands ======
client.on('messageCreate', async (m) => {
  if (m.author.bot) return;
  const t = m.content.trim().toLowerCase();

  if (t === '!server debug') {
    try {
      const me = await (async () => {
        const whoPaths = ['/panel/api/v3/whoami','/api/v3/whoami','/panel/api/whoami','/api/whoami'];
        const reqs = [];
        for (const p of whoPaths) {
          for (const H of HEADERS_VARIANTS) reqs.push(() => ({ method:'get', url:p, headers:H }));
          reqs.push(() => ({ method:'get', url: withKeyQuery(p), headers:{ 'Content-Type':'application/json' } }));
        }
        try { return (await tryMany(reqs, 'WHOAMI')).data; } catch { return { error:'whoami failed' }; }
      })();
      const data = await listServers();
      return m.channel.send('✅ API ok.\n**whoami:**```json\n' + JSON.stringify(me, null, 2).slice(0, 800) + '```\n**servers:**```json\n' + JSON.stringify(data, null, 2).slice(0, 800) + '```');
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.channel.send(`❌ API errore: \`${msg}\` — base: ${BASE}`);
    }
  }

  if (t === '!server status') {
    try {
      const st = await getStatus(SERVER_ID);
      return m.channel.send(`ℹ️ Stato server: **${st}**`);
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.channel.send(`❌ Errore status: \`${msg}\``);
    }
  }

  if (t === '!server on' || t === '!server off' || t === '!server restart') {
    const map = { on:'start', off:'stop', restart:'restart' };
    const action = map[t.split(' ').pop()];

    try {
      // 1) tenta i power API
      await power(SERVER_ID, action);
      return m.channel.send(
        action === 'start' ? '🚀 Avvio richiesto.' :
        action === 'stop'  ? '⏹️ Arresto richiesto.' :
                             '🔄 Riavvio richiesto.'
      );

    } catch (e) {
      const code = e.response?.status || '';
      console.log(`⚠️ POWER ${action} fallito`, code || e.message || e);

      // 2) Fallback via console per stop/restart
      if (action === 'stop') {
        try {
          await sendConsoleCommand(SERVER_ID, 'stop');
          return m.channel.send('📝 Fallback console: inviato `stop`.');
        } catch (e2) {
          const msg = e2.response?.status ? `HTTP ${e2.response.status}` : (e2.code || e2.message);
          return m.channel.send(`❌ Errore power e fallback console: \`${msg}\``);
        }
      }
      if (action === 'restart') {
        try {
          await sendConsoleCommand(SERVER_ID, 'restart');
          return m.channel.send('📝 Fallback console: inviato `restart`.');
        } catch (e2) {
          const msg = e2.response?.status ? `HTTP ${e2.response.status}` : (e2.code || e2.message);
          return m.channel.send(`❌ Errore power e fallback console: \`${msg}\``);
        }
      }
      if (action === 'start') {
        // avvio via console non possibile: serve permesso power Start
        return m.channel.send('❌ Non posso avviare via console. Abilita **Server Start** nell’API key oppure usa i power API.');
      }
    }
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`BASE=${BASE} | INSECURE=${INSECURE?1:0} | SERVER_ID=${SERVER_ID}`);
});

client.login(TOKEN);
