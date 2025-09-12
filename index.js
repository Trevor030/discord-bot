// Bot Discord + Crafty via API: API-Key oppure login (username/password) → Bearer token
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const https = require('https');
const http = require('http');

const TOKEN       = process.env.DISCORD_TOKEN;
const BASE_URL    = (process.env.CRAFTY_URL || '').replace(/\/+$/, '');        // es. https://IP:8443/panel
const API_KEY     = process.env.CRAFTY_API_KEY || '';                          // opzionale
const USERNAME    = process.env.CRAFTY_USERNAME || '';                         // fallback login
const PASSWORD    = process.env.CRAFTY_PASSWORD || '';                         // fallback login
const SERVER_ID   = process.env.CRAFTY_SERVER_ID || '';
const INSECURE    = process.env.CRAFTY_INSECURE === '1';

if (!TOKEN) { console.error('❌ Manca DISCORD_TOKEN'); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const AXIOS = axios.create({
  baseURL: BASE_URL,
  timeout: 10000,
  maxRedirects: 0,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: !INSECURE }),
  validateStatus: s => s >= 200 && s < 400   // considera anche 3xx per intercettare redirect a login
});

let bearerToken = ''; // cache token dopo il login

function isHTML(r) {
  const ct = r.headers?.['content-type'] || '';
  return ct.includes('text/html') || (typeof r.data === 'string' && r.data.trim().startsWith('<!DOCTYPE'));
}

async function loginIfNeeded() {
  if (bearerToken) return bearerToken;
  if (!USERNAME || !PASSWORD) throw new Error('Serve API key valida oppure CRAFTY_USERNAME/CRAFTY_PASSWORD');
  // Prova le due varianti più comuni:
  const payload = { username: USERNAME, password: PASSWORD };
  const paths = [
    '/api/v3/auth/login',          // BASE_URL già contiene /panel
    '/panel/api/v3/auth/login',    // nel caso BASE_URL fosse senza /panel
  ];
  let lastErr;
  for (const p of paths) {
    try {
      const r = await AXIOS.post(p, payload);
      if (isHTML(r)) { lastErr = new Error('Login ha restituito HTML (probabile path errato)'); continue; }
      const tok = r.data?.token || r.data?.access_token || r.data?.jwt || r.data?.data?.token;
      if (tok) {
        bearerToken = tok;
        console.log('🔐 Login Crafty OK (Bearer token ottenuto)');
        return bearerToken;
      }
      lastErr = new Error('Risposta login senza token');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Login Crafty fallito');
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
  return arr.length ? arr : [ { 'Content-Type': 'application/json' } ];
}

async function tryReq(builders) {
  let lastErr;
  for (const b of builders) {
    try {
      const r = await b();
      if (isHTML(r)) { lastErr = new Error('HTML/login page'); continue; }
      if (r.status >= 200 && r.status < 300) return r;
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Nessuna risposta valida');
}

// --- endpoints da provare (prefisso /panel già in BASE_URL) ---
const LIST_PATHS   = ['/api/v3/servers','/api/v2/servers','/api/servers'];
const STATUS_PATHS = id => [`/api/v3/servers/${id}`, `/api/v2/servers/${id}`, `/api/servers/${id}`];
const POWER_PATHS  = id => ([
  { path: `/api/v3/servers/${id}/power`, body: (a)=>({action:a}) },
  { path: `/api/v2/servers/${id}/power/start`,   body: ()=>({}), action:'start'},
  { path: `/api/v2/servers/${id}/power/stop`,    body: ()=>({}), action:'stop'},
  { path: `/api/v2/servers/${id}/power/restart`, body: ()=>({}), action:'restart'},
  { path: `/api/servers/${id}/power/start`,      body: ()=>({}), action:'start'},
  { path: `/api/servers/${id}/power/stop`,       body: ()=>({}), action:'stop'},
  { path: `/api/servers/${id}/power/restart`,    body: ()=>({}), action:'restart'},
]);

async function ensureAuth(headersBuilders) {
  // prova con API key; se ottieni HTML/redirect/401, prova login e ripeti con Bearer
  try { return await headersBuilders(); }
  catch {
    await loginIfNeeded();
    return headerVariants();
  }
}

async function getServers() {
  const headers = await ensureAuth(async () => headerVariants());
  return (await tryReq(
    LIST_PATHS.flatMap(p =>
      headers.map(h => () => AXIOS.get(p, { headers: h }))
    )
  )).data;
}

async function getStatus(id) {
  const headers = await ensureAuth(async () => headerVariants());
  const res = await tryReq(
    STATUS_PATHS(id).flatMap(p =>
      headers.map(h => () => AXIOS.get(p, { headers: h }))
    )
  );
  const d = res.data || {};
  const cands = [d.state,d.status,d.power,d.running,d.online,d?.server?.state,d?.server?.status,d?.data?.state,d?.data?.status];
  for (const v of cands) {
    if (v === true)  return 'running';
    if (v === false) return 'stopped';
    if (typeof v === 'string') return v.toLowerCase();
  }
  return 'unknown';
}

async function power(id, action) {
  const headers = await ensureAuth(async () => headerVariants());
  await tryReq(
    POWER_PATHS(id).flatMap(obj => {
      if (obj.action && obj.action !== action) return [];
      return headers.map(h => () => AXIOS.post(obj.path, obj.body(action), { headers: h }));
    })
  );
}

/* ====== Bot: comandi testuali ====== */
client.on('messageCreate', async (m) => {
  if (m.author.bot) return;
  const t = m.content.trim().toLowerCase();

  if (t === '!server debug') {
    try {
      const data = await getServers();
      return void m.channel.send('✅ API ok. /servers:\n```json\n' + JSON.stringify(data, null, 2).slice(0, 1800) + '\n```');
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message || String(e));
      return void m.channel.send(`❌ API errore: \`${msg}\` — URL base: ${BASE_URL}`);
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
  console.log(`BASE_URL=${BASE_URL} | SERVER_ID=${SERVER_ID} | INSECURE=${INSECURE ? '1' : '0'} | API_KEY=${API_KEY ? 'set' : 'none'} | USER=${USERNAME ? 'set' : 'none'}`);
});

client.login(TOKEN);
