# Discord Bot Crafty — ZimaOS/Portainer (Slash Commands)

## Variabili da impostare nello Stack (Environment variables)
- DISCORD_TOKEN = Token del bot (Developer Portal → Bot → Reset Token)
- DISCORD_APP_ID = Application ID (Developer Portal → General Information)
- GUILD_ID = ID del tuo server (opzionale ma consigliato per avere i comandi subito)
- CRAFTY_CONTAINER_NAME = big-bear-crafty  (o il nome del container come in Portainer)

## Deploy (Portainer → Stacks → Repository)
- Compose path: docker-compose.yml
- Dopo il deploy: controlla i log. Dovresti vedere:
  - Logged in as ...
  - Slash registrati su GUILD: <id>
  - Containers visibili: ...

## Uso
- /server status
- /server on
- /server off
- /server restart
- /server list
