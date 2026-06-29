#!/bin/bash

BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BOT_DIR"

echo "========================================"
echo "  ORUJOV Bot - Starting..."
echo "========================================"

if [ -z "$TELEGRAM_TOKEN" ] && [ ! -f token.txt ]; then
  # Also check settings.js
  if node -e "const s=require('./settings');process.exit(s.telegramToken?0:1)" 2>/dev/null; then
    : # token found in settings.js
  else
    echo "ERROR: TELEGRAM_TOKEN not found!"
    echo "Add telegramToken to settings.js, create token.txt, or set TELEGRAM_TOKEN env."
    exit 1
  fi
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install --legacy-peer-deps
fi

echo "Starting bot..."
while true; do
  node --max-old-space-size=512 index.js
  EXIT_CODE=$?
  echo "Bot exited with code $EXIT_CODE"
  if [ $EXIT_CODE -eq 0 ]; then
    echo "Clean exit. Not restarting."
    break
  fi
  echo "Restarting in 5 seconds..."
  sleep 5
done
