#!/bin/sh
# Installs the latest complier release for this computer into ~/.complier (or $COMPLIER_HOME):
#
#   curl -fsSL https://raw.githubusercontent.com/kavishsathia/complier/main/install.sh | sh
#
# complier also needs Java 11 or later, and your own copy of FDR with its licence; this script
# checks for both but installs neither.
set -eu
REPO=kavishsathia/complier
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) TARGET=darwin-arm64 ;;
  Darwin-x86_64) TARGET=darwin-x86_64 ;;
  Linux-x86_64) TARGET=linux-x86_64 ;;
  *) echo "complier: no release for $(uname -s) $(uname -m) yet" >&2; exit 1 ;;
esac
DEST=${COMPLIER_HOME:-$HOME/.complier}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

if [ -n "${COMPLIER_TARBALL:-}" ]; then
  # A release packaged locally (release/package.sh), for trying a release before it's published.
  cp "$COMPLIER_TARBALL" "$TMP/complier.tar.gz"
else
  echo "Downloading complier for $TARGET..."
  curl -fsSL "https://github.com/$REPO/releases/latest/download/complier-$TARGET.tar.gz" -o "$TMP/complier.tar.gz"
fi
tar -xzf "$TMP/complier.tar.gz" -C "$TMP"
mkdir -p "$DEST"
rm -rf "$DEST/bin" "$DEST/lib" "$DEST/plugin" "$DEST/packages" "$DEST/examples"
cp -R "$TMP/complier/." "$DEST/"
echo "Installed complier in $DEST"

command -v java >/dev/null 2>&1 || echo "Note: complier needs Java 11 or later, and this computer has none on PATH."
case "$TARGET" in
  darwin-*) [ -d "${FDR_HOME:-/Applications/FDR4.app}" ] || echo "Note: FDR isn't in /Applications/FDR4.app. Install it from https://cocotec.io/fdr/, or set FDR_HOME." ;;
  *) command -v refines >/dev/null 2>&1 || [ -n "${FDR_HOME:-}" ] || echo "Note: FDR isn't on PATH. Install it from https://cocotec.io/fdr/, and set FDR_HOME." ;;
esac

# Put complier first on PATH in the shell's startup file, so it wins over any older copy.
LINE="export PATH=\"$DEST/bin:\$PATH\""
case "$(basename "${SHELL:-sh}")" in
  zsh) RC=$HOME/.zshrc ;;
  bash) if [ "$(uname -s)" = Darwin ]; then RC=$HOME/.bash_profile; else RC=$HOME/.bashrc; fi ;;
  *) RC= ;;
esac
if [ -n "$RC" ]; then
  grep -qsF "$LINE" "$RC" || printf '\n# complier\n%s\n' "$LINE" >> "$RC"
  echo "Added complier to your PATH in $RC. Open a new terminal, then check everything with: complier doctor"
else
  echo "Add complier to your PATH, in your shell's startup file:"
  echo "  $LINE"
  echo "Then check everything with: complier doctor"
fi
