#!/usr/bin/env bash
# Builds the wall app for a connected iPhone and installs and launches it.
# Usage: scripts/install-wall-device.sh [device-name-or-udid] [-CS_PREVIEW_STATE waiting] ...
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/wall-app"

DEVICE="${1:-}"
shift || true

if [ -z "$DEVICE" ]; then
  DEVICE="$(xcrun devicectl list devices 2>/dev/null | awk 'NR>2 && $0 ~ /iPhone/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{4}-/) {print $i; exit}}')"
fi
if [ -z "$DEVICE" ]; then
  echo "No iPhone found. Plug it in with a cable, unlock it, tap Trust, then run again." >&2
  exit 1
fi

STATE="$(xcrun devicectl list devices 2>/dev/null | grep -F "$DEVICE" | grep -o -E 'connected|available|unavailable' | head -1 || true)"
if [ "$STATE" = "unavailable" ]; then
  echo "iPhone is known but not reachable. Plug it in with a cable and unlock it, then run again." >&2
  exit 1
fi
echo "Device $DEVICE ($STATE)"

xcodegen generate >/dev/null
xcodebuild -project ContentStationWall.xcodeproj -scheme ContentStationWall \
  -destination 'generic/platform=iOS' -derivedDataPath build-device \
  -allowProvisioningUpdates build 2>&1 | grep -E "error:|BUILD (SUCCEEDED|FAILED)"

APP="$(find build-device -name ContentStationWall.app -path '*iphoneos*' | head -1)"
[ -n "$APP" ] || { echo "No .app produced." >&2; exit 1; }

xcrun devicectl device install app --device "$DEVICE" "$APP"
xcrun devicectl device process launch --device "$DEVICE" --terminate-existing com.contentstation.station "$@"
echo "Installed and launched. First launch on a new phone asks you to trust the developer in Settings > General > VPN & Device Management."
