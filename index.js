// index.js
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");

const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const APP_ID = process.env.DISCORD_APP_ID;

const CRAFTY_URL = process.env.CRAFTY_URL;       // es: https://192.168.1.82:8443
const CRAFTY_API_KEY = process.env.CRAFTY_API_KEY;
const CRAFTY_SERVER_ID = process.env.CRAFTY_SERVER_ID;
const CRAFTY_INSECURE = process.env.CRAFTY_INSECURE === "1";

if (CRAFTY_INSECURE) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });

async function crafty(path, method = "GET", data = {}) {
  try {
    const res = await axios({
      url: `${CRAFTY_URL}/api/v2${path}`,
      method,
      headers: { "X-Api-Key": CRAFTY_API_KEY },
      data
    });
    return res.data;
  } catch (err) {
    console.error(`Errore API ${method} ${path}:`, err.response?.status, err.response?.data || err.message);
    return { error: err.response?.status || err.message };
  }
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`BASE=${CRAFTY_URL} | SERVER_ID=${CRAFTY_SERVER_ID}`);
});

// ------- comandi -------
client.on("messageCreate", async (msg) => {
  if (!msg.content.startsWith("!server")) return;

  const args = msg.content.split(" ").slice(1);
  const cmd = args[0];

  if (cmd === "status") {
    const res = await crafty(`/servers/${CRAFTY_SERVER_ID}/stats`);
    if (res?.status === "ok") {
      const running = res.data.running ? "running ✅" : "stopped ❌";
      msg.reply(`Stato server: ${running}`);
    } else {
      msg.reply("❌ Errore nel recupero dello stato");
    }
  }

  if (cmd === "on") {
    const res = await crafty(`/servers/${CRAFTY_SERVER_ID}/power/start`, "POST");
    if (!res.error) msg.reply("▶️ Avvio server richiesto");
    else msg.reply(`❌ Errore power start: ${res.error}`);
  }

  if (cmd === "off") {
    const res = await crafty(`/servers/${CRAFTY_SERVER_ID}/power/stop`, "POST");
    if (!res.error) msg.reply("⏹️ Arresto server richiesto");
    else msg.reply(`❌ Errore power stop: ${res.error}`);
  }

  if (cmd === "restart") {
    const res = await crafty(`/servers/${CRAFTY_SERVER_ID}/power/restart`, "POST");
    if (!res.error) msg.reply("🔄 Riavvio server richiesto");
    else msg.reply(`❌ Errore power restart: ${res.error}`);
  }

  if (cmd === "rawstatus") {
    const res = await crafty(`/servers/${CRAFTY_SERVER_ID}/stats`);
    msg.reply("Raw dallo stato:\n```json\n" + JSON.stringify(res, null, 2).slice(0, 1800) + "```");
  }

  if (cmd === "debug") {
    const whoami = await crafty("/whoami");
    const servers = await crafty("/servers");
    msg.reply(
      `API ok.\nwhoami:\n\`\`\`json\n${JSON.stringify(whoami, null, 2).slice(0, 500)}\n\`\`\`\nservers:\n\`\`\`json\n${JSON.stringify(servers, null, 2).slice(0, 500)}\n\`\`\``
    );
  }

  if (cmd === "permscheck") {
    let results = [];
    for (const action of ["start", "stop", "restart"]) {
      const r = await crafty(`/servers/${CRAFTY_SERVER_ID}/power/${action}`, "POST");
      results.push(`POWER ${action}: ${r.error ? "HTTP " + r.error : "OK"}`);
    }
    const consoleTest = await crafty(`/servers/${CRAFTY_SERVER_ID}/command`, "POST", { command: "say TestPerms" });
    results.push(`CONSOLE say: ${consoleTest.error ? "HTTP " + consoleTest.error : "OK"}`);
    msg.reply("Permscheck:\n" + results.join("\n"));
  }

  if (cmd === "token") {
    msg.reply(
      `🔑 Token attuale (parziale): \`${CRAFTY_API_KEY?.slice(0, 8)}...${CRAFTY_API_KEY?.slice(-8)}\``
    );
  }
});

client.login(TOKEN);
