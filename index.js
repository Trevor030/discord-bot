// Discord ↔ Crafty (login con user/password, cookie di sessione + CSRF)
// Comandi: !server status | on | off | restart | rawstatus | debug | permscheck | token
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');

// ====== ENV ======
const DISCORD_TOKEN      = process.env.DISCORD_TOKEN;
const CRAFTY_URL         = (process.env.CRAFTY_URL || '').replace(/\/+$/, ''); // es: https://192.168.1.82:8443
const CRAFTY_INSECURE    = process.env.CRAFTY_INSECURE === '1';                 // 1 = accetta self-signed
const CRAFTY_USER        = process.env.CRAFTY_USER || '';
const CRAFTY_PASSWORD    = process.env.CRAFTY_PASSWORD || '';
const CRAFTY_SERVER_ID   = process.env.CRAFTY_SERVER_ID || '';                  // UUID del server

if (!DISCORD_TOKEN)    throw new Error('Manca DISCORD_TOKEN');
if (!CRAFTY_URL)       throw new Error('Manca CRAFTY_URL');
if (!CRAFTY_USER)      throw new Error('Manca CRAFTY_USER');
if (!CRAFTY_PASSWORD)  throw new Error('Manca CRAFTY_PASSWORD');
if (!CRAFTY_SERVER_ID) throw new Error('Manca CRAFTY_SERVER_ID');

if (CRAFTY_INSECURE) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ====== Discord client ======
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ====== HTTP client con cookie ======
const jar = new CookieJar();
const http = wrapper(axios.create({
  baseURL: CRAFTY_URL,
  jar,
  withCredentials: true,
  timeout: 15000,
  maxRedirects: 0,                              // non seguire redirect al /login
  validateStatus: s => s >= 200 && s < 400
}));

// ---- util ----
const htmlLike = (data, headers) => {
  const ct = headers?.['content-type'] || '';
  return typeof data === 'string' && data.trim().startsWith('<!DOCTYPE')
      || ct.includes('text/html');
};

async function getCsrfFromCookies() {
  const cookies = await jar.getCookies(CRAFTY_URL);
  const c = cookies.find(x =>
    /csrf/i.test(x.key) || x.key === 'gorilla_csrf' || x.key === 'csrftoken'
  );
  return c?.value || '';
}

async function fetchLoginPage() {
  // la maggior parte delle build usa /panel/login; fallback /login
  try { return await http.get('/panel/login'); } catch { /* ignore */ }
  return await http.get('/login');
}

async function postLogin(username, password) {
  // Ottieni CSRF e cookie iniziali
  await fetchLoginPage();
  const csrf = await getCsrfFromCookies();

  const form = new URLSearchParams({ username, password });
  // Alcune build richiedono X-CSRF-Token; altre lo prendono dal cookie
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    ...(csrf ? { 'X-CSRF-Token': csrf } : {})
  };

  // prova /panel/login poi /login
  try {
    const r = await http.post('/panel/login', form.toString(), { headers });
    if (r.status === 200 || r.status === 302) return true;
  } catch { /* try fallback */ }

  const r2 = await http.post('/login', form.toString(), { headers });
  return (r2.status === 200 || r2.status === 302);
}

let sessionReady = false;
async function ensureSession() {
  if (sessionReady) return true;
  // verifica con un ping API che la sessione esista
  try {
    const test = await http.get('/panel/api/v3/whoami');
    if (!htmlLike(test.data, test.headers)) { sessionReady = true; return true; }
  } catch { /* login below */ }

  // login
  const ok = await postLogin(CRAFTY_USER, CRAFTY_PASSWORD);
  sessionReady = ok;
  return ok;
}

// Costruisci lista di endpoint alternativi (v3/v2 + /panel)
const statusPaths = id => [
  `/panel/api/v3/servers/${id}/state`, `/api/v3/servers/${id}/state`,
  `/panel/api/v2/servers/${id}/state`, `/api/v2/servers/${id}/state`,
  `/panel/api/v3/servers/${id}/stats`, `/api/v3/servers/${id}/stats`,
  `/panel/api/v2/servers/${id}/stats`, `/api/v2/servers/${id}/stats`
];
const detailPaths = id => [
  `/panel/api/v3/servers/${id}`, `/api/v3/servers/${id}`,
  `/panel/api/v2/servers/${id}`, `/api/v2/servers/${id}`
];
const powerPaths = (id, action) => [
  { method:'post', url:`/panel/api/v3/servers/${id}/power`, data:{ action } },
  { method:'post', url:`/api/v3/servers/${id}/power`,       data:{ action } },
  { method:'post', url:`/panel/api/v2/servers/${id}/power/${action}` },
  { method:'post', url:`/api/v2/servers/${id}/power/${action}` }
];
const commandPaths = (id, cmd) => [
  { method:'post', url:`/panel/api/v3/servers/${id}/command`, data:{ command: cmd } },
  { method:'post', url:`/api/v3/servers/${id}/command`,       data:{ command: cmd } },
  { method:'post', url:`/panel/api/v2/servers/${id}/command`, data:{ command: cmd } },
  { method:'post', url:`/api/v2/servers/${id}/command`,       data:{ command: cmd } }
];

function parseStatus(d) {
  const dd = (d && typeof d === 'object' && d.data && typeof d.data === 'object') ? d.data : d;
  const cand = [
    dd?.running, dd?.online, dd?.state, dd?.status, dd?.power,
    dd?.server_state, dd?.power_state, dd?.current_state, dd?.is_online
  ];
  for (const v of cand) {
    if (v === true)  return 'running';
    if (v === false) return 'stopped';
    if (typeof v === 'number') return v ? 'running' : 'stopped';
    if (typeof v === 'string') return v.toLowerCase();
  }
  return 'unknown';
}

