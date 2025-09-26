const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  Events,
} = require("discord.js");
const Docker = require("dockerode");

// === ENV ===
const DISCORD_TOKEN   = process.env.DISCORD_TOKEN;
const DISCORD_APP_ID  = process.env.DISCORD_APP_ID;   // Application ID dal Dev Portal
const GUILD_ID        = process.env.GUILD_ID;         // ID del tuo server
const CRAFTY_CONTAINER= process.env.CRAFTY_CONTAINER || "big-bear-crafty";
const ALLOWED_CHANNEL_ID = process.env.ALLOWED_CHANNEL_ID || "1420794687714754712";

if (!DISCORD_TOKEN || !DISCORD_APP_ID || !GUILD_ID) {
  throw new Error("Mancano ENV: DISCORD_TOKEN, DISCORD_APP_ID, GUILD_ID");
}

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

// === Definizione /server con SUB-COMANDI ===
const serverCmd = new SlashCommandBuilder()
  .setName("server")
  .setDescription("Gestisci il server Minecraft (container Crafty)")
  .addSubcommand(s => s.setName("status").setDescription("Mostra lo stato"))
  .addSubcommand(s => s.setName("on").setDescription("Accende il container"))
  .addSubcommand(s => s.setName("off").setDescription("Spegne il container"))
  .addSubcommand(s => s.setName("restart").setDescription("Riavvia il container"))
  .addSubcommand(s => s.setName("debug").setDescription("Mostra info di debug"));

const commandsJson = [serverCmd.toJSON()];

// === (Ri)registrazione comandi sulla GUILD + dump di verifica ===
const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);
(async () => {
  try {
    console.log("🔄 Registro slash commands…");
    await rest.put(
      Routes.applicationGuildCommands(DISCORD_APP_ID, GUILD_ID),
      { body: commandsJson }
    );
    console.log("✅ Slash commands registrati sulla guild:", GUILD_ID);

    // dump per capire cosa vede Discord
    const current = await rest.get(
      Routes.applicationGuildCommands(DISCORD_APP_ID, GUILD_ID)
    );
    console.log("📋 Comandi attuali sulla guild:");
    for (const cmd of current) {
      console.log(`- /${cmd.name}`, JSON.stringify(cmd.options ?? [], null, 2));
    }
  } catch (err) {
    console.error("❌ Errore registrazione/verifica comandi:", err);
  }
})();

// === Helper Docker ===
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

// === Client ===
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

// === Handler robusto (sub-commands o schema 'action') ===
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "server") return;

  // Limita al canale
  if (interaction.channelId !== ALLOWED_CHANNEL_ID) {
    return interaction.reply({
      content: `❌ Puoi usare i comandi solo in <#${ALLOWED_CHANNEL_ID}>.`,
      ephemeral: true,
    });
  }

  // compat: sub-command OPPURE opzione "action" (se per caso avevi registrato così)
  const sub = interaction.options.getSubcommand(false); // null se non ci sono sub
  const action = sub || interaction.options.getString("action");

  try {
    if (action === "status") {
      const st = await containerStatus();
      return interaction.reply(`📊 Stato container **${CRAFTY_CONTAINER}**: **${st}**`);
    }
    if (action === "on") {
      const c = await getContainer();
      await c.start();
      return interaction.reply("🚀 Container avviato.");
    }
    if (action === "off") {
      const c = await getContainer();
      await c.stop();
      return interaction.reply("⏹️ Container fermato.");
    }
    if (action === "restart") {
      const c = await getContainer();
      await c.restart();
      return interaction.reply("🔄 Container riavviato.");
    }
    if (action === "debug") {
      const st = await containerStatus();
      return interaction.reply(
        `🐛 Debug\n• Container: **${CRAFTY_CONTAINER}**\n• Stato: **${st}**\n• Canale consentito: <#${ALLOWED_CHANNEL_ID}>`
      );
    }

    // Se arriva qui, vuol dire che il comando registrato non combacia con la lettura
    console.log("⚠️ Interaction non riconosciuta:", {
      name: interaction.commandName,
      options: interaction.options?.data
    });
    return interaction.reply({ content: "Comando non riconosciuto.", ephemeral: true });
  } catch (err) {
    console.error(err);
    return interaction.reply({ content: "❌ Errore: " + err.message, ephemeral: true });
  }
});

client.login(DISCORD_TOKEN);
