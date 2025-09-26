const { REST, Routes } = require("discord.js");
require("dotenv").config();

const TOKEN = process.env.DISCORD_TOKEN;
const APP_ID = process.env.DISCORD_APP_ID; // Application ID
const GUILD_ID = process.env.GUILD_ID;     // ID della tua guild

if (!TOKEN || !APP_ID) {
  throw new Error("Mancano ENV: DISCORD_TOKEN e DISCORD_APP_ID (GUILD_ID consigliato).");
}

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("🔄 Rimuovo comandi **globali**…");
    await rest.put(Routes.applicationCommands(APP_ID), { body: [] });
    console.log("✅ Globali rimossi.");

    if (GUILD_ID) {
      console.log("🔄 Rimuovo comandi **guild**…");
      await rest.put(Routes.applicationGuildCommands(APP_ID, GUILD_ID), { body: [] });
      console.log("✅ Guild rimossi.");
    } else {
      console.log("ℹ️ Nessuna GUILD_ID fornita: saltata rimozione comandi di guild.");
    }

    console.log("🎉 Tutti gli slash sono stati eliminati.");
  } catch (err) {
    console.error("❌ Errore nella rimozione:", err);
  }
})();
