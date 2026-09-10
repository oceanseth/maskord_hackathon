#!/usr/bin/env bash
# scripts/build-ios-app.sh
# Builds a signed .ipa for Maskord iOS and uploads to App Store Connect (TestFlight).
#
# Usage:
#   APPLE_ID=you@example.com APPLE_APP_SPECIFIC_PASSWORD=xxxx-xxxx-xxxx-xxxx bash scripts/build-ios-app.sh
#
# Requirements:
#   - Xcode + CocoaPods installed
#   - Apple Distribution cert in Keychain (team: MXZZQH555K)
#   - APPLE_ID and APPLE_APP_SPECIFIC_PASSWORD env vars set
#     (app-specific password: appleid.apple.com → Sign-In and Security → App-Specific Passwords)

set -euo pipefail

# Load local credentials if present
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/.env.local" ]]; then
  set -a; source "$SCRIPT_DIR/.env.local"; set +a
fi

: "${APPLE_ID:?APPLE_ID not set — add it to scripts/.env.local}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?APPLE_APP_SPECIFIC_PASSWORD not set — add it to scripts/.env.local}"

TEAM_ID="MXZZQH555K"
SCHEME="Maskord"
WORKSPACE="app/mobile/ios/Maskord.xcworkspace"
ARCHIVE_PATH="app/mobile/build/Maskord.xcarchive"
EXPORT_PATH="app/mobile/build/export"
IPA_NAME="Maskord-ios.ipa"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Installing JS dependencies"
npm ci --workspace=app/mobile --workspace=app/shared

echo "==> Installing CocoaPods"
(cd app/mobile/ios && pod install --repo-update)

echo "==> Archiving"
if command -v xcpretty &>/dev/null; then
  set -o pipefail
  xcodebuild archive \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -configuration Release \
    -archivePath "$ARCHIVE_PATH" \
    -destination "generic/platform=iOS" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    CODE_SIGN_STYLE=Automatic \
    | xcpretty
else
  xcodebuild archive \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -configuration Release \
    -archivePath "$ARCHIVE_PATH" \
    -destination "generic/platform=iOS" \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    CODE_SIGN_STYLE=Automatic
fi

cat > /tmp/maskord-export-options.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store</string>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
EOF

echo "==> Exporting .ipa"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist /tmp/maskord-export-options.plist \
  -allowProvisioningUpdates

IPA_FILE=$(find "$EXPORT_PATH" -name "*.ipa" | head -1)
cp "$IPA_FILE" "app/mobile/build/${IPA_NAME}"
echo "==> Built: app/mobile/build/${IPA_NAME}"

echo "==> Uploading to App Store Connect (TestFlight)"
xcrun altool --upload-app \
  --type ios \
  --file "app/mobile/build/${IPA_NAME}" \
  --username "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$TEAM_ID"

echo "==> Done — build will appear in TestFlight within a few minutes"
