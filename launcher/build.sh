#!/usr/bin/env bash
# Builds the workflow launcher, a native macOS app, into launcher/build/Complier Workflows.app.
#
#   launcher/build.sh            # build
#   launcher/build.sh --install  # build, copy to ~/Applications and open it
#
# Needs Xcode's command line tools (swiftc). macOS 14 or later.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
APP="$HERE/build/Complier Workflows.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
swiftc -O -target "$(uname -m)-apple-macos14" -framework AppKit -framework SwiftUI -framework Carbon \
  -o "$APP/Contents/MacOS/ComplierWorkflows" "$HERE/Sources/main.swift"
cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Complier Workflows</string>
  <key>CFBundleIdentifier</key><string>dev.complier.workflows</string>
  <key>CFBundleExecutable</key><string>ComplierWorkflows</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
EOF
codesign --force --sign - "$APP" >/dev/null
echo "launcher/build.sh: built $APP"

if [ "${1:-}" = --install ]; then
  mkdir -p "$HOME/Applications"
  pkill -x ComplierWorkflows 2>/dev/null || true
  rm -rf "$HOME/Applications/Complier Workflows.app"
  cp -R "$APP" "$HOME/Applications/"
  open "$HOME/Applications/Complier Workflows.app"
  echo "launcher/build.sh: installed in ~/Applications and opened it. Press ⌃⌥Space to show it."
fi
