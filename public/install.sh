#!/bin/sh
# Installs the complier CLI on macOS:
#   curl -fsSL https://complier.dev/install | sh
set -eu

REPO="kavishsathia/complier"
DEST="${COMPLIER_INSTALL_DIR:-$HOME/.complier/bin}"
URL="${COMPLIER_DOWNLOAD_URL:-https://github.com/$REPO/releases/latest/download/complier-macos-universal.tar.gz}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "complier: only macOS is supported for now" >&2
  exit 1
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading $URL"
curl -fsSL "$URL" -o "$tmp/complier.tar.gz"
tar -xzf "$tmp/complier.tar.gz" -C "$tmp"
mkdir -p "$DEST"
mv "$tmp/complier" "$DEST/complier"
chmod +x "$DEST/complier"
echo "Installed $DEST/complier"

# An upgrade replaces the binary under a running daemon; restart it.
launchctl kickstart -k "gui/$(id -u)/dev.complier.daemon" >/dev/null 2>&1 || true

case ":$PATH:" in
  *":$DEST:"*) ;;
  *)
    echo
    echo "Add complier to your PATH:"
    echo "  echo 'export PATH=\"$DEST:\$PATH\"' >> ~/.zshrc && exec zsh"
    ;;
esac
echo
echo "Then run 'complier init' inside a repo."
