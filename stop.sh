#!/bin/bash
# Stop Jart-URA gracefully
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/pids/jart-ura.pid"

if [ -f "$PID_FILE" ]; then
  PID=$(cat "$PID_FILE")
  echo "Stopping Jart-URA (PID $PID)..."
  kill -TERM "$PID" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "Jart-URA stopped"
else
  echo "Jart-URA PID file not found"
fi

# Kill any orphaned llama-server children
pkill -f "llama-server" 2>/dev/null || true
