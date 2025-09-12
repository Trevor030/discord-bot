const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const https = require('https');
const http = require('http');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar, Cookie } = require('tough-cookie');

const TOKEN     = process.env.DISCORD_TOKEN;
const BASE      = (process.env.CRAFTY_URL || '').replace(/\/+$/,''); // es. https://IP:8443/panel
const USERNAME  = process.env.CRAFTY_USERNAME || '';
const PASSWORD  = process.env.CRAFTY_PASSWORD || '';
const SERVER_ID = process.env.CRAFTY_SERVER_ID || '';
const INSECURE  = process.env.CRAFTY_INSECURE === '1';

if (!TOKEN) { console.error('❌ Manca DISCORD_TOKEN'); process.exit(1); }
if (!BASE)  { console.error('❌ Manca CRAFTY_URL'); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const jar = new CookieJar();
const AX = wrapper(axios.create({
  baseURL: BASE,
  timeout: 12000,
  maxRedirects: 0,
  withCredentials: true,
  jar,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: !INSECURE }),
  validateStatus: s => s >= 200 && s < 400
}));

let csrfHeaderName = 'X-CSRF-Token';
let csrfToken = '';

function isHTML(r) {
  const ct = r.headers?.['content-type'] || '';
  return ct.includes('text/html') || (typeof r.data === 'string' && r.data.trim().startsWith('<!DOCTYPE'));
}

async function setTokenCookieIfMissing(tok) {
  // Crafty di solito imposta già il cookie "token" al login; se non c’è, lo settiamo noi.
  const url = new URL(BASE);
  const cookies = await jar.getCookies(BASE);
  const hasToken = cookies.some(c => c.key === 'token');
  if (!hasToken && tok) {
    await jar.setCookie(new Cookie({ key:'token', value: tok, domain: url.hostname, path:'/' }), BASE);
  }
}

async function extractCsrfFromCookies() {
  const cookies = await jar.getCookies(BASE);
  // gorilla/csrf usa cookie "gorilla.csrf.Token" (a volte "_gorilla_csrf")
  const c1 = cookies.find(c => c.key.toLowerCase().includes('gorilla') && c.key.toLowerCase().includes('csrf'));
  if (c1) csrfToken = c1.value;
}

async function login() {
  if (!USERNAME || !PASSWORD) throw new Error('CRAFTY_USERNAME/CRAFTY_PASSWORD mancanti');
  const payload = { username: USERNAME, password: PASSWORD };
  const paths = [
    '/api/v3/auth/login',
    '/api/auth/login',
    '/api/login',
    '/panel/api/v3/auth/login',
    '/panel/api/auth/login',
    '/panel/api/login'
  ];
  let last;
  for (const p of paths) {
    try {
      const r = await AX.post(p, payload);
      if (isHTML(r)) { last = new Error(`HTML @ ${p}`); continue; }
      const tok = r.data?.token || r.data?.access_token || r.data?.jwt || r.data?.data?.token;
      await setTokenCookieIfMissing(tok);
      // Dopo login, fai una GET alla home per farti dare i cookie CSRF
      try { await AX.get('/'); } catch {}
      await extractCsrfFromCookies();
      console.log(`🔐 Login OK via ${p} | CSRF=${csrfToken ? 'ok' : 'none'}`);
      return;
    } catch (e) { last = e; }
  }
  throw last || new Error('Login fallito');
}

function authHeaders() {
  const h = { 'Content-Type': 'application/json' };
  if (csrfToken) h[csrfHeaderName] = csrfToken;
  return h;
}

async function req(method, url, data) {
  const h = authHeaders();
  const r = await AX.request({ method, url, data, headers: h });
  if (isHTML(r)) throw new Error('HTML/login page');
  if (r.status >= 200 && r.status < 300) return r;
  throw new Error(`HTTP ${r.status}`);
}

