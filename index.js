// Bot Discord per controllare Crafty via Docker (slash commands)
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const Docker = require('dockerode');

const TOKEN = process.env.DISCORD_TOKEN;
const APP_ID = process.env.1408107386522177648;           // <-- metti l'Application ID
const GUILD_ID = process.env.852675693140901888 || null;       // opzionale: sync più veloce su una sola guild
const CRAFTY_NAME = process.env.CRAFTY_CONTAINER_NAME || 'big-bear-crafty';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const client = new Client({
  intents: [GatewayIntentBits.Guilds], // niente MessageContent necessario per slash
});

// Definizione comandi
const commands = [
  {
    name: 'server',
    description: 'Controlla il server Crafty',
    options: [
      { type: 1, name: 'status', description: 'Mostra lo stato' },
      { type: 1, name: 'on',     description: 'Accende il server' },
      { type: 1, name: 'off',    description: 'Spegne il server' },
      { type: 1, name: 'restart',description: 'Riavvia il server' },
      { type: 1, name: 'list',   description: 'Elenca i container visibili' },
    ]
  }
];

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: commands });
    console.log('✅ Slash registrati su GUILD:', GUILD_ID);
  } else {
    await rest.put(Routes.applicationCommands(APP_ID), { body: commands });
    console.log('✅ Slash registrati GLOBALI (possono impiegare qualche minuto)');
  }
}

async function getContainer() {
  try {
    const c = docker.getContainer(CRAFTY_NAME);
    await c.inspect();
    return c;
  } catch {
    return null;
  }
}

async function getStatus(c) {
  try {
    const info = await c.inspect();
    const st = info.State || {};
    return st.Running ? 'running' : (st.Status || 'stopped');
  } catch {
    return 'unknown';
  }
}

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    await registerCommands();
    const list = await docker.listContainers({ all: true });
    console.log('🧩 Containers:', list.map(x => (x.Names?.[0]||'').replace(/^\//,'')).join(', '));
  } catch (e) {
    console.error('⚠️ Setup error:', e.message || e);
  }
});

client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;
  if (i.commandName !== 'server') return;

  await i.deferReply({ ephemeral: false });

  if (i.options.getSubcommand() === 'list') {
    try {
      const all = await docker.listContainers({ all: true });
      const rows = all.map(x => `• ${(x.Names?.[0]||'').replace(/^\//,'')} — ${x.State || x.Status || 'unknown'}`);
      await i.editReply(rows.length ? rows.join('\n') : 'Nessun container trovato.');
    } catch (e) {
      await i.editReply(`❌ Errore lista: \`${e.message || e}\``);
    }
    return;
  }

  const c = await getContainer();
  if (!c) {
    await i.editReply(`❌ Container **${CRAFTY_NAME}** non trovato.`);
    return;
  }

  const sub = i.options.getSubcommand();
  try {
    if (sub === 'status') {
      const st = await getStatus(c);
      await i.editReply(`ℹ️ **${CRAFTY_NAME}**: **${st}**`);
    } else if (sub === 'on') {
      const st = await getStatus(c);
      if (st === 'running') return await i.editReply('✅ Server già acceso.');
      await c.start();
      await i.editReply('🚀 Server acceso.');
    } else if (sub === 'off') {
      const st = await getStatus(c);
      if (st !== 'running') return await i.editReply('✅ Server già spento.');
      await c.stop({ t: 30 });
      await i.editReply('⏹️ Server spento.');
    } else if (sub === 'restart') {
      await c.restart({ t: 30 });
      await i.editReply('🔄 Server riavviato.');
    }
  } catch (e) {
    await i.editReply(`❌ Errore: \`${e.message || e}\``);
  }
});

client.login(TOKEN);
