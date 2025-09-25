// Robust Discord ↔ Crafty bot (API Key preferred, fallback login user/pass)
// Commands: !server status | on | off | restart | rawstatus | debug
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const https = require('https');

// ===== ENV =====
const DISCORD_TOKEN     = process.env.DISCORD_TOKEN || '';
const CRAFTY_URL        = (process.env.CRAFTY_URL || '').replace(/\/+$/,'');
const CRAFTY_API_KEY    = process.env.CRAFTY_API_KEY || '';
const CRAFTY_SERVER_ID  = process.env.CRAFTY_SERVER_ID || '';
const CRAFTY_INSECURE   = process.env.CRAFTY_INSECURE === '1';

const CRAFTY_USER       = process.env.CRAFTY_USER || '';
const CRAFTY_PASSWORD   = process.env.CRAFTY_PASSWORD || '';

if (CRAFTY_INSECURE) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const httpsAgent = new https.Agent({ rejectUnauthorized: !CRAFTY_INSECURE });

// ===== Discord client (non uscire mai per errori imprevisti) =====
process.on('unhandledRejection', (r) => console.error('UNHANDLED:', r));
process.on('uncaughtException',  (e) => console.error('UNCAUGHT:', e));

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ===== Crafty helpers =====
const looksHtml = (data, headers={}) => {
  const ct = headers['content-type'] || '';
  return (typeof data === 'string' && data.trim().startsWith('<!DOCTYPE')) || ct.includes('text/html');
};
const API_BASES = ['/panel/api/v3', '/api/v3', '/panel/api/v2', '/api/v2'];

async function requestWithApiKey(path, method='GET', data) {
  const headersVariants = [
    { 'X-Api-Key': CRAFTY_API_KEY, 'Content-Type': 'application/json' },
    { 'Authorization': `Bearer ${CRAFTY_API_KEY}`, 'Content-Type': 'application/json' },
    { 'Authorization': `Token ${CRAFTY_API_KEY}`,  'Content-Type': 'application/json' },
    { 'Authorization': `Api-Key ${CRAFTY_API_KEY}`, 'Content-Type': 'application/json' },
  ];
  for (const base of API_BASES) {
    for (const H of headersVariants) {
      try {
        const r = await axios.request({
          baseURL: CRAFTY_URL + base,
          url: path, method, data, headers: H, httpsAgent,
          maxRedirects: 0, validateStatus: s => s>=200 && s<300
        });
        if (looksHtml(r.data, r.headers)) throw new Error('HTML/login');
        return r.data;
      } catch (_) {
        /* try query ?key= as last resort */
        try {
          const sep = path.includes('?') ? '&' : '?';
          const r2 = await axios.request({
            baseURL: CRAFTY_URL + base,
            url: `${path}${sep}key=${encodeURIComponent(CRAFTY_API_KEY)}`,
            method, data, headers: { 'Content-Type': 'application/json' }, httpsAgent,
            maxRedirects: 0, validateStatus: s => s>=200 && s<300
          });
          if (looksHtml(r2.data, r2.headers)) throw new Error('HTML/login');
          return r2.data;
        } catch {/* next variant */}
      }
    }
  }
  throw new Error('APIKEY_AUTH_FAILED');
}

// Minimal login/session via cookie con username/password (alcune build non lo permettono)
let cookieJar = '';
async function loginWithPassword() {
  try {
    // fetch login page to set cookies
    await axios.get(`${CRAFTY_URL}/panel/login`, { httpsAgent, maxRedirects:0, validateStatus:s=>s<400 });
  } catch {}
  // simple form post (molte build rifiutano comunque l’API se l’utente non ha accesso API)
  const form = new URLSearchParams({ username: CRAFTY_USER, password: CRAFTY_PASSWORD });
  const r = await axios.post(`${CRAFTY_URL}/panel/login`, form.toString(), {
    httpsAgent, maxRedirects: 0, validateStatus: s => s<400,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });
  const setCookie = r.headers['set-cookie'];
  if (!setCookie) throw new Error('NO_COOKIE');
  cookieJar = setCookie.map(c => c.split(';')[0]).join('; ');
  return true;
}
async function requestWithLogin(fullPath, method='GET', data) {
  if (!cookieJar) await loginWithPassword();
  const r = await axios.request({
    url: fullPath.startsWith('http') ? fullPath : (CRAFTY_URL + fullPath),
    method, data, httpsAgent, maxRedirects: 0, validateStatus: s=>s>=200&&s<300,
    headers: { 'Cookie': cookieJar, 'Content-Type':'application/json' }
  });
  if (looksHtml(r.data, r.headers)) throw new Error('HTML');
  return r.data;
}

// API unified
async function craftyGET(paths) {
  const normalized = Array.isArray(paths) ? paths : [paths];
  // prefer API key
  if (CRAFTY_API_KEY) {
    for (const p of normalized) {
      try { return await requestWithApiKey(p, 'GET'); } catch { /* next */ }
    }
  }
  // fallback login (se possibile)
  if (CRAFTY_USER && CRAFTY_PASSWORD) {
    for (const p of normalized) {
      try { return await requestWithLogin(p, 'GET'); } catch { /* next */ }
    }
  }
  throw new Error('NO_AUTH_WORKING');
}
async function craftyPOST(paths, body) {
  const normalized = Array.isArray(paths) ? paths : [paths];
  if (CRAFTY_API_KEY) {
    for (const p of normalized) {
      try { return await requestWithApiKey(p, 'POST', body); } catch { /* next */ }
    }
  }
  if (CRAFTY_USER && CRAFTY_PASSWORD) {
    for (const p of normalized) {
      try { return await requestWithLogin(p, 'POST', body); } catch { /* next */ }
    }
  }
  throw new Error('NO_AUTH_WORKING');
}

