const { Client, GatewayIntentBits } = require("discord.js");
const Docker = require("dockerode");

// ==== ENV ====
const DISCORD_TOKEN = process.env.DISCORD_TOKEN; // obbligatorio
const CRAFTY_CONTAINER = process.env.CRAFTY_CONTAINER || "big-bear-crafty";
const ALLOWED_CHANNEL_ID = process.env.ALLOWED_CHANNEL_ID || "1420794687714754712";
const PREFIX = "!";

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
    return data.State.Running ? "running" : "stopped";
  } catch {
    return "unknown";
  }
}

// ==== Helpers ====
const DAY_MS = 24 * 60 * 60 * 1000;

async function safeDelete(msg) {
  try { await msg.delete(); } catch (_) {}
}

// Pianifica la cancellazione di un messaggio dopo ms (default: 24h)
function scheduleDelete(msg, ms = DAY_MS) {
  setTimeout(() => safeDelete(msg), ms);
}

// ==== Discord client ====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // abilita il Message Content Intent nel Dev Portal
  ],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`SERVER=${CRAFTY_CONTAINER} | CANALE=${ALLOWED_CHANNEL_ID}`);

  // 🧹 Job di pulizia: ogni ora rimuove TUTTI i messaggi > 24h nel canale
  setInterval(async () => {
    try {
      const channel = await client.channels.fetch(ALLOWED_CHANNEL_ID);
      if (!channel || !channel.isTextBased()) return;

      // prendi blocchi da 100 messaggi e pulisci quelli oltre 24h
      let lastId;
      let done = false;
      while (!done) {
        const batch = await channel.messages.fetch({ limit: 100, before: lastId });
        if (batch.size === 0) break;

        const now = Date.now();
        const toDeleteIndividually = [];
        const recentForBulk = [];

        for (const [, msg] of batch) {
          const age = now - msg.createdTimestamp;
          if (age >= DAY_MS) {
            // se entro 14 giorni, possiamo usare bulkDelete; altrimenti delete individuale
            const fourteenDays = 14 * 24 * 60 * 60 * 1000;
            if (age < fourteenDays) {
              recentForBulk.push(msg);
            } else {
              toDeleteIndividually.push(msg);
            }
          }
        }

        // bulkDelete accetta solo <=14 giorni
        if (recentForBulk.length) {
          try {
            await channel.bulkDelete(recentForBulk);
          } catch (_) {
            // fallback: cancella singolarmente se bulk fallisce
            for (const m of recentForBulk) await safeDelete(m);
          }
        }
        // >14 giorni: singolarmente
        for (const m of toDeleteIndividually) await safeDelete(m);

        // prepara pagina successiva
        lastId = batch.lastKey();
        if (!lastId) done = true;
      }
    } catch (e) {
      console.error("Cleaner error:", e.message);
    }
  }, 60 * 60 * 1000); // ogni ora
});

client.on("messageCreate", async (m) => {
  try {
    if (m.author.bot) return;

    // Solo canale dedicato
    if (m.channel.id !== ALLOWED_CHANNEL_ID) return;

    // Se NON è un comando !server, elimina subito
    if (!m.content.startsWith(PREFIX + "server")) {
      await safeDelete(m);
      return;
    }

    // --- Gestione comandi !server ---
    const [cmd, sub] = m.content.trim().slice(PREFIX.length).split(/\s+/, 2);
    if (cmd !== "server") return;

    // helper per rispondere e programmare la cancellazione della risposta tra 24h
    async function replyAndSchedule(content) {
      const reply = await m.reply(content);
      scheduleDelete(reply, DAY_MS);
    }

    if (!sub || sub === "help") {
      await replyAndSchedule("Comandi: `!server status | on | off | restart | debug`");
      await safeDelete(m); // cancella anche il messaggio dell'utente
      return;
    }

    if (sub === "status") {
      const st = await getServerStatus();
      await replyAndSchedule(`📊 Stato server **${CRAFTY_CONTAINER}**: **${st}**`);
      await safeDelete(m);
      return;
    }

    if (sub === "on") {
      const s = await getServer();
      await s.start();

      const msg = await m.reply("🚀 Server in accensione...");
      scheduleDelete(msg, DAY_MS);

      setTimeout(async () => {
        const step = await m.reply("⏳ Ci siamo quasi...");
        scheduleDelete(step, DAY_MS);
      }, 30_000);

      setTimeout(async () => {
        const done = await m.reply("✅ Server acceso!");
        scheduleDelete(done, DAY_MS);
      }, 60_000);

      await safeDelete(m);
      return;
    }

    if (sub === "off") {
      const s = await getServer();
      await s.stop();
      await replyAndSchedule("⛔️ Server fermato.");
      await safeDelete(m);
      return;
    }

    if (sub === "restart") {
      const s = await getServer();
      await s.restart();
      await replyAndSchedule("🔄 Server riavviato.");
      await safeDelete(m);
      return;
    }

    if (sub === "debug") {
      const st = await getServerStatus();
      await replyAndSchedule(
        `🐛 Debug\n• Server: **${CRAFTY_CONTAINER}**\n• Stato: **${st}**\n• Canale: <#${ALLOWED_CHANNEL_ID}>`
      );
      await safeDelete(m);
      return;
    }

    // --- Comando non riconosciuto ---
    await replyAndSchedule("❌ Comando non riconosciuto.\nUsa: `!server status | on | off | restart | debug`");
    await safeDelete(m);
  } catch (err) {
    console.error(err);
    try {
      const resp = await m.reply("❌ Errore: " + (err.message || "operazione non riuscita"));
      scheduleDelete(resp, DAY_MS);
      await safeDelete(m);
    } catch {}
  }
});

client.login(DISCORD_TOKEN);
