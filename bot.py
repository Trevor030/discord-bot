import os, asyncio
import discord
from discord import app_commands

intents = discord.Intents.default()
intents.message_content = True  # per !ping; per solo /ping potresti metterlo False
bot = discord.Client(intents=intents)
tree = app_commands.CommandTree(bot)

GUILD_ID = os.getenv("GUILD_ID")  # opzionale: limita la sync ad una guild
GUILD = discord.Object(id=int(GUILD_ID)) if GUILD_ID else None

@bot.event
async def on_ready():
    try:
        if GUILD:
            await tree.sync(guild=GUILD)
        else:
            await tree.sync()
        print(f"Logged in as {bot.user} – slash commands synced")
    except Exception as e:
        print("Slash sync error:", e)

@tree.command(name="ping", description="Risponde pong", guild=GUILD if GUILD else None)
async def slash_ping(interaction: discord.Interaction):
    await interaction.response.send_message("pong")

@bot.event
async def on_message(message: discord.Message):
    if message.author.bot:
        return
    if message.content.strip().lower() == "!ping":
        await message.channel.send("pong")

async def main():
    await bot.start(os.environ["DISCORD_TOKEN"])

asyncio.run(main())
