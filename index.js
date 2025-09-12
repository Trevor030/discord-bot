// Bot con SLASH (/server ...) + TESTO (!server ...)
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const Docker = require('dockerode');

const TOKEN   = process.env.DISCORD_TOKEN;
const APP_ID  = process.env.DISCORD_APP_ID;
const GUILD_ID = process.env.GUILD_ID || null;
const CRAFTY  = process.env.CRAFTY_CONTAINER_NAME || 'big-bear-crafty';

if (!TOKEN || !APP_ID) { console.error('Manca DISCORD_TOKEN o DISCORD_APP_ID'); process.exit(1); }

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Intents includono MessageContent per i comandi testuali
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// -------- SLASH definition --------
const cmd = new SlashCommandBuilder()
  .setName('server')
  .setDescription('Controlla Crafty')
  .addSubcommand(s => s.setName('status').setDescription('Mostra lo stato'))
  .addSubcommand(s => s.setName('on').setDescription('Accende il server'))
  .addSubcommand(s => s.setName('off').setDescription('Spegne il server'))
  .addSubcommand(s => s.setName('restart').setDescription('Riavvia il server'))
  .addSubcommand(s => s.setName('list').setDescription('Elenca i container'));

const rest = new REST({ version: '10' }).setToken(TOKEN);

async function registerSlash() {
  const body = [cmd.toJSON()];
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body });
    console.log('✅ Slash registrati su GUILD:', GUILD_ID);
  } else {
    await rest.put(Routes.applicationCommands(APP_ID), { body });
    console.log('✅ Slash registrati GLOBALI');
  }
}

// -------- helpers Docker --------
async function getCrafty() {
  try { const c = docker.getContainer(CRAFTY); await c.inspect(); return c; }
  catch { return null; }
}
async function statusOf(c) {
  const i = await c.inspect(); const s = i.State || {};
  return s.Running ? 'running' : (s.Status || 'stopped');
}

// -------- ready --------
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    const list = await docker.listContainers({ all: true });
    console.log('🧩 Containers:', list.map(x => (x.Names?.[0]||'').replace(/^\//,'')).join(', ') || '(nessuno)');
    await registerSlash();
  } catch (e) {
    console.error('⚠️ Setup error:', e.message || e);
  }
});

// -------- SLASH handler --------
client.on('interactionCreate', async (i) => {
  try {
    if (!i.isChatInputCommand()) return;
    if (i.commandName !== 'server') return;

    const sub = i.options.getSubcommand(false);

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
    console.error('❌ slash error:', e);
    if (i.deferred || i.replied) return i.editReply(`Errore: \`${e.message || e}\``);
    return i.reply({ content: `Errore: \`${e.message || e}\``, ephemeral: true });
  }
});

// -------- TESTO handler --------
client.on('messageCreate', async (m) => {
  try {
    if (m.author.bot) return;
    const t = m.content.trim().toLowerCase();

    if (!t.startsWith('!server')) return;

    if (t === '!server list') {
      const all = await docker.listContainers({ all: true });
      const rows = all.map(x => `• ${(x.Names?.[0]||'').replace(/^\//,'')} — ${x.State || x.Status || 'unknown'}`);
      return m.channel.send(rows.length ? rows.join('\n') : 'Nessun container trovato.');
    }

    const c = await getCrafty();
    if (!c) return m.channel.send(`❌ Container **${CRAFTY}** non trovato.`);

    if (t === '!server status') {
      const st = await statusOf(c);
      return m.channel.send(`ℹ️ **${CRAFTY}**: **${st}**`);
    }
    if (t === '!server on') {
      const st = await statusOf(c);
      if (st === 'running') return m.channel.send('✅ Server già acceso.');
      await c.start(); return m.channel.send('🚀 Server acceso.');
    }
    if (t === '!server off') {
      const st = await statusOf(c);
      if (st !== 'running') return m.channel.send('✅ Server già spento.');
      await c.stop({ t: 30 }); return m.channel.send('⏹️ Server spento.');
    }
    if (t === '!server restart') {
      await c.restart({ t: 30 }); return m.channel.send('🔄 Server riavviato.');
    }

    return m.channel.send('Comando non riconosciuto.');
  } catch (e) {
    console.error('❌ text error:', e);
    return m.channel.send(`Errore: \`${e.message || e}\``);
  }
});

client.login(TOKEN);
