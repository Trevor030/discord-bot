// Discord bot to control a Docker container (Crafty)
const { Client, GatewayIntentBits } = require('discord.js');
const Docker = require('dockerode');

const CRAFTY_NAME = process.env.CRAFTY_CONTAINER_NAME || 'big-bear-crafty';
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // NECESSARIO per !comandi
  ],
});

async function getContainer(name) {
  try {
    const c = docker.getContainer(name);
    await c.inspect(); // se non esiste, va in errore
    return c;
  } catch (e) {
    return null;
  }
}

async function getStatus(c) {
  try {
    const info = await c.inspect();
    const st = info.State || {};
    return st.Running ? 'running' : (st.Status || 'stopped');
  } catch (e) {
    return 'unknown';
  }
}

client.once('clientReady', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`CRAFTY_CONTAINER_NAME=${CRAFTY_NAME}`);

  // Check access to docker.sock e lista container
  try {
    const list = await docker.listContainers({ all: true });
    const names = list.map(x => (x.Names?.[0] || '').replace(/^\//, ''));
    console.log(`🧩 Containers visti: ${names.join(', ') || '(nessuno)'}`);

    const c = await getContainer(CRAFTY_NAME);
    if (c) {
      const st = await getStatus(c);
      console.log(`🔎 ${CRAFTY_NAME} trovato. Stato: ${st}`);
    } else {
      console.log(`❌ Container ${CRAFTY_NAME} NON trovato`);
    }
  } catch (e) {
    console.error('❌ Errore accesso Docker:', e.message || e);
  }
});

// (compat per v14: eviti il warning cambiando 'ready' in 'clientReady')
client.once('ready', () => { /* noop */ });

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim().toLowerCase();
  if (!content.startsWith('!server')) return;

  // !server list
  if (content === '!server list') {
    try {
      const all = await docker.listContainers({ all: true });
      const rows = all.map(x => {
        const name = (x.Names?.[0] || '').replace(/^\//, '');
        const st = x.State || x.Status || 'unknown';
        return `• ${name} — ${st}`;
      });
      await message.channel.send('📦 Containers:\n' + (rows.join('\n') || '(nessuno)'));
    } catch (e) {
      await message.channel.send(`❌ Errore lista: \`${e.message || e}\``);
    }
    return;
  }

  const c = await getContainer(CRAFTY_NAME);
  if (!c) {
    await message.channel.send(`❌ Container **${CRAFTY_NAME}** non trovato.`);
    return;
  }

  if (content === '!server status') {
    const st = await getStatus(c);
    await message.channel.send(`ℹ️ **${CRAFTY_NAME}**: **${st}**`);
    return;
  }

  if (content === '!server on') {
    const st = await getStatus(c);
    if (st === 'running') {
      await message.channel.send('✅ Server già acceso.');
      return;
    }
    try {
      await c.start();
      await message.channel.send('🚀 Server acceso.');
    } catch (e) {
      await message.channel.send(`❌ Errore avvio: \`${e.message || e}\``);
    }
    return;
  }

  if (content === '!server off') {
    const st = await getStatus(c);
    if (st !== 'running') {
      await message.channel.send('✅ Server già spento.');
      return;
    }
    try {
      await c.stop({ t: 30 });
      await message.channel.send('⏹️ Server spento.');
    } catch (e) {
      await message.channel.send(`❌ Errore stop: \`${e.message || e}\``);
    }
    return;
  }

  if (content === '!server restart') {
    try {
      await c.restart({ t: 30 });
      await message.channel.send('🔄 Server riavviato.');
    } catch (e) {
      await message.channel.send(`❌ Errore restart: \`${e.message || e}\``);
    }
    return;
  }
});

client.login(process.env.DISCORD_TOKEN);
