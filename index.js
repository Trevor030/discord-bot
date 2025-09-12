// Slash /server per controllare Crafty via Docker
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const Docker = require('dockerode');

const TOKEN = process.env.DISCORD_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID;         // es: 1408...
const GUILD_ID = process.env.GUILD_ID || null;     // es: 8526... (consigliato per sync immediata)
const CRAFTY_NAME = process.env.CRAFTY_CONTAINER_NAME || 'big-bear-crafty';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---------- definizione slash command con Builders ----------
const command = new SlashCommandBuilder()
  .setName('server')
  .setDescription('Controlla il server Crafty')
  .addSubcommand(s => s.setName('status').setDescription('Mostra lo stato'))
  .addSubcommand(s => s.setName('on').setDescription('Accende il server'))
  .addSubcommand(s => s.setName('off').setDescription('Spegne il server'))
  .addSubcommand(s => s.setName('restart').setDescription('Riavvia il server'))
  .addSubcommand(s => s.setName('list').setDescription('Elenca i container visibili'));

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const body = [command.toJSON()];
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body });
    console.log('✅ Slash registrati su GUILD:', GUILD_ID);
  } else {
    await rest.put(Routes.applicationCommands(APP_ID), { body });
    console.log('✅ Slash registrati GLOBALI (appariranno tra qualche minuto)');
  }
}

async function getContainer() {
  try {
    const c = docker.getContainer(CRAFTY_NAME);
    await c.inspect();
    return c;
  } catch { return null; }
}
async function getStatus(c) {
  const info = await c.inspect();
  const st = info.State || {};
  return st.Running ? 'running' : (st.Status || 'stopped');
}

// ---------- lifecycle ----------
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
    const list = await docker.listContainers({ all: true });
    console.log('🧩 Containers visibili:', list.map(x => (x.Names?.[0]||'').replace(/^\//,'')).join(', '));
  } catch (e) {
    console.error('⚠️ Setup error:', e.message || e);
  }
});

// ---------- handler interazioni ----------
client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  console.log('🔔 Interaction:', i.commandName, i.options.getSubcommand(false)); // log utile

  if (i.commandName !== 'server') return;
  const sub = i.options.getSubcommand();

  try {
    if (sub === 'list') {
      await i.deferReply();
      const all = await docker.listContainers({ all: true });
      const rows = all.map(x => `• ${(x.Names?.[0]||'').replace(/^\//,'')} — ${x.State || x.Status || 'unknown'}`);
      await i.editReply(rows.length ? rows.join('\n') : 'Nessun container trovato.');
      return;
    }

    const c = await getContainer();
    if (!c) return i.reply({ content: `❌ Container **${CRAFTY_NAME}** non trovato.`, ephemeral: true });

    if (sub === 'status') {
      const st = await getStatus(c);
      return i.reply(`ℹ️ **${CRAFTY_NAME}**: **${st}**`);
    }
    if (sub === 'on') {
      const st = await getStatus(c);
      if (st === 'running') return i.reply('✅ Server già acceso.');
      await c.start();
      return i.reply('🚀 Server acceso.');
    }
    if (sub === 'off') {
      const st = await getStatus(c);
      if (st !== 'running') return i.reply('✅ Server già spento.');
      await c.stop({ t: 30 });
      return i.reply('⏹️ Server spento.');
    }
    if (sub === 'restart') {
      await c.restart({ t: 30 });
      return i.reply('🔄 Server riavviato.');
    }

    // fallback (non dovrebbe mai capitare)
    return i.reply({ content: 'Comando non riconosciuto (sub).', ephemeral: true });
  } catch (e) {
    const msg = e?.message || String(e);
    console.error('❌ Handler error:', msg);
    if (i.deferred || i.replied) return i.editReply(`Errore: \`${msg}\``);
    return i.reply({ content: `Errore: \`${msg}\``, ephemeral: true });
  }
});

client.login(TOKEN);
