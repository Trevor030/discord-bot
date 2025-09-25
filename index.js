const { Client, GatewayIntentBits } = require("discord.js");
const Docker = require("dockerode");

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CONTAINER_NAME = process.env.CRAFTY_CONTAINER || "big-bear-crafty";

if (!DISCORD_TOKEN) throw new Error("❌ Manca DISCORD_TOKEN");

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

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

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (m) => {
  if (m.author.bot) return;
  if (!m.content.startsWith("!server")) return;
  const [, cmd] = m.content.trim().split(/\s+/);

  try {
    if (cmd === "status") {
      const st = await containerStatus();
      return m.reply(`📊 Stato Server ${CONTAINER_NAME}: **${st}**`);
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

client.login(DISCORD_TOKEN);
