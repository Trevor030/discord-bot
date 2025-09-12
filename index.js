const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const https = require('https');
const http = require('http');

const TOKEN     = process.env.DISCORD_TOKEN;
const BASE      = (process.env.CRAFTY_URL || '').replace(/\/+$/,'');   // es. https://IP:8443  (senza /panel)
const API_KEY   = process.env.CRAFTY_API_KEY || '';
const USERNAME  = process.env.CRAFTY_USERNAME || '';
const PASSWORD  = process.env.CRAFTY_PASSWORD || '';
const SERVER_ID = process.env.CRAFTY_SERVER_ID || '';
const INSECURE  = process.env.CRAFTY_INSECURE === '1';

if (!TOKEN) { console.error('❌ Manca DISCORD_TOKEN'); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const AXIOS = axios.create({
  baseURL: BASE,
  timeout: 12000,
  maxRedirects: 0,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: !INSECURE }),
  validateStatus: s => s >= 200 && s < 400
});

let bearerToken = '';

function isHTML(r) {
  const ct = r.headers?.['content-type'] || '';
  return ct.includes('text/html') || (typeof r.data === 'string' && r.data.trim().startsWith('<!DOCTYPE'));
}

function headerVariants() {
  const arr = [];
  if (API_KEY) {
    arr.push({ 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' });
    arr.push({ 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' });
  }
  if (bearerToken) {
    arr.push({ 'Authorization': `Bearer ${bearerToken}`, 'Content-Type': 'application/json' });
  }
  return arr.length ? arr : [{ 'Content-Type': 'application/json' }];
}

async function tryReq(builders, label) {
  let lastErr;
  for (const build of builders) {
    const { method, url, data, headers } = build();
    try {
      const r = await AXIOS.request({ method, url, data, headers });
      if (isHTML(r)) { lastErr = new Error(`HTML @ ${url}`); continue; }
      if (r.status >= 200 && r.status < 300) { console.log(`✔️ ${label}: ${method.toUpperCase()} ${url}`); return r; }
      lastErr = new Error(`HTTP ${r.status} @ ${url}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`${label}: nessuna risposta valida`);
}

/* ---------- LOGIN ---------- */
async function loginIfNeeded() {
  if (bearerToken) return bearerToken;
  if (!USERNAME || !PASSWORD) throw new Error('Serve API key valida oppure CRAFTY_USERNAME/CRAFTY_PASSWORD');
  const payload = { username: USERNAME, password: PASSWORD };

  // Prova tutte le combinazioni note (con e senza /panel)
  const loginPaths = [
    '/api/v3/auth/login',
    '/api/auth/login',
    '/api/login',
    '/panel/api/v3/auth/login',
    '/panel/api/auth/login',
    '/panel/api/login',
  ];

  let last;
  for (const p of loginPaths) {
    try {
      const r = await AXIOS.post(p, payload);
      if (isHTML(r)) { last = new Error(`HTML @ ${p}`); continue; }
      const tok = r.data?.token || r.data?.access_token || r.data?.jwt || r.data?.data?.token;
      if (tok) {
        bearerToken = tok;
        console.log(`🔐 Login OK via ${p}`);
        return bearerToken;
      }
      last = new Error(`Login senza token @ ${p}`);
    } catch (e) { last = e; }
  }
  throw last || new Error('Login fallito su tutte le varianti');
}

/* ---------- API ---------- */
const listPaths   = [
  '/api/v3/servers','/api/v2/servers','/api/servers',
  '/panel/api/v3/servers','/panel/api/v2/servers','/panel/api/servers'
];
const statusPaths = id => [
  `/api/v3/servers/${id}`, `/api/v2/servers/${id}`, `/api/servers/${id}`,
  `/panel/api/v3/servers/${id}`, `/panel/api/v2/servers/${id}`, `/panel/api/servers/${id}`
];
const powerBuilders = (id, action) => [
  // v3 JSON body
  () => ({ method:'post', url:`/api/v3/servers/${id}/power`, data:{ action } }),
  () => ({ method:'post', url:`/panel/api/v3/servers/${id}/power`, data:{ action } }),
  // v2 style
  () => ({ method:'post', url:`/api/v2/servers/${id}/power/${action}` }),
  () => ({ method:'post', url:`/panel/api/v2/servers/${id}/power/${action}` }),
  // generic
  () => ({ method:'post', url:`/api/servers/${id}/power/${action}` }),
  () => ({ method:'post', url:`/panel/api/servers/${id}/power/${action}` }),
];

async function withAuthBuilders(buildersFn, label) {
  // prova con API key; se HTML/401/404, fai login e riprova con Bearer
  const headers1 = headerVariants();
  try {
    return await tryReq(buildersFn(headers1), label);
  } catch (_) {
    await loginIfNeeded();
    const headers2 = headerVariants();
    return await tryReq(buildersFn(headers2), label);
  }
}

async function getServers() {
  const res = await withAuthBuilders(
    headers => listPaths.flatMap(p => headers.map(h => () => ({ method:'get', url:p, headers:h }))),
    'LIST'
  );
  return res.data;
}

async function getStatus(id) {
  const res = await withAuthBuilders(
    headers => statusPaths(id).flatMap(p => headers.map(h => () => ({ method:'get', url:p, headers:h }))),
    'STATUS'
  );
  const d = res.data || {};
  const cands = [d.state,d.status,d.power,d.running,d.online,d?.server?.state,d?.server?.status,d?.data?.state,d?.data?.status,d?.result?.status];
  for (const v of cands) {
    if (v === true)  return 'running';
    if (v === false) return 'stopped';
    if (typeof v === 'string') return v.toLowerCase();
  }
  if (typeof d?.result?.running === 'boolean') return d.result.running ? 'running' : 'stopped';
  return 'unknown';
}

async function power(id, action) {
  await withAuthBuilders(
    headers => powerBuilders(id, action).flatMap(b => headers.map(h => () => ({ ...b(), headers:h }))),
    `POWER:${action}`
  );
}

/* ---------- BOT ---------- */
client.on('messageCreate', async (m) => {
  if (m.author.bot) return;
  const t = m.content.trim().toLowerCase();

  if (t === '!server debug') {
    try {
      const data = await getServers();
      return void m.channel.send('✅ API ok. /servers:\n```json\n' + JSON.stringify(data, null, 2).slice(0, 1800) + '\n```');
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message || String(e));
      return void m.channel.send(`❌ API errore: \`${msg}\` — base: ${BASE}`);
    }
  }

  if (t === '!server status') {
    try {
      const st = await getStatus(SERVER_ID);
      return void m.channel.send(`ℹ️ Stato server: **${st}**`);
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message || String(e));
      return void m.channel.send(`❌ Errore status: \`${msg}\``);
    }
  }

  if (t === '!server on' || t === '!server off' || t === '!server restart') {
    const map = { on:'start', off:'stop', restart:'restart' };
    const action = map[t.split(' ').pop()];
    try {
      await power(SERVER_ID, action);
      return void m.channel.send(
        action === 'start' ? '🚀 Avvio richiesto.' :
        action === 'stop'  ? '⏹️ Arresto richiesto.' :
                             '🔄 Riavvio richiesto.'
      );
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message || String(e));
      return void m.channel.send(`❌ Errore power: \`${msg}\``);
    }
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`BASE=${BASE} | INSECURE=${INSECURE?1:0} | API_KEY=${API_KEY?'set':'none'} | USER=${USERNAME?'set':'none'} | SERVER_ID=${SERVER_ID||'(manca)'}`);
});

client.login(TOKEN);
