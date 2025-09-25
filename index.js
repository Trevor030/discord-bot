// index.js — Crafty via API KEY (robusto: v3+v2, X-Api-Key+Bearer+?key=)
const { Client, GatewayIntentBits } = require("discord.js");
const axios = require("axios");
const https = require("https");

const DISCORD_TOKEN    = process.env.DISCORD_TOKEN;
const CRAFTY_URL       = (process.env.CRAFTY_URL || "").replace(/\/+$/,"");
const CRAFTY_API_KEY   = (process.env.CRAFTY_API_KEY || "").trim();
const CRAFTY_SERVER_ID = process.env.CRAFTY_SERVER_ID;
const CRAFTY_INSECURE  = process.env.CRAFTY_INSECURE === "1";

if (!DISCORD_TOKEN || !CRAFTY_URL || !CRAFTY_API_KEY || !CRAFTY_SERVER_ID) {
  throw new Error("❌ Mancano variabili ambiente: DISCORD_TOKEN, CRAFTY_URL, CRAFTY_API_KEY, CRAFTY_SERVER_ID");
}

if (CRAFTY_INSECURE) process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const httpsAgent = new https.Agent({ rejectUnauthorized: !CRAFTY_INSECURE });

const AUTH_HEADERS = [
  (k)=>({ "X-Api-Key": k, "Content-Type":"application/json" }),
  (k)=>({ "Authorization": `Bearer ${k}`, "Content-Type":"application/json" }),
  (k)=>({ "Authorization": `Token ${k}`, "Content-Type":"application/json" }),
  (k)=>({ "Authorization": `Api-Key ${k}`, "Content-Type":"application/json" }),
];

const BASES = ["/panel/api/v3", "/api/v3", "/panel/api/v2", "/api/v2"];

function looksHtml(res){
  const ct = res.headers?.["content-type"] || "";
  return (typeof res.data === "string" && res.data.trim().startsWith("<!DOCTYPE")) || ct.includes("text/html");
}

async function tryAll(method, relUrl, body){
  // prova v3/v2 + vari header
  for (const base of BASES) {
    for (const H of AUTH_HEADERS) {
      try {
        const r = await axios({
          method,
          url: CRAFTY_URL + base + relUrl,
          data: body,
          headers: H(CRAFTY_API_KEY),
          httpsAgent,
          maxRedirects: 0,
          validateStatus: s => s>=200 && s<300
        });
        if (looksHtml(r)) throw new Error("HTML/login");
        return r.data;
      } catch (_) {
        // come fallback: stessa URL con ?key=
        try {
          const sep = relUrl.includes("?") ? "&" : "?";
          const r2 = await axios({
            method,
            url: CRAFTY_URL + base + relUrl + `${sep}key=${encodeURIComponent(CRAFTY_API_KEY)}`,
            data: body,
            headers: { "Content-Type":"application/json" },
            httpsAgent,
            maxRedirects: 0,
            validateStatus: s => s>=200 && s<300
          });
          if (looksHtml(r2)) throw new Error("HTML/login");
          return r2.data;
        } catch(e2){ /* passa alla prossima variante */ }
      }
    }
  }
  throw new Error("403");
}

// ---- API helpers
async function getStatus() {
  // prova stats/state su v3/v2
  const paths = [
    `/servers/${CRAFTY_SERVER_ID}/stats`,
    `/servers/${CRAFTY_SERVER_ID}/state`,
    `/servers/${CRAFTY_SERVER_ID}` // dettaglio come fallback
  ];
  for (const p of paths) {
    try {
      const d = await tryAll("GET", p);
      const data = (d && typeof d==="object" && d.data) ? d.data : d;
      const candidates = [data?.running, data?.online, data?.state, data?.status, data?.power, data?.server_state];
      for (const v of candidates) {
        if (v === true) return "running";
        if (v === false) return "stopped";
        if (typeof v === "number") return v ? "running" : "stopped";
        if (typeof v === "string") return v.toLowerCase();
      }
      return "unknown";
    } catch (_) { /* prova prossimo path */ }
  }
  throw new Error("403");
}

async function power(action){
  // v3: POST /power {action}, v2: POST /power/{action}
  // proviamo entrambi
  try { await tryAll("POST", `/servers/${CRAFTY_SERVER_ID}/power`, { action }); return; } catch {}
  await tryAll("POST", `/servers/${CRAFTY_SERVER_ID}/power/${action}`);
}

// ---- Discord bot
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const fp = CRAFTY_API_KEY.length>12 ? `${CRAFTY_API_KEY.slice(0,6)}…${CRAFTY_API_KEY.slice(-6)}` : "(short)";
  console.log(`BASE=${CRAFTY_URL} | INSECURE=${CRAFTY_INSECURE?1:0} | SERVER_ID=${CRAFTY_SERVER_ID} | APIKEY=${fp}`);
});

client.on("messageCreate", async (m) => {
  if (m.author.bot) return;
  if (!m.content.startsWith("!server")) return;
  const [, sub] = m.content.trim().split(/\s+/);
  const cmd = (sub || "").toLowerCase();

  try {
    if (cmd === "status") {
      const st = await getStatus();
      return m.reply(`Stato server: **${st}**`);
    }
    if (cmd === "on") {
      await power("start");
      return m.reply("🚀 Avvio richiesto.");
    }
    if (cmd === "off") {
      await power("stop");
      return m.reply("⏹️ Arresto richiesto.");
    }
    if (cmd === "restart") {
      await power("restart");
      return m.reply("🔄 Riavvio richiesto.");
    }
    if (cmd === "permscheck") {
      const out = [];
      async function t(label, fn){ try { await fn(); out.push(`${label}: OK`); } catch(e){ out.push(`${label}: 403`);} }
      await t("POWER start",   () => power("start"));
      await t("POWER stop",    () => power("stop"));
      await t("POWER restart", () => power("restart"));
      return m.reply("🔎 Permscheck:\n```\n" + out.join("\n") + "\n```");
    }
    if (cmd === "debug") {
      // prova whoami/servers con più varianti
      let who=null, list=null, errW=null, errL=null;
      try { who  = await tryAll("GET", "/whoami"); } catch(e){ errW = e.message; }
      try { list = await tryAll("GET", "/servers"); } catch(e){ errL = e.message; }
      return m.reply("Debug:\n```json\n" + JSON.stringify({ who: who||errW, servers: list||errL }, null, 2).slice(0,1800) + "\n```");
    }
    // help
    return m.reply("Comandi: `!server status | on | off | restart | permscheck | debug`");
  } catch (e) {
    const code = e.response?.status ? `HTTP ${e.response.status}` : (e.code || e.message);
    return m.reply(`❌ Errore: ${code}`);
  }
});

client.login(DISCORD_TOKEN);
