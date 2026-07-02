#!/bin/bash
BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BOT_DIR"

echo "========================================"
echo "  GASHAM Bot - Starting..."
echo "========================================"

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
