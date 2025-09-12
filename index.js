const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const TOKEN     = process.env.DISCORD_TOKEN;
const BASE      = (process.env.CRAFTY_URL || '').replace(/\/+$/, ''); // es: https://IP:8443/panel
const API_KEY   = process.env.CRAFTY_API_KEY || '';
const SERVER_ID = process.env.CRAFTY_SERVER_ID || '';
const INSECURE  = process.env.CRAFTY_INSECURE === '1';

if (!TOKEN) { console.error('❌ Manca DISCORD_TOKEN'); process.exit(1); }
if (!BASE)  { console.error('❌ Manca CRAFTY_URL'); process.exit(1); }
if (!API_KEY) { console.error('❌ Manca CRAFTY_API_KEY'); process.exit(1); }
if (!SERVER_ID) { console.error('❌ Manca CRAFTY_SERVER_ID'); process.exit(1); }

process.env.NODE_TLS_REJECT_UNAUTHORIZED = INSECURE ? '0' : '1';

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// Prepara varie forme di autenticazione (alcune build vogliono Bearer <TOKEN> ottenuto da "Get A Token")
const HEADERS_VARIANTS = [
  { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
  { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
  { 'Authorization': `Token ${API_KEY}`, 'Content-Type': 'application/json' },
  { 'Authorization': `Api-Key ${API_KEY}`, 'Content-Type': 'application/json' },
];

const AX = axios.create({
  baseURL: BASE,
  timeout: 15000,
  validateStatus: s => s >= 200 && s < 400
});

async function tryMany(reqBuilders, label) {
  let last;
  for (const build of reqBuilders) {
    const { method, url, data, headers } = build();
    try {
      const r = await AX.request({ method, url, data, headers });
      if (r.status >= 200 && r.status < 300) {
        console.log(`✔️ ${label}: ${method.toUpperCase()} ${url} [ok with ${Object.keys(headers)[0]}]`);
        return r;
      }
      last = new Error(`HTTP ${r.status} @ ${url}`);
    } catch (e) { last = e; }
  }
  throw last || new Error(`${label}: nessuna risposta valida`);
}

// piccoli helper
const listPaths   = ['/panel/api/v3/servers','/panel/api/v2/servers','/api/v3/servers','/api/v2/servers','/api/servers'];
const statusPaths = id => [`/panel/api/v3/servers/${id}`,`/panel/api/v2/servers/${id}`,`/api/v3/servers/${id}`,`/api/v2/servers/${id}`,`/api/servers/${id}`];
const powerBuilders = (id, action) => [
  () => ({ method:'post', url:`/panel/api/v3/servers/${id}/power`, data:{ action } }),
  () => ({ method:'post', url:`/api/v3/servers/${id}/power`, data:{ action } }),
  () => ({ method:'post', url:`/panel/api/v2/servers/${id}/power/${action}` }),
  () => ({ method:'post', url:`/api/v2/servers/${id}/power/${action}` }),
  () => ({ method:'post', url:`/panel/api/servers/${id}/power/${action}` }),
  () => ({ method:'post', url:`/api/servers/${id}/power/${action}` }),
];

// alcune build accettano anche la chiave come query ?key=
function withKeyQuery(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}key=${encodeURIComponent(API_KEY)}`;
}

async function listServers() {
  const reqs = [];

  // prova headers vari + path vari
  for (const p of listPaths) {
    for (const H of HEADERS_VARIANTS) {
      reqs.push(() => ({ method:'get', url:p, headers:H }));
    }
    // prova anche la variante con ?key=
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
      reqs.push(() => ({ ...built, headers:H }));
    }
    // variante con ?key=
    const built = b();
    reqs.push(() => ({ method: built.method || 'post', url: withKeyQuery(built.url), data: built.data, headers:{ 'Content-Type':'application/json' } }));
  }
  await tryMany(reqs, `POWER:${action}`);
}

// comando diagnostico utile
async function whoami() {
  const paths = ['/panel/api/v3/whoami','/api/v3/whoami','/panel/api/whoami','/api/whoami'];
  const reqs = [];
  for (const p of paths) {
    for (const H of HEADERS_VARIANTS) reqs.push(() => ({ method:'get', url:p, headers:H }));
    reqs.push(() => ({ method:'get', url:withKeyQuery(p), headers:{ 'Content-Type':'application/json' } }));
  }
  try {
    const r = await tryMany(reqs, 'WHOAMI');
    return r.data;
  } catch (e) { return { error: String(e.message || e) }; }
}

client.on('messageCreate', async (m) => {
  if (m.author.bot) return;
  const t = m.content.trim().toLowerCase();

  if (t === '!server debug') {
    try {
      const me = await whoami();
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
      await power(SERVER_ID, action);
      return m.channel.send(
        action === 'start' ? '🚀 Avvio richiesto.' :
        action === 'stop'  ? '⏹️ Arresto richiesto.' :
                             '🔄 Riavvio richiesto.'
      );
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.channel.send(`❌ Errore power: \`${msg}\``);
    }
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`BASE=${BASE} | INSECURE=${INSECURE?1:0} | SERVER_ID=${SERVER_ID}`);
});

client.login(TOKEN);
