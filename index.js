oconst { Client, GatewayIntentBits } = require("discord.js");
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

async function getServer() { return docker.getContainer(CRAFTY_CONTAINER); }
async function getServerStatus() {
  try {
    const s = await getServer();
    const data = await s.inspect();
    return data.State.Running ? "Acceso" : "Spento";
  } catch { return "unknown"; }
}

// ==== Helpers ====
const DAY_MS = 24 * 60 * 60 * 1000;
async function safeDelete(msg) { try { await msg.delete(); } catch {} }
function scheduleDelete(msg, ms = DAY_MS) { setTimeout(() => safeDelete(msg), ms); }

// ==== Discord client ====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // abilita Message Content Intent nel Dev Portal
  ],
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`SERVER=${CRAFTY_CONTAINER} | CANALE=${ALLOWED_CHANNEL_ID}`);

  // 🧹 Cleaner: ogni ora elimina TUTTO > 24h nel canale (bot + utenti)
  setInterval(async () => {
    try {
      const channel = await client.channels.fetch(ALLOWED_CHANNEL_ID);
      if (!channel || !channel.isTextBased()) return;

      let lastId;
      while (true) {
        const batch = await channel.messages.fetch({ limit: 100, before: lastId });
        if (batch.size === 0) break;

        const now = Date.now();
        const recentForBulk = [];
        const tooOld = [];

        for (const [, msg] of batch) {
          const age = now - msg.createdTimestamp;
          if (age >= DAY_MS) {
            // bulkDelete consente solo <=14 giorni
            const maxBulk = 14 * 24 * 60 * 60 * 1000;
            if (age < maxBulk) recentForBulk.push(msg);
            else tooOld.push(msg);
          }
        }

        if (recentForBulk.length) {
          try { await channel.bulkDelete(recentForBulk); }
          catch { for (const m of recentForBulk) await safeDelete(m); }
        }
        for (const m of tooOld) await safeDelete(m);

        lastId = batch.lastKey();
        if (!lastId) break;
      }
    } catch (e) {
      console.error("Cleaner error:", e.message);
    }
  }, 60 * 60 * 1000);
});

client.on("messageCreate", async (m) => {
  try {
    if (m.author.bot) return;
    if (m.channel.id !== ALLOWED_CHANNEL_ID) return; // ignora fuori canale

    // ❌ Non contiene !server → elimina SUBITO
    if (!m.content.startsWith(PREFIX + "server")) {
      await safeDelete(m);
      return;
    }

    // --- Gestione comandi !server ---
    const [cmd, sub] = m.content.trim().slice(PREFIX.length).split(/\s+/, 2);
    if (cmd !== "server") return;

    // Helper: rispondi e programma cancellazione della risposta tra 24h
    async function replyAndSchedule(content) {
      const reply = await m.reply(content);
      scheduleDelete(reply, DAY_MS);
    }

    // ✅ Comandi validi NON vengono eliminati subito (si elimineranno dopo 24h)
    if (sub === "status") {
      const st = await getServerStatus();
      await replyAndSchedule(`📊 Stato Server: **${st}**`);
      scheduleDelete(m, DAY_MS); // elimina il messaggio UTENTE tra 24h (non subito)
      return;
    }

    if (sub === "on") {
      const s = await getServer();
      await s.start();

      const msg = await m.reply("🚀 Server in Accensione...");
      scheduleDelete(msg, DAY_MS);

      setTimeout(async () => {
        const step = await m.reply("⏳ Ci siamo quasi...");
        scheduleDelete(step, DAY_MS);
      }, 30_000);

      setTimeout(async () => {
        const done = await m.reply("✅ Server Acceso!");
        scheduleDelete(done, DAY_MS);
      }, 60_000);

      scheduleDelete(m, DAY_MS); // non eliminare subito: tra 24h
      return;
    }

    if (sub === "off") {
      const s = await getServer();
      await s.stop();
      await replyAndSchedule("⛔️ Server Fermato.");
      scheduleDelete(m, DAY_MS);
      return;
    }

    if (sub === "restart") {
      const s = await getServer();
      await s.restart();
      await replyAndSchedule("🔄 Server Riavviato Attendi.");
      scheduleDelete(m, DAY_MS);
      return;
    }

    if (sub === "debug") {
      const st = await getServerStatus();
      await replyAndSchedule(
        `🐛 Debug\n• Server: **${CRAFTY_CONTAINER}**\n• Stato: **${st}**\n• Canale: <#${ALLOWED_CHANNEL_ID}>`
      );
      scheduleDelete(m, DAY_MS);
      return;
    }

    // ❌ Comando !server errato → rispondi + elimina SUBITO il messaggio utente
    await replyAndSchedule("❌ Comando non riconosciuto.\nUsa: `!server status | on | off | restart | debug`");
    await safeDelete(m);
  } catch (err) {
    console.error(err);
    try {
      const resp = await m.reply("❌ Errore: " + (err.message || "operazione non riuscita"));
      scheduleDelete(resp, DAY_MS);
      // Non eliminare subito il messaggio utente se era valido; qui non lo sappiamo, quindi non lo tocchiamo
    } catch {}
  }
});

client.login(DISCORD_TOKEN);