const listPaths   = [
  '/api/v3/servers','/api/v2/servers','/api/servers',
  '/panel/api/v3/servers','/panel/api/v2/servers','/panel/api/servers'
];
const statusPaths = id => [
  `/api/v3/servers/${id}`, `/api/v2/servers/${id}`, `/api/servers/${id}`,
  `/panel/api/v3/servers/${id}`, `/panel/api/v2/servers/${id}`, `/panel/api/servers/${id}`
];
const powerVariants = (id, action) => [
  { m:'post', u:`/api/v3/servers/${id}/power`, d:{action} },
  { m:'post', u:`/panel/api/v3/servers/${id}/power`, d:{action} },
  { m:'post', u:`/api/v2/servers/${id}/power/${action}` },
  { m:'post', u:`/panel/api/v2/servers/${id}/power/${action}` },
  { m:'post', u:`/api/servers/${id}/power/${action}` },
  { m:'post', u:`/panel/api/servers/${id}/power/${action}` }
];

async function getServers() {
  let last;
  for (const p of listPaths) {
    try { const r = await req('get', p); console.log('✔️ LIST', p); return r.data; }
    catch (e) { last = e; }
  }
  throw last || new Error('LIST fallita');
}

async function getStatus(id) {
  let last;
  for (const p of statusPaths(id)) {
    try {
      const r = await req('get', p);
      console.log('✔️ STATUS', p);
      const d = r.data || {};
      const cands = [d.state,d.status,d.power,d.running,d.online,d?.server?.state,d?.server?.status,d?.data?.state,d?.data?.status,d?.result?.status];
      for (const v of cands) {
        if (v === true)  return 'running';
        if (v === false) return 'stopped';
        if (typeof v === 'string') return v.toLowerCase();
      }
      if (typeof d?.result?.running === 'boolean') return d.result.running ? 'running' : 'stopped';
      return 'unknown';
    } catch (e) { last = e; }
  }
  throw last || new Error('STATUS fallita');
}

async function power(id, action) {
  let last;
  for (const v of powerVariants(id, action)) {
    try { await req(v.m, v.u, v.d); console.log(`✔️ POWER ${action}`, v.u); return; }
    catch (e) { last = e; }
  }
  throw last || new Error(`POWER ${action} fallita`);
}

/* ---------- BOT ---------- */
client.on('messageCreate', async (m) => {
  if (m.author.bot) return;
  const t = m.content.trim().toLowerCase();

  if (t === '!server debug') {
    try {
      await login(); // garantisce i cookie
      const data = await getServers();
      return void m.channel.send('✅ API ok. /servers:\n```json\n' + JSON.stringify(data, null, 2).slice(0, 1800) + '\n```');
    } catch (e) {
      return void m.channel.send(`❌ API errore: \`${e.message}\` — base: ${BASE}`);
    }
  }

  if (t === '!server status') {
    try {
      await login();
      const st = await getStatus(SERVER_ID);
      return void m.channel.send(`ℹ️ Stato server: **${st}**`);
    } catch (e) {
      return void m.channel.send(`❌ Errore status: \`${e.message}\``);
    }
  }

  if (t === '!server on' || t === '!server off' || t === '!server restart') {
    const map = { on:'start', off:'stop', restart:'restart' };
    const action = map[t.split(' ').pop()];
    try {
      await login();
      await power(SERVER_ID, action);
      return void m.channel.send(
        action === 'start' ? '🚀 Avvio richiesto.' :
        action === 'stop'  ? '⏹️ Arresto richiesto.' :
                             '🔄 Riavvio richiesto.'
      );
    } catch (e) {
      return void m.channel.send(`❌ Errore power: \`${e.message}\``);
    }
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`BASE=${BASE} | INSECURE=${INSECURE?1:0} | USER=${USERNAME?'set':'none'} | SERVER_ID=${SERVER_ID||'(manca)'}`);
});

client.login(TOKEN);
