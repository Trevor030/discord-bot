FROM node:18-alpine
WORKDIR /app

# dipendenze
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# sorgenti
COPY . .

CMD ["node", "index.js"]
