#!/usr/bin/env bash
set -e

# Resolve script directory and repo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Ensure Node 22+ is in PATH
if [ -d "$HOME/.nvm/versions/node/v22.23.2/bin" ]; then
  export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
fi

cd "$REPO_ROOT"
exec pnpm exec tsx "$SCRIPT_DIR/run.ts" "$@"
