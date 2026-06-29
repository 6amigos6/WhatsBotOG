FROM node:20-bullseye

WORKDIR /app

RUN apt-get update && apt-get install -y \
  ffmpeg \
  libvips \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

ENV TELEGRAM_TOKEN=""
ENV OWNER_NUMBER="994501234567"

CMD ["node", "index.js"]
