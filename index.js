// index.js
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

// Variabili ambiente
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CRAFTY_URL = process.env.CRAFTY_URL; // es: https://192.168.1.82:8443
const CRAFTY_API_KEY = process.env.CRAFTY_API_KEY;
const CRAFTY_SERVER_ID = process.env.CRAFTY_SERVER_ID; // es: b477362e-e4c8-4982-92ad-14e1883e427a
const CRAFTY_INSECURE = process.env.CRAFTY_INSECURE === "1";

// Controllo variabili
if (!DISCORD_TOKEN || !CRAFTY_URL || !CRAFTY_API_KEY || !CRAFTY_SERVER_ID) {
  throw new Error("❌ Mancano variabili ambiente: DISCORD_TOKEN, CRAFTY_URL, CRAFTY_API_KEY, CRAFTY_SERVER_ID");
}

// Axios preconfigurato
const axiosInstance = axios.create({
  baseURL: `${CRAFTY_URL}/panel/api/v3`,
  headers: { "X-Api-Key": CRAFTY_API_KEY },
  httpsAgent: new (require("https").Agent)({ rejectUnauthorized: !CRAFTY_INSECURE })
});

// Funzioni API Crafty
async function getStatus() {
  const res = await axiosInstance.get(`/servers/${CRAFTY_SERVER_ID}/stats`);
  return res.data;
}

async function powerAction(action) {
  const res = await axiosInstance.post(`/servers/${CRAFTY_SERVER_ID}/power`, { action });
  return res.data;
}

// Bot Discord
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

client.once('clientReady', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// Comandi
client.on('messageCreate', async (msg) => {
  if (!msg.content.startsWith("!server")) return;

  const args = msg.content.split(" ").slice(1);
  const cmd = args[0];

  try {
    if (cmd === "status") {
      const st = await getStatus();
      msg.reply("📊 Stato server: " + (st.data.running ? "🟢 Avviato" : "🔴 Spento"));
    } 
    else if (["on","off","restart"].includes(cmd)) {
      await powerAction(cmd);
      msg.reply(`🔧 Azione inviata: ${cmd}`);
    } 
    else if (cmd === "rawstatus") {
      const st = await getStatus();
      msg.reply("📄 Raw dallo status:\n```json\n" + JSON.stringify(st, null, 2).slice(0,1800) + "```");
    } 
    else {
      msg.reply("❓ Comando non riconosciuto. Usa: !server status | on | off | restart | rawstatus");
    }
  } catch (err) {
    msg.reply("❌ Errore API: " + err.message);
  }
});

client.login(DISCORD_TOKEN);
