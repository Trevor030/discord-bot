{\rtf1\ansi\ansicpg1252\cocoartf2822
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 import os, asyncio\
import discord\
from discord import app_commands\
\
intents = discord.Intents.default()\
intents.message_content = True  # per !ping; per solo /ping potresti metterlo False\
bot = discord.Client(intents=intents)\
tree = app_commands.CommandTree(bot)\
\
GUILD_ID = os.getenv("GUILD_ID")  # opzionale: limita la sync ad una guild\
GUILD = discord.Object(id=int(GUILD_ID)) if GUILD_ID else None\
\
@bot.event\
async def on_ready():\
    try:\
        if GUILD:\
            await tree.sync(guild=GUILD)\
        else:\
            await tree.sync()\
        print(f"Logged in as \{bot.user\} \'96 slash commands synced")\
    except Exception as e:\
        print("Slash sync error:", e)\
\
@tree.command(name="ping", description="Risponde pong", guild=GUILD if GUILD else None)\
async def slash_ping(interaction: discord.Interaction):\
    await interaction.response.send_message("pong")\
\
@bot.event\
async def on_message(message: discord.Message):\
    if message.author.bot:\
        return\
    if message.content.strip().lower() == "!ping":\
        await message.channel.send("pong")\
\
async def main():\
    await bot.start(os.environ["DISCORD_TOKEN"])\
\
asyncio.run(main())}