#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"
exec /usr/local/bin/node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 8080 "$@"
