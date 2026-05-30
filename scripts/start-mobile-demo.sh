#!/usr/bin/env bash
# Start CivicVox mobile for judges (Expo tunnel + env check)
# Usage: ./scripts/start-mobile-demo.sh [https://your-machine.ts.net]

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE="$ROOT/mobile"
API_URL="${1:-${EXPO_PUBLIC_API_URL:-}}"

cd "$MOBILE"

if [[ ! -d node_modules ]]; then
  echo "Installing mobile dependencies..."
  npm install
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Created mobile/.env — set EXPO_PUBLIC_API_URL to your Tailscale Funnel URL."
fi

if [[ -n "$API_URL" ]]; then
  WS_URL="${API_URL/https:\/\//wss:\/\/}"
  WS_URL="${WS_URL/http:\/\//ws:\/\/}"
  WS_URL="${WS_URL%/}/ws/stream"
  grep -q '^EXPO_PUBLIC_API_URL=' .env && sed -i.bak "s|^EXPO_PUBLIC_API_URL=.*|EXPO_PUBLIC_API_URL=$API_URL|" .env || echo "EXPO_PUBLIC_API_URL=$API_URL" >> .env
  grep -q '^EXPO_PUBLIC_WS_URL=' .env && sed -i.bak "s|^EXPO_PUBLIC_WS_URL=.*|EXPO_PUBLIC_WS_URL=$WS_URL|" .env || echo "EXPO_PUBLIC_WS_URL=$WS_URL" >> .env
  rm -f .env.bak
  echo "Using API: $API_URL"
fi

echo ""
echo "Starting Expo with tunnel..."
npm run start:demo
