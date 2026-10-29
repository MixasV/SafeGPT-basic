#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  SafeGPT - local self-hosted build.
#
#  Run ./start.sh, or:  npm run start:local   (from web/)
#
#  Starts the interface on http://localhost:5173 and opens your browser.
#
#  There is no API key to configure. This repository has no AI features:
#  the ChainGPT integration lives in safegpt-platform. The only optional
#  setting is VITE_ALCHEMY_API_KEY, for a faster token scan.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo
  echo "  Node.js is required but was not found on your PATH."
  echo "  Install it from https://nodejs.org and run this again."
  echo
  exit 1
fi

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
  echo
  echo "  Created .env from .env.example."
  echo "  Optional: add VITE_ALCHEMY_API_KEY for a faster token scan."
  echo
fi

echo "  Installing dependencies if needed..."
cd web
npm install
npm run start:local
