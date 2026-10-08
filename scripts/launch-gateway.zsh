#!/bin/zsh
set -euo pipefail

repo="${0:A:h:h}"
app="${1:-$repo/target/release/bundle/macos/LuxeCode.app}"
engine="$HOME/Library/Application Support/com.luxecode.desktop/engine/bin/opencode"
[[ -x "$engine" && -x "$app/Contents/MacOS/luxecode" ]] || {
  print -u2 "Missing private OpenCode engine or LuxeCode app."
  exit 1
}
if pgrep -x luxecode >/dev/null; then
  print -u2 "LuxeCode is already running. Configure 9router in Settings → Providers."
  exit 1
fi
unset LUXECODE_9ROUTER_API_KEY LUXECODE_GATEWAY_PROFILE
print "P2: use Settings → Providers → 9router gateway to store the key in macOS Keychain and select a model/combo."
export PATH="${engine:h}:$PATH"
exec "$app/Contents/MacOS/luxecode"
