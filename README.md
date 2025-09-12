# Discord Bot (Node.js) — Portainer/ZimaOS

## Files
- `Dockerfile`
- `package.json`
- `index.js` (comando `!ping`)
- `docker-compose.yml` (usa variabile `DISCORD_TOKEN`)

## Deploy (Portainer → Stacks → Repository)
1. Crea un repo GitHub e carica questi file nella root.
2. In Portainer: **Stacks → Add stack → Repository**.
3. URL del repo, `Compose path = docker-compose.yml`.
4. Aggiungi la variabile di ambiente `DISCORD_TOKEN` (token del bot).
5. **Deploy the stack** e controlla i log.

## Local build (facoltativo)
`docker compose up -d` (se hai Docker locale).
