#!/usr/bin/env bash
# Deploy voice staging — opencode server + web UI on Fly.io.
#
# Prerequisites:
#   flyctl auth login
#   fly apps create opencode-voice-server
#   fly apps create opencode-voice-ui
#   fly volumes create tenants --size 10 --region iad -a opencode-voice-server
#
# Secrets (once per app):
#   fly secrets set OPENCODE_SERVER_PASSWORD=… XAI_API_KEY=… -a opencode-voice-server
#
# Usage:
#   ./scripts/deploy-voice-staging.sh          # server + ui
#   ./scripts/deploy-voice-staging.sh server
#   ./scripts/deploy-voice-staging.sh ui

set -euo pipefail

if ! command -v fly >/dev/null 2>&1; then
  echo "error: fly not found. Install flyctl:" >&2
  echo "  curl -L https://fly.io/install.sh | sh" >&2
  echo "  export PATH=\"\$HOME/.fly/bin:\$PATH\"" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="${1:-all}"

deploy_server() {
  echo "==> Deploying opencode server to Fly..."
  fly deploy "$ROOT" \
    --config "$ROOT/packages/opencode/fly.toml" \
    --dockerfile packages/opencode/Dockerfile.server
  echo "    Health: https://opencode-voice-server.fly.dev/global/health"
  echo "    Voice:  https://opencode-voice-server.fly.dev/voice/health"
}

deploy_ui() {
  echo "==> Deploying web UI to Fly..."
  fly deploy "$ROOT" \
    --config "$ROOT/packages/app/fly.toml" \
    --dockerfile packages/app/Dockerfile
  echo "    App: https://opencode-voice-ui.fly.dev"
}

case "$TARGET" in
  server) deploy_server ;;
  ui) deploy_ui ;;
  all)
    deploy_server
    deploy_ui
    ;;
  *)
    echo "usage: $0 [server|ui|all]" >&2
    exit 1
    ;;
esac

echo "==> Done."
echo "    UI:     https://opencode-voice-ui.fly.dev"
echo "    Server: https://opencode-voice-server.fly.dev"
