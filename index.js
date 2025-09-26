const { Client, GatewayIntentBits } = require("discord.js");
const Docker = require("dockerode");

// ==== ENV ====
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;                    // obbligatorio
const CRAFTY_CONTAINER = process.env.CRAFTY_CONTAINER || "big-bear-crafty";
const ALLOWED_CHANNEL_ID = process.env.ALLOWED_CHANNEL_ID || "1420794687714754712";
const PREFIX = "!"; // prefisso unico

if (!DISCORD_TOKEN) {
  throw new Error("❌ Manca DISCORD_TOKEN (impostalo nello Stack di Portainer).");
}

// ==== Docker client ====
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

async function getServer() {
  return docker.getContainer(CRAFTY_CONTAINER);
}

async function getServerStatus() {
  try {
    const s = await getServer();
    const data = await s.inspect();
    return data.State.Running ? "Acceso" : "Spento";
  } catch {
    return "unknown";
  }
}

// ==== Discord client ====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // ⚠️ abilita “Message Content Intent” nel Dev Portal
  ],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`SERVER=${CRAFTY_CONTAINER} | CANALE=${ALLOWED_CHANNEL_ID}`);
});

client.on("messageCreate", async (m) => {
  try {
    if (m.author.bot) return;
    if (!m.content.startsWith(PREFIX)) return;

    // canale autorizzato
    if (m.channel.id !== ALLOWED_CHANNEL_ID) {
      return m.reply(`❌ Usa i comandi solo in <#${ALLOWED_CHANNEL_ID}>.`);
    }

    const [cmd, sub] = m.content.trim().slice(PREFIX.length).split(/\s+/, 2);

    if (cmd !== "server") return;

    if (!sub || sub === "help") {
      return m.reply("Comandi: `!server status | on | off | restart | debug`");
    }

    if (sub === "status") {
      const st = await getServerStatus();
      return m.reply(`📊 Stato Server: **${st}**`);
    }

    if (sub === "on") {
      const s = await getServer();
      await s.start();
      return m.reply("🚀 Server Avviato.");
    }

    if (sub === "off") {
      const s = await getServer();
      await s.stop();
      return m.reply("⛔️ Server Fermato.");
    }

    if (sub === "restart") {
      const s = await getServer();
      await s.restart();
      return m.reply("🔄 Server Riavviato Attendi.");
    }

    if (sub === "debug") {
      const st = await getServerStatus();
      return m.reply(
        `🐛 Debug\n• Server: **${CRAFTY_CONTAINER}**\n• Stato: **${st}**\n• Canale: <#${ALLOWED_CHANNEL_ID}>`
      );
    }

    return m.reply("Comandi: `!server status | on | off | restart | debug`");
  } catch (err) {
    console.error(err);
    return m.reply("❌ Errore: " + (err.message || "operazione non riuscita"));
  }
});

client.login(DISCORD_TOKEN);
