// Slash /server con debug
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const Docker = require('dockerode');

const TOKEN = process.env.DISCORD_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID;
const GUILD_ID = process.env.GUILD_ID || null;
const CRAFTY_NAME = process.env.CRAFTY_CONTAINER_NAME || 'big-bear-crafty';

if (!TOKEN) { console.error('Missing DISCORD_TOKEN'); process.exit(1); }
if (!APP_ID) { console.error('Missing DISCORD_APP_ID'); process.exit(1); }

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---- definizione comandi
const command = new SlashCommandBuilder()
  .setName('server')
  .setDescription('Controlla il server Crafty')
  .addSubcommand(s => s.setName('status').setDescription('Mostra lo stato'))
  .addSubcommand(s => s.setName('on').setDescription('Accende il server'))
  .addSubcommand(s => s.setName('off').setDescription('Spegne il server'))
  .addSubcommand(s => s.setName('restart').setDescription('Riavvia il server'))
  .addSubcommand(s => s.setName('list').setDescription('Elenca i container visibili'));

async function register() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const body = [command.toJSON()];
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body });
    console.log('✅ Slash registrati su GUILD:', GUILD_ID);
  } else {
    await rest.put(Routes.applicationCommands(APP_ID), { body });
    console.log('✅ Slash registrati GLOBALI');
  }
}

async function getC() {
  try { const c = docker.getContainer(CRAFTY_NAME); await c.inspect(); return c; }
  catch { return null; }
}
async function getStatus(c) {
  const info = await c.inspect();
  const st = info.State || {};
  return st.Running ? 'running' : (st.Status || 'stopped');
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await register();
  const list = await docker.listContainers({ all: true });
  console.log('🧩 Containers visibili:', list.map(x => (x.Names?.[0]||'').replace(/^\//,'')).join(', ') || '(nessuno)');
});

// ---- DEBUG + handler
client.on('interactionCreate', async (i) => {
  try {
    if (!i.isChatInputCommand()) return;

    // LOG DETTAGLI
    const sub = i.options.getSubcommand(false);
    console.log('🔔 interaction:', {
      guild: i.guildId,
      name: i.commandName,
      sub: sub,
      options: i.options._hoistedOptions?.map(o => ({ name: o.name, type: o.type, value: o.value })) || []
    });

    if (i.commandName !== 'server') return;

    // risposta di debug (sempre)
    await i.deferReply({ ephemeral: false });
    await i.editReply(`(debug) ricevuto: /server ${sub || '(no-sub)'}`);

    // azioni reali
    if (sub === 'list') {
      const all = await docker.listContainers({ all: true });
      const rows = all.map(x => `• ${(x.Names?.[0]||'').replace(/^\//,'')} — ${x.State || x.Status || 'unknown'}`);
      return void i.followUp(rows.length ? rows.join('\n') : 'Nessun container trovato.');
    }

    const c = await getC();
    if (!c) return void i.followUp(`❌ Container **${CRAFTY_NAME}** non trovato.`);

    if (sub === 'status') {
      const st = await getStatus(c);
      return void i.followUp(`ℹ️ **${CRAFTY_NAME}**: **${st}**`);
    }
    if (sub === 'on') {
      const st = await getStatus(c);
      if (st === 'running') return void i.followUp('✅ Server già acceso.');
      await c.start();
      return void i.followUp('🚀 Server acceso.');
    }
    if (sub === 'off') {
      const st = await getStatus(c);
      if (st !== 'running') return void i.followUp('✅ Server già spento.');
      await c.stop({ t: 30 });
      return void i.followUp('⏹️ Server spento.');
    }
    if (sub === 'restart') {
      await c.restart({ t: 30 });
      return void i.followUp('🔄 Server riavviato.');
    }

    return void i.followUp('Comando non riconosciuto (sub).');
  } catch (e) {
    console.error('❌ handler error:', e);
    if (i.deferred || i.replied) return i.editReply(`Errore: \`${e.message || e}\``);
    return i.reply({ content: `Errore: \`${e.message || e}\``, ephemeral: true });
  }
});

client.login(TOKEN);