// Endpoints we try
const statusPaths = (id) => [
  `/servers/${id}/state`, `/servers/${id}/stats`,
].flatMap(s => API_BASES.map(b => `${b}${s}`)).concat([
  `/panel/api/v3/servers/${id}`, `/api/v3/servers/${id}`,
  `/panel/api/v2/servers/${id}`, `/api/v2/servers/${id}`,
].map(x=>x)); // details fallback
const powerPaths  = (id, action) => [
  `/servers/${id}/power`,            // v3 body {action}
  `/servers/${id}/power/${action}`,  // v2 path
].flatMap(s => API_BASES.map(b => `${b}${s}`));
const commandPaths = (id) => [
  `/servers/${id}/command`
].flatMap(s => API_BASES.map(b => `${b}${s}`));

// Helpers
function parseStatus(d) {
  const dd = (d && typeof d === 'object' && d.data && typeof d.data === 'object') ? d.data : d;
  const cand = [dd?.running, dd?.online, dd?.state, dd?.status, dd?.power, dd?.server_state, dd?.power_state, dd?.is_online];
  for (const v of cand) {
    if (v === true) return 'running';
    if (v === false) return 'stopped';
    if (typeof v === 'number') return v ? 'running' : 'stopped';
    if (typeof v === 'string') return v.toLowerCase();
  }
  return 'unknown';
}

async function getStatus() {
  const res = await craftyGET(statusPaths(CRAFTY_SERVER_ID));
  return parseStatus(res);
}
async function power(action) {
  // prova prima v3 (body {action}), poi v2 (/power/action)
  const body = { action };
  // v3
  for (const p of powerPaths(CRAFTY_SERVER_ID, action)) {
    try {
      if (p.includes('/power/')) { // v2
        await craftyPOST(p, undefined);
      } else {                     // v3
        await craftyPOST(p, body);
      }
      return true;
    } catch { /* next */ }
  }
  throw new Error('POWER_FAILED');
}
async function sendConsole(cmd) {
  for (const p of commandPaths(CRAFTY_SERVER_ID)) {
    try { await craftyPOST(p, { command: cmd }); return true; } catch { /* next */ }
  }
  throw new Error('CONSOLE_FAILED');
}

// ===== Bot =====
client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`BASE=${CRAFTY_URL} | INSECURE=${CRAFTY_INSECURE?1:0} | SERVER_ID=${CRAFTY_SERVER_ID} | AUTH=${CRAFTY_API_KEY?'API_KEY':(CRAFTY_USER?'LOGIN':'NONE')}`);
});

client.on('messageCreate', async (m) => {
  if (m.author.bot) return;
  if (!m.content.startsWith('!server')) return;

  const [ , sub, ...rest ] = m.content.trim().split(/\s+/);
  const c = (sub||'').toLowerCase();

  try {
    if (c === 'status') {
      const st = await getStatus();
      return m.reply(`Stato server: **${st}**`);
    }
    if (['on','off','restart'].includes(c)) {
      const map = { on:'start', off:'stop', restart:'restart' };
      await power(map[c]);
      return m.reply(
        c==='on' ? '🚀 Avvio richiesto.' :
        c==='off' ? '⏹️ Arresto richiesto.' : '🔄 Riavvio richiesto.'
      );
    }
    if (c === 'console') {
      const cmd = rest.join(' ').trim();
      if (!cmd) return m.reply('Uso: `!server console <comando>`');
      await sendConsole(cmd);
      return m.reply(`📝 Comando inviato: \`${cmd}\``);
    }
    if (c === 'rawstatus') {
      const st = await craftyGET(statusPaths(CRAFTY_SERVER_ID));
      return m.reply('Raw:\n```json\n' + JSON.stringify(st, null, 2).slice(0,1800) + '\n```');
    }
    if (c === 'debug') {
      return m.reply('Env:\n```json\n' + JSON.stringify({
        CRAFTY_URL, CRAFTY_INSECURE, AUTH: CRAFTY_API_KEY?'API_KEY':(CRAFTY_USER?'LOGIN':'NONE'),
        SERVER_ID: CRAFTY_SERVER_ID.slice(0,8)+'…'+CRAFTY_SERVER_ID.slice(-8)
      }, null, 2) + '\n```');
    }
    return m.reply('Comandi: `!server status | on | off | restart | console <cmd> | rawstatus | debug`');
  } catch (e) {
    const code = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
    return m.reply(`❌ Errore: \`${code}\``);
  }
});

if (!DISCORD_TOKEN || !CRAFTY_URL || !CRAFTY_SERVER_ID) {
  console.error('⚠️ ENV mancanti. Avvio comunque in attesa che lo stack venga aggiornato.');
} else {
  client.login(DISCORD_TOKEN);
}
