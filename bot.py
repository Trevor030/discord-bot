import os, asyncio
import discord
import docker

intents = discord.Intents.default()
intents.message_content = True
bot = discord.Client(intents=intents)

DOCKER = docker.from_env()
CRAFTY_NAME = os.getenv("CRAFTY_CONTAINER_NAME", "crafty")

def get_crafty():
    try:
        return DOCKER.containers.get(CRAFTY_NAME)
    except Exception:
        return None

@bot.event
async def on_ready():
    print(f"✅ Logged in as {bot.user}")

@bot.event
async def on_message(message):
    if message.author.bot:
        return
    content = message.content.strip().lower()

    if content == "!server status":
        c = get_crafty()
        if not c:
            await message.channel.send("❌ Container Crafty non trovato.")
            return
        await message.channel.send(f"ℹ️ Server status: **{c.status}**")
        return

    if content == "!server on":
        c = get_crafty()
        if not c:
            await message.channel.send("❌ Container Crafty non trovato.")
            return
        if c.status == "running":
            await message.channel.send("✅ Server già acceso.")
            return
        try:
            c.start()
            await message.channel.send("🚀 Server acceso.")
        except Exception as e:
            await message.channel.send(f"❌ Errore avvio: `{e}`")
        return

    if content == "!server off":
        c = get_crafty()
        if not c:
            await message.channel.send("❌ Container Crafty non trovato.")
            return
        if c.status != "running":
            await message.channel.send("✅ Server già spento.")
            return
        try:
            c.stop(timeout=30)
            await message.channel.send("⏹️ Server spento.")
        except Exception as e:
            await message.channel.send(f"❌ Errore stop: `{e}`")
        return

    if content == "!server restart":
        c = get_crafty()
        if not c:
            await message.channel.send("❌ Container Crafty non trovato.")
            return
        try:
            c.restart(timeout=30)
            await message.channel.send("🔄 Server riavviato.")
        except Exception as e:
            await message.channel.send(f"❌ Errore restart: `{e}`")
        return

async def main():
    await bot.start(os.environ["DISCORD_TOKEN"])

asyncio.run(main())
