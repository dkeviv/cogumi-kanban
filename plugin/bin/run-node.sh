#!/bin/sh
# Starts a bundled entry point with a suitable Node.js (>= 22.13), even when the
# Claude desktop app was launched without the login shell's PATH (PRD PLG 01).
# Usage: run-node.sh <script.mjs> [args...]
# Each candidate is tried on its own (never word-split), so paths with spaces work.

run() {
  node_path=$1
  shift
  if [ -n "$node_path" ] && [ -x "$node_path" ] &&
     "$node_path" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' >/dev/null 2>&1; then
    exec "$node_path" --disable-warning=ExperimentalWarning "$@"
  fi
}

run "${COGUMI_NODE:-}" "$@"
run "$(command -v node 2>/dev/null)" "$@"
run /opt/homebrew/bin/node "$@"
run /usr/local/bin/node "$@"
run /usr/bin/node "$@"
run "$HOME/.volta/bin/node" "$@"
run "$HOME/.local/share/fnm/aliases/default/bin/node" "$@"
run "$HOME/.fnm/aliases/default/bin/node" "$@"
# nvm installs: the first one that meets the minimum version is used.
for dir in "$HOME"/.nvm/versions/node/v*; do
  run "$dir/bin/node" "$@"
done

echo "Cogumi Kanban needs Node.js 22.13 or newer. Install it (for example: brew install node) or set COGUMI_NODE to its path." >&2
exit 127
