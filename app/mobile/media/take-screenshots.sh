#!/usr/bin/env bash
# media/take-screenshots.sh
# Boots simulators at the correct sizes for App Store screenshots.
# Once the app is showing the screen you want, press Enter to capture.
#
# Usage: bash app/mobile/media/take-screenshots.sh

set -euo pipefail

APP_BUNDLE="com.maskord.app"
SCREENSHOTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/screenshots"

capture() {
  local dir="$1"
  local label="$2"
  local index="$3"
  local udid="$4"

  echo ""
  echo "  Navigate to: $label"
  read -p "  Press Enter to capture screenshot $index..." _
  xcrun simctl io "$udid" screenshot "$dir/${index}-${label// /-}.png"
  echo "  ✅ Saved: $dir/${index}-${label// /-}.png"
}

boot_simulator() {
  local name="$1"
  local udid

  udid=$(xcrun simctl list devices available | grep "$name" | head -1 | grep -o '[A-F0-9-]\{36\}')
  if [[ -z "$udid" ]]; then
    echo "⚠️  Simulator '$name' not found. Check available simulators with: xcrun simctl list devices"
    exit 1
  fi

  echo "==> Booting $name ($udid)"
  xcrun simctl boot "$udid" 2>/dev/null || true
  open -a Simulator

  echo "==> Installing Maskord on simulator"
  # Build dev app for simulator first if needed:
  # cd app/mobile && npx expo run:ios --simulator "$name"

  echo "$udid"
}

echo "=============================="
echo " Maskord App Store Screenshots"
echo "=============================="
echo ""
echo "Which device would you like to capture?"
echo "  1) 6.9-inch — iPhone 17 Pro Max (REQUIRED)"
echo "  2) 6.7-inch — iPhone 15 Plus (optional)"
read -p "Choice [1/2]: " choice

case "$choice" in
  1)
    DEVICE="iPhone 17 Pro Max"
    DIR="$SCREENSHOTS_DIR/6.9-inch"
    ;;
  2)
    DEVICE="iPhone 15 Plus"
    DIR="$SCREENSHOTS_DIR/6.7-inch"
    ;;
  *)
    echo "Invalid choice"
    exit 1
    ;;
esac

UDID=$(boot_simulator "$DEVICE")

echo ""
echo "==> App should now be running on the simulator."
echo "    You'll be prompted before each screenshot."
echo "    Suggested screens to capture:"
echo "      1 - Login / welcome screen"
echo "      2 - Server / guild list"
echo "      3 - Chat channel"
echo "      4 - Voice channel"
echo "      5 - Profile / mask selector"
echo ""

for i in 1 2 3 4 5; do
  read -p "Label for screenshot $i (e.g. 'Chat Channel'): " label
  capture "$DIR" "$label" "$i" "$UDID"
done

echo ""
echo "==> Done! Screenshots saved to: $DIR"
echo "    Upload these at appstoreconnect.apple.com"
