// Bot Discord + Crafty API (tutte le varianti di endpoint) – comandi testuali !server
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const https = require('https');
const http = require('http');

const TOKEN       = process.env.DISCORD_TOKEN;
const CRAFTY_URL  = (process.env.CRAFTY_URL || '').replace(/\/+$/, '');
const API_KEY     = process.env.CRAFTY_API_KEY || '';
const SERVER_ID   = process.env.CRAFTY_SERVER_ID || '';
const INSECURE    = process.env.CRAFTY_INSECURE === '1'; // se usi https self-signed: metti 1

if (!TOKEN) { console.error('❌ Manca DISCORD_TOKEN'); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// axios “robusto”
const AXIOS = axios.create({
  timeout: 10000,
  maxRedirects: 3,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: !INSECURE })
});

function hdrs(key) {
  return [
    { 'X-Api-Key': key, 'Content-Type': 'application/json' },
    { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' }
  ];
}

async function tryReq(variants) {
  let lastErr;
  for (const fn of variants) {
    try {
      const r = await fn();
      if (r && r.status >= 200 && r.status < 300) return r;
      lastErr = new Error(`HTTP ${r?.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Nessuna risposta valida');
}

/* ================== API WRAPPERS ================== */

async function craftyList() {
  if (!CRAFTY_URL || !API_KEY) throw new Error('Config mancante (CRAFTY_URL, CRAFTY_API_KEY).');
  const H = hdrs(API_KEY);
  // Prova tutte le varianti note
  return (await tryReq([
    () => AXIOS.get(`${CRAFTY_URL}/api/v3/servers`,         { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/api/v2/servers`,         { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/api/servers`,            { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/panel/api/v3/servers`,   { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/panel/api/v2/servers`,   { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/crafty/api/v3/servers`,  { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/crafty/api/v2/servers`,  { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/crafty/api/servers`,     { headers: H[0] }),
  ])).data;
}

async function craftyStatus() {
  if (!CRAFTY_URL || !API_KEY || !SERVER_ID) throw new Error('Config mancante (CRAFTY_URL, CRAFTY_API_KEY, CRAFTY_SERVER_ID).');
  const H = hdrs(API_KEY);
  const res = await tryReq([
    () => AXIOS.get(`${CRAFTY_URL}/api/v3/servers/${SERVER_ID}`,        { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/api/v2/servers/${SERVER_ID}`,        { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/api/servers/${SERVER_ID}`,           { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/panel/api/v3/servers/${SERVER_ID}`,  { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/panel/api/v2/servers/${SERVER_ID}`,  { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/crafty/api/v3/servers/${SERVER_ID}`, { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/crafty/api/v2/servers/${SERVER_ID}`, { headers: H[0] }),
    () => AXIOS.get(`${CRAFTY_URL}/crafty/api/servers/${SERVER_ID}`,    { headers: H[0] }),
  ]);
  const d = res.data || {};
  const st = d.state || d.status || d.power || d.running || d?.server?.state || d?.server?.status;
  if (typeof st === 'boolean') return st ? 'running' : 'stopped';
  return st || 'unknown';
}

async function craftyPower(action) {
  if (!CRAFTY_URL || !API_KEY || !SERVER_ID) throw new Error('Config mancante (CRAFTY_URL, CRAFTY_API_KEY, CRAFTY_SERVER_ID).');
  const H = hdrs(API_KEY);
  return await tryReq([
    // v3 style
    () => AXIOS.post(`${CRAFTY_URL}/api/v3/servers/${SERVER_ID}/power`,        { action }, { headers: H[0] }),
    () => AXIOS.post(`${CRAFTY_URL}/panel/api/v3/servers/${SERVER_ID}/power`,  { action }, { headers: H[0] }),
    () => AXIOS.post(`${CRAFTY_URL}/crafty/api/v3/servers/${SERVER_ID}/power`, { action }, { headers: H[0] }),

    // v2 / generic style
    () => AXIOS.post(`${CRAFTY_URL}/api/v2/servers/${SERVER_ID}/power/${action}`,        {}, { headers: H[0] }),
    () => AXIOS.post(`${CRAFTY_URL}/api/servers/${SERVER_ID}/power/${action}`,           {}, { headers: H[0] }),
    () => AXIOS.post(`${CRAFTY_URL}/panel/api/v2/servers/${SERVER_ID}/power/${action}`,  {}, { headers: H[0] }),
    () => AXIOS.post(`${CRAFTY_URL}/crafty/api/v2/servers/${SERVER_ID}/power/${action}`, {}, { headers: H[0] }),
    () => AXIOS.post(`${CRAFTY_URL}/crafty/api/servers/${SERVER_ID}/power/${action}`,    {}, { headers: H[0] }),
  ]);
}

/* ================== BOT (TESTO) ================== */

client.on('messageCreate', async (m) => {
  if (m.author.bot) return;
  const t = m.content.trim().toLowerCase();

  if (t === '!server debug') {
    try {
      const data = await craftyList();
      return void m.channel.send('✅ API ok. /servers risponde:\n```' + JSON.stringify(data).slice(0, 900) + '```');
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message || String(e));
      return void m.channel.send(`❌ API errore: \`${msg}\` — URL: ${CRAFTY_URL}`);
    }
  }

  if (t === '!server status') {
    try {
      const st = await craftyStatus();
      return void m.channel.send(`ℹ️ Stato server Crafty: **${st}**`);
    } catch (e) {
      const msg = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message || String(e));
      return void m.channel.send(`❌ Errore status: \`${msg}\``);
    }
  }

  if (t === '!server on' || t === '!server off' || t === '!server restart') {
    const map = { on: 'start', off: 'stop', restart: 'restart' };
    const action = map[t.split(' ').pop()];
    try {
      await craftyPower(action);
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
  console.log(`CRAFTY_URL=${CRAFTY_URL || '(manca)'} | SERVER_ID=${SERVER_ID || '(manca)'} | INSECURE=${INSECURE ? '1' : '0'}`);
});

client.login(TOKEN);
