const { Client, GatewayIntentBits } = require("discord.js");
const Docker = require("dockerode");

// === Variabili di ambiente ===
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CONTAINER_NAME = process.env.CRAFTY_CONTAINER || "big-bear-crafty";
const ALLOWED_CHANNEL_ID = process.env.ALLOWED_CHANNEL_ID || "123456789012345678"; 
// ↑ cambia questo ID con quello del canale Discord autorizzato

if (!DISCORD_TOKEN) throw new Error("❌ Manca DISCORD_TOKEN");

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

// === Funzioni helper ===
async function getContainer() {
  return docker.getContainer(CONTAINER_NAME);
}

async function containerStatus() {
  try {
    const c = await getContainer();
    const data = await c.inspect();
    return data.State.Running ? "running" : "stopped";
  } catch (err) {
    return "unknown";
  }
}

// === Inizializza bot ===
const client = new Client({
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

  // ✅ Controllo canale autorizzato
  if (m.channel.id !== ALLOWED_CHANNEL_ID) {
    return m.reply("❌ Questo comando si può usare solo nel canale autorizzato.");
  }

  const [, cmd] = m.content.trim().split(/\s+/);

  try {
    if (cmd === "status") {
      const st = await containerStatus();
      return m.reply(`📊 Stato Server: **${st}**`);
    }

    if (cmd === "on") {
      const c = await getContainer();
      await c.start();
      return m.reply("🚀 Server Avviato.");
    }

    if (cmd === "off") {
      const c = await getContainer();
      await c.stop();
      return m.reply("⏹️ Server Fermato.");
    }

    if (cmd === "restart") {
      const c = await getContainer();
      await c.restart();
      return m.reply("🔄 Server Riavviato Attendi.");
    }

    return m.reply("Comandi: `!server status | on | off | restart`");
  } catch (e) {
    console.error(e);
    return m.reply("❌ Errore: " + e.message);
  }
});

// === Avvia il bot ===
client.login(DISCORD_TOKEN);