async function tryMany(builders, label) {
  let lastErr;
  for (const b of builders) {
    const req = typeof b === 'function' ? b() : b;
    const csrf = await getCsrfFromCookies();
    const headers = { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) };
    try {
      const r = await http.request({ ...req, headers });
      if (htmlLike(r.data, r.headers)) { lastErr = new Error('HTML/login'); continue; }
      console.log(`✔️ ${label}: ${req.method?.toUpperCase() || 'GET'} ${req.url}`);
      return r.data;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`${label}: nessuna risposta valida`);
}

async function getServerStatus(id) {
  await ensureSession();
  try {
    return await tryMany(statusPaths(id).map(u => ({ method:'get', url:u })), 'STATUS');
  } catch {
    // fallback ai dettagli
    return await tryMany(detailPaths(id).map(u => ({ method:'get', url:u })), 'DETAIL');
  }
}

async function power(id, action) {
  await ensureSession();
  return await tryMany(powerPaths(id, action), `POWER:${action}`);
}

async function sendConsole(id, command) {
  await ensureSession();
  return await tryMany(commandPaths(id, command), `COMMAND:${command}`);
}

// ====== Discord commands ======
client.on('messageCreate', async (m) => {
  if (m.author.bot) return;
  if (!m.content.startsWith('!server')) return;

  const [, sub, ...rest] = m.content.trim().split(/\s+/);
  const lower = (sub || '').toLowerCase();

  if (lower === 'status') {
    try {
      const data = await getServerStatus(CRAFTY_SERVER_ID);
      const st = parseStatus(data);
      return m.reply(`Stato server: **${st}**`);
    } catch (e) {
      const code = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.reply(`❌ Errore status: \`${code}\``);
    }
  }

  if (lower === 'rawstatus') {
    try {
      const data = await getServerStatus(CRAFTY_SERVER_ID);
      return m.reply('Raw stato:\n```json\n' + JSON.stringify(data, null, 2).slice(0, 1800) + '\n```');
    } catch (e) {
      const code = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.reply(`❌ Errore rawstatus: \`${code}\``);
    }
  }

  if (['on','off','restart'].includes(lower)) {
    const map = { on:'start', off:'stop', restart:'restart' };
    const action = map[lower];
    try {
      await power(CRAFTY_SERVER_ID, action);
      return m.reply(
        action === 'start' ? '🚀 Avvio richiesto.' :
        action === 'stop'  ? '⏹️ Arresto richiesto.' :
                             '🔄 Riavvio richiesto.'
      );
    } catch (e) {
      const code = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.reply(`❌ Errore power ${lower}: \`${code}\``);
    }
  }

  if (lower === 'console') {
    const cmd = rest.join(' ').trim();
    if (!cmd) return m.reply('Uso: `!server console <comando>`');
    try {
      await sendConsole(CRAFTY_SERVER_ID, cmd);
      return m.reply(`📝 Comando console inviato: \`${cmd}\``);
    } catch (e) {
      const code = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.reply(`❌ Errore console: \`${code}\``);
    }
  }

  if (lower === 'debug') {
    try {
      await ensureSession();
      let who = null, list = null;
      try { who  = await tryMany([ {method:'get', url:'/panel/api/v3/whoami'}, {method:'get', url:'/api/v3/whoami'} ], 'WHOAMI'); } catch {}
      try { list = await tryMany([ {method:'get', url:'/panel/api/v3/servers'}, {method:'get', url:'/api/v3/servers'}, {method:'get', url:'/panel/api/v2/servers'}, {method:'get', url:'/api/v2/servers'} ], 'LIST'); } catch {}
      return m.reply(
        '✅ Sessione attiva.\nwhoami:\n```json\n' + JSON.stringify(who,  null, 2).slice(0, 500) + '```\n' +
        'servers:\n```json\n' + JSON.stringify(list, null, 2).slice(0, 800) + '```'
      );
    } catch (e) {
      const code = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
      return m.reply(`❌ Debug error: \`${code}\``);
    }
  }

  if (lower === 'permscheck') {
    const results = [];
    async function tryOne(label, fn) {
      try { await fn(); results.push(`${label}: OK`); }
      catch (e) { results.push(`${label}: ${e.response?.status ? 'HTTP '+e.response.status : (e.code || e.message)}`); }
    }
    await tryOne('POWER start',   () => power(CRAFTY_SERVER_ID, 'start'));
    await tryOne('POWER stop',    () => power(CRAFTY_SERVER_ID, 'stop'));
    await tryOne('POWER restart', () => power(CRAFTY_SERVER_ID, 'restart'));
    await tryOne('CONSOLE say',   () => sendConsole(CRAFTY_SERVER_ID, 'say permscheck'));
    return m.reply('🔎 Permscheck:\n```\n' + results.join('\n') + '\n```');
  }

  if (lower === 'token') {
    // qui mostriamo solo info ambiente (user-based, non token-based)
    return m.reply(`👤 Login utente: \`${CRAFTY_USER}\` • URL: \`${CRAFTY_URL}\``);
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`BASE=${CRAFTY_URL} | INSECURE=${CRAFTY_INSECURE?1:0} | SERVER_ID=${CRAFTY_SERVER_ID} | USER=${CRAFTY_USER}`);
});

client.login(DISCORD_TOKEN);
