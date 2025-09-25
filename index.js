const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const https = require("https");

// ===== ENV =====
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_APP_ID = process.env.DISCORD_APP_ID;
const GUILD_ID = process.env.GUILD_ID;

const CRAFTY_URL = process.env.CRAFTY_URL;
const CRAFTY_API_KEY = (process.env.CRAFTY_API_KEY || "").trim();
const CRAFTY_SERVER_ID = process.env.CRAFTY_SERVER_ID;
const CRAFTY_INSECURE = process.env.CRAFTY_INSECURE === "1";

if (!DISCORD_TOKEN || !CRAFTY_URL || !CRAFTY_API_KEY || !CRAFTY_SERVER_ID) {
  throw new Error("❌ Mancano variabili ambiente: DISCORD_TOKEN, CRAFTY_URL, CRAFTY_API_KEY, CRAFTY_SERVER_ID");
}

// ===== LOG STARTUP =====
console.log("BASE=" + CRAFTY_URL,
  "| SERVER_ID=" + CRAFTY_SERVER_ID,
  "| API_KEY present:", CRAFTY_API_KEY.length > 10);

// ===== Axios client =====
const httpsAgent = new https.Agent({ rejectUnauthorized: !CRAFTY_INSECURE });
const api = axios.create({
  baseURL: CRAFTY_URL,
  httpsAgent,
  headers: {
    "X-Api-Key": CRAFTY_API_KEY
  }
});

// ===== Discord Bot =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ===== Commands =====
client.on("messageCreate", async (msg) => {
  if (!msg.content.startsWith("!server")) return;
  const args = msg.content.split(" ").slice(1);
  const cmd = args[0];

  try {
    if (cmd === "status") {
      const res = await api.get(`/api/v3/servers/${CRAFTY_SERVER_ID}/stats`);
      msg.reply("Stato server: " + (res.data?.data?.running ? "running" : "stopped"));
    }

    else if (cmd === "on") {
      await api.post(`/api/v3/servers/${CRAFTY_SERVER_ID}/power`, { action: "start" });
      msg.reply("▶️ Avvio server richiesto.");
    }

    else if (cmd === "off") {
      await api.post(`/api/v3/servers/${CRAFTY_SERVER_ID}/power`, { action: "stop" });
      msg.reply("⏹️ Arresto server richiesto.");
    }

    else if (cmd === "restart") {
      await api.post(`/api/v3/servers/${CRAFTY_SERVER_ID}/power`, { action: "restart" });
      msg.reply("🔄 Riavvio server richiesto.");
    }

    else if (cmd === "debug") {
      const who = await api.get(`/api/v3/whoami`).catch(e => e.response?.status);
      const servers = await api.get(`/api/v3/servers`).catch(e => e.response?.status);
      msg.reply("Debug:\nwhoami: " + JSON.stringify(who.data || who) +
                "\nservers: " + JSON.stringify(servers.data || servers));
    }

    else {
      msg.reply("Comandi: !server status | on | off | restart | debug");
    }
  } catch (err) {
    console.error(err.response?.status, err.response?.data || err.message);
    msg.reply("❌ Errore: " + (err.response?.status || err.message));
  }
});

client.login(DISCORD_TOKEN);
