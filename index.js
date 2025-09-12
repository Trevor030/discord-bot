// Reset slash + comandi minimi di test
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const Docker = require('dockerode');

const TOKEN   = process.env.DISCORD_TOKEN;
const APP_ID  = process.env.DISCORD_APP_ID;
const GUILD_ID = process.env.GUILD_ID || null;  // 852675693140901888
const CRAFTY  = process.env.CRAFTY_CONTAINER_NAME || 'big-bear-crafty';

if (!TOKEN || !APP_ID) { console.error('Manca DISCORD_TOKEN o DISCORD_APP_ID'); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest   = new REST({ version: '10' }).setToken(TOKEN);
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Comandi NUOVI (rinominato "mcserver" per forzare aggiornamento)
const pingCmd = new SlashCommandBuilder().setName('ping').setDescription('Risponde pong');
const mcCmd = new SlashCommandBuilder()
  .setName('mcserver')
  .setDescription('Controlla Crafty')
  .addSubcommand(s => s.setName('status').setDescription('Mostra lo stato'))
  .addSubcommand(s => s.setName('on').setDescription('Accende il server'))
  .addSubcommand(s => s.setName('off').setDescription('Spegne il server'))
  .addSubcommand(s => s.setName('restart').setDescription('Riavvia il server'))
  .addSubcommand(s => s.setName('list').setDescription('Elenca i container visibili'));

async function syncCommands() {
  if (!GUILD_ID) {
    console.log('⚠️ GUILD_ID mancante: registro comandi GLOBALI (possono comparire dopo alcuni minuti)…');
    await rest.put(Routes.applicationCommands(APP_ID), { body: [pingCmd.toJSON(), mcCmd.toJSON()] });
    return;
  }
  // 1) Elimina TUTTI i comandi di questa guild (hard reset)
  const existing = await rest.get(Routes.applicationGuildCommands(APP_ID, GUILD_ID));
  console.log('🔧 Comandi esistenti prima del reset:', existing.map(c => c.name).join(', ') || '(nessuno)');
  for (const cmd of existing) {
    await rest.delete(Routes.applicationGuildCommand(APP_ID, GUILD_ID, cmd.id));
  }
  // 2) Registra i nuovi
  await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), {
    body: [pingCmd.toJSON(), mcCmd.toJSON()]
  });
  console.log('✅ Comandi registrati sulla GUILD:', GUILD_ID);
}

async function getCrafty() {
  try { const c = docker.getContainer(CRAFTY); await c.inspect(); return c; }
  catch { return null; }
}
async function statusOf(c) {
  const i = await c.inspect(); const s = i.State || {};
  return s.Running ? 'running' : (s.Status || 'stopped');
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    await syncCommands();
  } catch (e) {
    console.error('❌ Sync error:', e?.message || e);
  }
});

client.on('interactionCreate', async (i) => {
  try {
    if (!i.isChatInputCommand()) return;
    console.log('🔔 interaction:', { guild: i.guildId, name: i.commandName, sub: i.options.getSubcommand(false) });

    if (i.commandName === 'ping') {
      return i.reply('pong');
    }

    if (i.commandName !== 'mcserver') return;

    const sub = i.options.getSubcommand();
    if (sub === 'list') {
      await i.deferReply();
      const all = await docker.listContainers({ all: true });
      const rows = all.map(x => `• ${(x.Names?.[0]||'').replace(/^\//,'')} — ${x.State || x.Status || 'unknown'}`);
      return i.editReply(rows.length ? rows.join('\n') : 'Nessun container trovato.');
    }

    const c = await getCrafty();
    if (!c) return i.reply({ content: `❌ Container **${CRAFTY}** non trovato.`, ephemeral: true });

    if (sub === 'status') {
      const st = await statusOf(c);
      return i.reply(`ℹ️ **${CRAFTY}**: **${st}**`);
    }
    if (sub === 'on') {
      const st = await statusOf(c);
      if (st === 'running') return i.reply('✅ Server già acceso.');
      await i.deferReply(); await c.start(); return i.editReply('🚀 Server acceso.');
    }
    if (sub === 'off') {
      const st = await statusOf(c);
      if (st !== 'running') return i.reply('✅ Server già spento.');
      await i.deferReply(); await c.stop({ t: 30 }); return i.editReply('⏹️ Server spento.');
    }
    if (sub === 'restart') {
      await i.deferReply(); await c.restart({ t: 30 }); return i.editReply('🔄 Server riavviato.');
    }

    return i.reply({ content: 'Comando non riconosciuto (sub).', ephemeral: true });
  } catch (e) {
    console.error('❌ Handler error:', e);
    if (i.deferred || i.replied) return i.editReply(`Errore: \`${e.message || e}\``);
    return i.reply({ content: `Errore: \`${e.message || e}\``, ephemeral: true });
  }
});

client.login(TOKEN);
