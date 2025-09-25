const { Client, GatewayIntentBits } = require("discord.js");
const Docker = require("dockerode");
const axios = require("axios");
const https = require("https");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CONTAINER_NAME = process.env.CRAFTY_CONTAINER || "big-bear-crafty";

// Crafty API
const CRAFTY_URL = (process.env.CRAFTY_URL || "").replace(/\/+$/,"");
const CRAFTY_API_KEY = (process.env.CRAFTY_API_KEY || "").trim();
const CRAFTY_SERVER_ID = process.env.CRAFTY_SERVER_ID;
const CRAFTY_INSECURE = process.env.CRAFTY_INSECURE === "1";

if (!DISCORD_TOKEN) throw new Error("❌ Manca DISCORD_TOKEN");
if (!CRAFTY_URL || !CRAFTY_API_KEY || !CRAFTY_SERVER_ID) {
  throw new Error("❌ Mancano variabili Crafty: CRAFTY_URL, CRAFTY_API_KEY, CRAFTY_SERVER_ID");
}

if (CRAFTY_INSECURE) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const httpsAgent = new https.Agent({ rejectUnauthorized: !CRAFTY_INSECURE });

const api = axios.create({
  baseURL: `${CRAFTY_URL}/panel/api/v3`,
  httpsAgent,
  headers: { "X-Api-Key": CRAFTY_API_KEY }
});

// Docker
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

async function getContainer() {
  return docker.getContainer(CONTAINER_NAME);
}

client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
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
      try {
        const res = await api.get(`/servers/${CRAFTY_SERVER_ID}/stats`);
        const running = res.data?.data?.running;
        return m.reply(`📊 Stato server (Crafty API): **${running ? "running" : "stopped"}**`);
      } catch (err) {
        console.error(err.response?.data || err.message);
        return m.reply("❌ Errore nel recupero status via API.");
      }
    }

    if (cmd === "on") {
      const c = await getContainer();
      await c.start();
      return m.reply("🚀 Container Crafty avviato.");
    }

    if (cmd === "off") {
      const c = await getContainer();
      await c.stop();
      return m.reply("⏹️ Container Crafty fermato.");
    }

    if (cmd === "restart") {
      const c = await getContainer();
      await c.restart();
      return m.reply("🔄 Container Crafty riavviato.");
    }

    return m.reply("Comandi: `!server status | on | off | restart`");
  } catch (e) {
    console.error(e);
    return m.reply("❌ Errore: " + e.message);
  }
});

client.login(DISCORD_TOKEN);
