// Bot Discord: controlla il server Minecraft dentro Crafty via API (non il container)
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');
const Docker = require('dockerode'); // solo per fallback opzionale

const TOKEN  = process.env.DISCORD_TOKEN;
const CRAFTY_URL = (process.env.CRAFTY_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.CRAFTY_API_KEY || '';
const SERVER_ID = process.env.CRAFTY_SERVER_ID || '';
const CRAFTY_CONTAINER = process.env.CRAFTY_CONTAINER_NAME || 'big-bear-crafty'; // fallback

if (!TOKEN) { console.error('Manca DISCORD_TOKEN'); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ---- Helpers API Crafty ----
function headers() {
  // Alcune installazioni usano 'X-Api-Key', altre 'Authorization: Bearer ...'
  return [
    { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
    { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' }
  ];
}

async function tryRequests(requests) {
  let lastErr;
  for (const req of requests) {
    try {
      const r = await req();
      if (r && (r.status >= 200 && r.status < 300 || r.status === 202)) return r;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('Nessuna risposta valida dalle API di Crafty');
}

async function craftyPower(action) {
  if (!CRAFTY_URL || !API_KEY || !SERVER_ID) throw new Error('Config API Crafty mancante (CRAFTY_URL, CRAFTY_API_KEY, CRAFTY_SERVER_ID).');

  // Prova vari endpoint noti (Crafty v3 e v2)
  return await tryRequests([
    // v3: POST /api/v3/servers/{id}/power { action: "start|stop|restart" }
    () => axios.post(`${CRAFTY_URL}/api/v3/servers/${SERVER_ID}/power`, { action }, { headers: headers()[0] }),
    () => axios.post(`${CRAFTY_URL}/api/v3/servers/${SERVER_ID}/power`, { action }, { headers: headers()[1] }),

    // v2: POST /api/v2/servers/{id}/power/{action}
    () => axios.post(`${CRAFTY_URL}/api/v2/servers/${SERVER_ID}/power/${action}`, {}, { headers: headers()[0] }),
    () => axios.post(`${CRAFTY_URL}/api/v2/servers/${SERVER_ID}/power/${action}`, {}, { headers: headers()[1] }),
  ]);
}

async function craftyStatus() {
  if (!CRAFTY_URL || !API_KEY || !SERVER_ID) throw new Error('Config API Crafty mancante (CRAFTY_URL, CRAFTY_API_KEY, CRAFTY_SERVER_ID).');

  const res = await tryRequests([
    // v3: GET /api/v3/servers/{id}
    () => axios.get(`${CRAFTY_URL}/api/v3/servers/${SERVER_ID}`, { headers: headers()[0] }),
    () => axios.get(`${CRAFTY_URL}/api/v3/servers/${SERVER_ID}`, { headers: headers()[1] }),

    // v2: GET /api/v2/servers/{id}
    () => axios.get(`${CRAFTY_URL}/api/v2/servers/${SERVER_ID}`, { headers: headers()[0] }),
    () => axios.get(`${CRAFTY_URL}/api/v2/servers/${SERVER_ID}`, { headers: headers()[1] }),
  ]);

  // Prova a dedurre lo stato dai campi comuni
  const data = res.data || {};
  const st = data.state || data.status || data.power || data.running;
  if (typeof st === 'boolean') return st ? 'running' : 'stopped';
  if (typeof st === 'string') return st;
  // fallback: alcuni payload annidano info in data.server/state
  const nested = data.server?.state || data.server?.status;
  return nested || 'unknown';
}

// ---- Fallback: controlla il container (se proprio serve)
const docker = new Docker({ socketPath: '/var/run/docker.sock' });
async function containerPower(action) {
  const c = docker.getContainer(CRAFTY_CONTAINER);
  await c.inspect();
  if (action === 'start') return c.start();
  if (action === 'stop')  return c.stop({ t: 30 });
  if (action === 'restart') return c.restart({ t: 30 });
  throw new Error('Azione non valida');
}

// ---- Bot: comandi testuali ----
client.on('messageCreate', async (m) => {
  try {
    if (m.author.bot) return;
    const t = m.content.trim().toLowerCase();
    if (!t.startsWith('!server')) return;

    if (t === '!server status') {
      try {
        const st = await craftyStatus();
        return void m.channel.send(`ℹ️ Stato server Crafty: **${st}**`);
      } catch (e) {
        return void m.channel.send(`⚠️ API Crafty non configurate/rispondono. Dettaglio: \`${e.message}\``);
      }
    }

    if (t === '!server on' || t === '!server off' || t === '!server restart') {
      const map = { on: 'start', off: 'stop', restart: 'restart' };
      const action = map[t.split(' ').pop()];
      try {
        await craftyPower(action);
        return void m.channel.send(action === 'start' ? '🚀 Avvio richiesto.' :
                                   action === 'stop' ?  '⏹️ Arresto richiesto.' :
                                                        '🔄 Riavvio richiesto.');
      } catch (e) {
        // fallback al container se API non vanno
        try {
          await containerPower(action);
          return void m.channel.send(`(fallback container) Azione ${action} inviata al container Crafty.`);
        } catch (e2) {
          return void m.channel.send(`❌ Errore: \`${e.message}\``);
        }
      }
    }

    if (t === '!server help') {
      return void m.channel.send('Comandi: `!server status | on | off | restart`');
    }

  } catch (e) {
    console.error('msg error:', e);
    return m.channel.send(`Errore: \`${e.message || e}\``);
  }
});

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`CRAFTY_URL=${CRAFTY_URL || '(manca)'}, SERVER_ID=${SERVER_ID || '(manca)'}`);
});

client.login(TOKEN);
