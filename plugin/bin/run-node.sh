#!/bin/sh
# Starts a bundled entry point with a suitable Node.js (>= 22.13), even when the
# Claude desktop app was launched without the login shell's PATH (PRD PLG 01).
# Usage: run-node.sh <script.mjs> [args...]
min_ok() {
  "$1" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' >/dev/null 2>&1
}
pick() {
  for candidate in "$@"; do
    [ -n "$candidate" ] && [ -x "$candidate" ] && min_ok "$candidate" && { echo "$candidate"; return 0; }
  done
  return 1
}
CANDIDATES="${COGUMI_NODE:-} $(command -v node 2>/dev/null) /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node"
for dir in "$HOME/.volta/bin" "$HOME/.local/share/fnm/aliases/default/bin" "$HOME/.fnm/aliases/default/bin"; do
  CANDIDATES="$CANDIDATES $dir/node"
done
if [ -d "$HOME/.nvm/versions/node" ]; then
  for dir in $(ls -1d "$HOME"/.nvm/versions/node/v* 2>/dev/null | sort -r); do CANDIDATES="$CANDIDATES $dir/bin/node"; done
fi
# shellcheck disable=SC2086
NODE=$(pick $CANDIDATES) || {
  echo "Cogumi Claude Kanban needs Node.js 22.13 or newer. Install it (for example: brew install node) or set COGUMI_NODE to its path." >&2
  exit 127
}
exec "$NODE" --disable-warning=ExperimentalWarning "$@"
