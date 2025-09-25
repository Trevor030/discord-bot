const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const https = require("https");
const Rcon = require("rcon");

// ===== ENV =====
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CRAFTY_URL = (process.env.CRAFTY_URL || "").replace(/\/+$/,"");
const CRAFTY_API_KEY = (process.env.CRAFTY_API_KEY || "").trim();
const CRAFTY_SERVER_ID = process.env.CRAFTY_SERVER_ID;
const CRAFTY_INSECURE = process.env.CRAFTY_INSECURE === "1";

const RCON_HOST = process.env.RCON_HOST;
const RCON_PORT = parseInt(process.env.RCON_PORT || "25575");
const RCON_PASSWORD = process.env.RCON_PASSWORD;

if (!DISCORD_TOKEN || !CRAFTY_URL || !CRAFTY_API_KEY || !CRAFTY_SERVER_ID) {
  throw new Error("❌ Mancano variabili Crafty/Discord");
}

// ===== HTTPS client =====
if (CRAFTY_INSECURE) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const httpsAgent = new https.Agent({ rejectUnauthorized: !CRAFTY_INSECURE });

const api = axios.create({
  baseURL: CRAFTY_URL + "/panel/api/v3",
  httpsAgent,
  headers: { "X-Api-Key": CRAFTY_API_KEY }
});

// ===== Funzione RCON =====
function rconCommand(cmd) {
  return new Promise((resolve, reject) => {
    const conn = new Rcon(RCON_HOST, RCON_PORT, RCON_PASSWORD);
    conn.on("auth", () => {
      conn.send(cmd);
    }).on("response", (str) => {
      resolve(str); conn.disconnect();
    }).on("error", reject);
    conn.connect();
  });
}

// ===== Discord Bot =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (m) => {
  if (m.author.bot) return;
  if (!m.content.startsWith("!server")) return;
  const [, cmd] = m.content.trim().split(/\s+/);

  try {
    if (cmd === "status") {
      const res = await api.get(`/servers/${CRAFTY_SERVER_ID}/stats`);
      const running = res.data?.data?.running;
      return m.reply("Stato server: " + (running ? "running" : "stopped"));
    }

    if (cmd === "say") {
      const text = m.content.split(" ").slice(2).join(" ") || "Hello from Discord!";
      const r = await rconCommand(`say ${text}`);
      return m.reply("📢 Messaggio inviato in Minecraft: " + text);
    }

    if (cmd === "off") {
      await rconCommand("stop");
      return m.reply("⏹️ Arresto server richiesto (via RCON).");
    }

    if (cmd === "on") {
      return m.reply("⚠️ Avvio non supportato via RCON. Usa Portainer o Crafty.");
    }

    if (cmd === "restart") {
      await rconCommand("stop");
      return m.reply("🔄 Riavvio richiesto (server si spegnerà, poi riavvialo da Portainer).");
    }

    return m.reply("Comandi: !server status | on | off | restart | say <msg>");
  } catch (err) {
    console.error(err);
    return m.reply("❌ Errore: " + (err.response?.status || err.message));
  }
});

client.login(DISCORD_TOKEN);
