#!/usr/bin/env bash
# Builds guard_driver against your FDR 4 install, and the FDR-independent step-logic test.
#
#   fdr/build.sh      # FDR from FDR_HOME, else from `refines` on PATH (see env.sh)
#
# Needs g++ with C++11. FDR 4.2.7's libfdr was built with the pre-C++11 std::string ABI, and its
# lib/ bundles an older libstdc++, so the driver uses the old ABI and lists the system libstdc++
# first in its RPATH (DT_RPATH, which also covers libfdr's own lookups).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
. "$HERE/env.sh"

if [ -n "${TINFO5_DIR:-}" ]; then
  [ -f "$TINFO5_DIR/libtinfo.so.5" ] || { echo "fdr/build.sh: no libtinfo.so.5 in TINFO5_DIR=$TINFO5_DIR" >&2; exit 1; }
elif ! ldconfig -p 2>/dev/null | grep -q 'libtinfo\.so\.5 '; then
  echo "fdr/build.sh: FDR 4.2.7 needs libtinfo.so.5, which this system doesn't have." >&2
  echo "Set TINFO5_DIR as fdr/README.md shows for Ubuntu 24.04, then build again." >&2
  exit 1
fi

SYSTEM_LIB_DIR=$(dirname "$(g++ -print-file-name=libstdc++.so.6)")
mkdir -p "$HERE/build"
g++ -std=c++11 -O2 -Wall -Wextra -D_GLIBCXX_USE_CXX11_ABI=0 \
  -I"$FDR_HOME/include" -o "$HERE/build/guard_driver" "$HERE/src/guard_driver.cc" \
  -L"$FDR_HOME/lib" -lfdr -Wl,--disable-new-dtags -Wl,-rpath,"$SYSTEM_LIB_DIR:$FDR_LIBS"
g++ -std=c++11 -O2 -Wall -Wextra -o "$HERE/build/test_guard_step" "$HERE/tests/test_guard_step.cc"

missing=$(ldd "$HERE/build/guard_driver" | grep 'not found' || true)
if [ -n "$missing" ]; then
  echo "fdr/build.sh: built, but these libraries can't be found:" >&2
  echo "$missing" >&2
  echo "For libtinfo.so.5, set TINFO5_DIR (fdr/README.md) and build again." >&2
  exit 1
fi
echo "fdr/build.sh: built build/guard_driver and build/test_guard_step (FDR at $FDR_HOME)"
