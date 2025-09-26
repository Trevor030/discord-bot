// index.js
const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  Events,
} = require("discord.js");
const Docker = require("dockerode");

// ====== ENV OBBLIGATORIE ======
const DISCORD_TOKEN    = process.env.DISCORD_TOKEN;         // Token bot
const DISCORD_APP_ID   = process.env.DISCORD_APP_ID;        // Application ID
const GUILD_ID         = process.env.GUILD_ID;              // ID del tuo server
const CRAFTY_CONTAINER = process.env.CRAFTY_CONTAINER || "big-bear-crafty";
const ALLOWED_CHANNEL_ID = process.env.ALLOWED_CHANNEL_ID || "1420794687714754712";

if (!DISCORD_TOKEN || !DISCORD_APP_ID || !GUILD_ID) {
  throw new Error("Mancano ENV: DISCORD_TOKEN, DISCORD_APP_ID, GUILD_ID");
}

// ====== DOCKER ======
const docker = new Docker({ socketPath: "/var/run/docker.sock" });
async function getContainer() {
  return docker.getContainer(CRAFTY_CONTAINER);
}
async function containerStatus() {
  try {
    const c = await getContainer();
    const data = await c.inspect();
    return data.State.Running ? "running" : "stopped";
  } catch {
    return "unknown";
  }
}

// ====== DEFINIZIONE SLASH COMMAND ======
const serverCmd = new SlashCommandBuilder()
  .setName("server")
  .setDescription("Gestisci il server Minecraft (container Crafty)")
  .addSubcommand(s => s.setName("status").setDescription("Mostra lo stato"))
  .addSubcommand(s => s.setName("on").setDescription("Accende il container"))
  .addSubcommand(s => s.setName("off").setDescription("Spegne il container"))
  .addSubcommand(s => s.setName("restart").setDescription("Riavvia il container"))
  .addSubcommand(s => s.setName("debug").setDescription("Mostra info di debug"));

const commandsJson = [serverCmd.toJSON()];

// ====== REGISTRAZIONE COMANDI SULLA GUILD ======
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
(async () => {
  try {
    console.log("🔄 Registro slash commands…");
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_APP_ID, GUILD_ID),
      { body: commandsJson }
    );
    console.log("✅ Slash commands registrati sulla guild:", GUILD_ID);

    const current = await rest.get(
      Routes.applicationGuildCommands(DISCORD_APP_ID, GUILD_ID)
    );
    console.log("📋 Comandi attuali:");
    for (const cmd of current) {
      console.log(`- /${cmd.name}`, JSON.stringify(cmd.options ?? [], null, 2));
    }
  } catch (err) {
    console.error("❌ Errore registrazione/verifica comandi:", err);
  }
})();

// ====== CLIENT DISCORD ======
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// ====== HANDLER SLASH (SOLO SUB-COMMANDS) ======
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "server") return;

  // Limita al canale richiesto
  if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
    return interaction.reply({
      content: `❌ Puoi usare i comandi solo in <#${ALLOWED_CHANNEL_ID}>.`,
      ephemeral: true,
    });
  }

  let sub;
  try {
    sub = interaction.options.getSubcommand(); // "status" | "on" | "off" | "restart" | "debug"
  } catch {
    console.log("⚠️ Subcommand non riconosciuto:", interaction.options?.data);
    return interaction.reply({ content: "Comando non riconosciuto.", ephemeral: true });
  }

  try {
    if (sub === "status") {
      const st = await containerStatus();
      return interaction.reply(`📊 Stato container **${CRAFTY_CONTAINER}**: **${st}**`);
    }

    if (sub === "on") {
      const c = await getContainer();
      await c.start();
      return interaction.reply("🚀 Container avviato.");
    }

    if (sub === "off") {
      const c = await getContainer();
      await c.stop();
      return interaction.reply("⛔️ Container fermato.");
    }

    if (sub === "restart") {
      const c = await getContainer();
      await c.restart();
      return interaction.reply("🔄 Container riavviato.");
    }

    if (sub === "debug") {
      const st = await containerStatus();
      return interaction.reply(
        `🐛 Debug\n• Container: **${CRAFTY_CONTAINER}**\n• Stato: **${st}**\n• Canale consentito: <#${ALLOWED_CHANNEL_ID}>`
      );
    }

    return interaction.reply({ content: "Comando non riconosciuto.", ephemeral: true });
  } catch (err) {
    console.error(err);
    return interaction.reply({ content: "❌ Errore: " + err.message, ephemeral: true });
  }
});

// ====== LOGIN ======
client.login(DISCORD_TOKEN);
