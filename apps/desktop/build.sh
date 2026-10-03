#!/bin/zsh
# Builds JobSniper.app: web dist + compiled Bun API + Rust crawler as sidecars, wrapped by Tauri.
#   zsh apps/desktop/build.sh            build only
#   zsh apps/desktop/build.sh --install  build and copy to /Applications
#   zsh apps/desktop/build.sh --dmg      also produce the .dmg installer for a release
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DESKTOP="$ROOT/apps/desktop"
TRIPLE="$(rustc -vV | sed -n 's/^host: //p')"
BIN="$DESKTOP/src-tauri/binaries"
mkdir -p "$BIN"

echo "1/4 web"
(cd "$ROOT/apps/web" && bun install --silent && bun run build >/dev/null)

echo "2/4 api (compiled Bun binary)"
(cd "$ROOT/apps/api" && bun install --silent && bun build --compile --minify src/index.ts --outfile "$BIN/jobsniper-api-$TRIPLE" >/dev/null)

echo "3/4 crawler (Rust release)"
(cd "$ROOT/crates/crawler" && cargo build --release --quiet)
cp "$ROOT/crates/crawler/target/release/jobsniper-crawler" "$BIN/jobsniper-crawler-$TRIPLE"

echo "4/4 JobSniper.app"
BUNDLES="app"
[[ " $* " == *" --dmg "* ]] && BUNDLES="app,dmg"
(cd "$DESKTOP" && bunx --bun @tauri-apps/cli@2 build --bundles "$BUNDLES")
APP="$DESKTOP/src-tauri/target/release/bundle/macos/JobSniper.app"
du -sh "$APP"

if [[ " $* " == *" --install "* ]]; then
  # An older launchd setup would double-run the engine; the app now owns it.
  for name in api crawler; do launchctl bootout "gui/$(id -u)/com.ade.jobsniper.$name" 2>/dev/null || true; done
  rm -rf /Applications/JobSniper.app
  cp -R "$APP" /Applications/
  echo "installed: /Applications/JobSniper.app"
fi
