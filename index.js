const { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  Events 
} = require("discord.js");
const Docker = require("dockerode");

// === Variabili ambiente ===
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID;  // Application ID dal Dev Portal
const GUILD_ID = process.env.GUILD_ID;      // ID del tuo server Discord
const CONTAINER_NAME = process.env.CRAFTY_CONTAINER || "big-bear-crafty";
const ALLOWED_CHANNEL_ID = "1420794687714754712"; // canale consentito

if (!DISCORD_TOKEN || !APP_ID || !GUILD_ID) {
  throw new Error("❌ Manca una variabile ambiente: DISCORD_TOKEN, DISCORD_APP_ID, GUILD_ID");
}

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

// === Definizione comandi slash ===
const commands = [
  new SlashCommandBuilder()
    .setName("server")
    .setDescription("Gestisci il server Minecraft")
    .addSubcommand(sub =>
      sub.setName("status").setDescription("Mostra lo stato del server")
    )
    .addSubcommand(sub =>
      sub.setName("on").setDescription("Accende il server")
    )
    .addSubcommand(sub =>
      sub.setName("off").setDescription("Spegne il server")
    )
    .addSubcommand(sub =>
      sub.setName("restart").setDescription("Riavvia il server")
    )
    .addSubcommand(sub =>
      sub.setName("debug").setDescription("Debug del bot/server")
    )
].map(c => c.toJSON());

// === Registra i comandi su Discord ===
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
(async () => {
  try {
    console.log("🔄 Registrazione slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(APP_ID, GUILD_ID),
      { body: commands }
    );
    console.log("✅ Slash commands registrati!");
  } catch (err) {
    console.error("❌ Errore registrazione comandi:", err);
  }
})();

// === Funzioni helper Docker ===
async function getContainer() {
  return docker.getContainer(CONTAINER_NAME);
}
async function containerStatus() {
  try {
    const c = await getContainer();
    const data = await c.inspect();
    return data.State.Running ? "acceso" : "spento";
  } catch {
    return "unknown";
  }
}

// === Client Discord ===
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// === Gestione slash ===
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "server") return;

  // ✅ Filtro: solo nel canale specifico
  if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
    return interaction.reply({
      content: `❌ Puoi usare i comandi solo in <#${ALLOWED_CHANNEL_ID}>.`,
      ephemeral: true
    });
  }

  const sub = interaction.options.getSubcommand();

  try {
    if (sub === "status") {
      const st = await containerStatus();
      return interaction.reply(`📊 Stato Server: **${st}**`);
    }

    if (sub === "on") {
      const c = await getContainer();
      await c.start();
      return interaction.reply("🚀 Container Avviato.");
    }

    if (sub === "off") {
      const c = await getContainer();
      await c.stop();
      return interaction.reply("⏹️ Container Fermato.");
    }

    if (sub === "restart") {
      const c = await getContainer();
      await c.restart();
      return interaction.reply("🔄 Container Riavviato Attendi.");
    }

    if (sub === "debug") {
      const st = await containerStatus();
      return interaction.reply(`🐛 Debug:\n- Server: ${CONTAINER_NAME}\n- Stato: ${st}`);
    }
  } catch (err) {
    console.error(err);
    return interaction.reply("❌ Errore: " + err.message);
  }
});

// === Login ===
client.login(DISCORD_TOKEN);
