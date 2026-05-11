#!/bin/bash
# Jart-URA — Model Router for Tier-0
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

mkdir -p logs pids

echo "Starting Jart-URA..."
node server.js >> logs/jart-ura.log 2>&1 &
echo $! > pids/jart-ura.pid
echo "Jart-URA started (PID $(cat pids/jart-ura.pid))"
