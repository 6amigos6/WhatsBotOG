#!/bin/bash

BOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BOT_DIR"

case "${1:-start}" in
  start)
    echo "Starting ORUJOV Bot..."
    termux-wake-lock 2>/dev/null || true
    tmux new-session -d -s orujov 'bash start.sh' 2>/dev/null || {
      tmux kill-session -t orujov 2>/dev/null
      tmux new-session -d -s orujov 'bash start.sh'
    }
    sleep 2
    if tmux has-session -t orujov 2>/dev/null; then
      echo "✅ Bot started in tmux session 'orujov'"
      echo "   View logs: tmux attach -t orujov"
    else
      echo "❌ Failed to start bot"
    fi
    ;;
  stop)
    echo "Stopping ORUJOV Bot..."
    tmux kill-session -t orujov 2>/dev/null
    termux-wake-unlock 2>/dev/null || true
    echo "✅ Bot stopped"
    ;;
  restart)
    $0 stop
    sleep 2
    $0 start
    ;;
  logs)
    tmux attach -t orujov
    ;;
  status)
    if tmux has-session -t orujov 2>/dev/null; then
      echo "✅ Bot is RUNNING"
      tmux list-windows -t orujov
    else
      echo "❌ Bot is NOT running"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|logs|status}"
    ;;
esac
