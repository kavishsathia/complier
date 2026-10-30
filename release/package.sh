#!/usr/bin/env bash
# Packages one release of complier for one platform: the folder an install unpacks.
#
#   release/package.sh TARGET CLI CEL_JAR FDR_BRIDGE OUT_DIR
#
# Writes OUT_DIR/complier-TARGET.tar.gz holding complier/{bin/complier, lib/complier-cel.jar,
# lib/complier-fdr, plugin/, packages/, examples/}. FDR itself is never included: the bridge loads
# the user's own FDR when it runs.
set -euo pipefail
TARGET=$1 CLI=$2 JAR=$3 FDR=$4 OUT=$5
HERE=$(cd "$(dirname "$0")/.." && pwd)
STAGE=$(mktemp -d)/complier
mkdir -p "$STAGE/bin" "$STAGE/lib" "$OUT"
cp "$CLI" "$STAGE/bin/complier"
cp "$JAR" "$STAGE/lib/complier-cel.jar"
cp "$FDR" "$STAGE/lib/complier-fdr"
cp -R "$HERE/plugin" "$HERE/packages" "$HERE/examples" "$STAGE/"
cp "$HERE/LICENSE" "$STAGE/"
tar -czf "$OUT/complier-$TARGET.tar.gz" -C "$(dirname "$STAGE")" complier
echo "release/package.sh: wrote $OUT/complier-$TARGET.tar.gz"
