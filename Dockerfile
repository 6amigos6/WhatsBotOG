FROM node:20-bullseye-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
  ffmpeg \
  git \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .

ENV TELEGRAM_TOKEN=""
ENV OWNER_NUMBER=""

EXPOSE 3000

CMD ["node", "--max-old-space-size=512", "index.js"]
