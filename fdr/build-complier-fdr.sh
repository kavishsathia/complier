#!/usr/bin/env bash
# Builds complier-fdr, the program complier's daemon runs to have FDR prove a policy and compile it
# into the automaton it drives, against your own FDR 4 install, and writes build/backend.json, which
# tells the daemon where it is. FDR is never copied: the binary loads it from where you installed it.
#
#   fdr/build-complier-fdr.sh
#
# macOS: FDR from FDR_HOME, else /Applications/FDR4.app. FDR for macOS is x86_64 only, so this
#        builds an x86_64 binary (it runs under Rosetta on Apple silicon). Needs Xcode's clang++.
# Linux: FDR from FDR_HOME or `refines` on PATH, as fdr/env.sh finds it (see fdr/README.md,
#        including TINFO5_DIR on Ubuntu 24.04). Needs g++ with C++11.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$HERE/build
mkdir -p "$OUT"
BIN=$OUT/complier-fdr

if [ "$(uname)" = Darwin ]; then
  FDR_HOME=${FDR_HOME:-/Applications/FDR4.app}
  [ -d "$FDR_HOME/Contents" ] && FDR_HOME=$FDR_HOME/Contents
  if [ ! -f "$FDR_HOME/Headers/fdr/fdr.h" ] || [ ! -f "$FDR_HOME/Frameworks/libfdr.dylib" ]; then
    echo "fdr/build-complier-fdr.sh: no FDR at $FDR_HOME. Install FDR 4 from https://cocotec.io/fdr/" >&2
    echo "  (it needs its own licence), or set FDR_HOME to FDR4.app." >&2
    exit 1
  fi
  LIB=$FDR_HOME/Frameworks
  clang++ -arch x86_64 -std=c++14 -O2 -Wall -Wextra -Wno-unused-parameter -I"$FDR_HOME/Headers" \
    -o "$BIN" "$HERE/src/complier_fdr.cc" -L"$LIB" -lfdr -Wl,-rpath,"$LIB"
  # libfdr.dylib's install name is bare, so point this binary at it through the rpath above.
  install_name_tool -change libfdr.dylib @rpath/libfdr.dylib "$BIN"
else
  . "$HERE/env.sh"
  SYSTEM_LIB_DIR=$(dirname "$(g++ -print-file-name=libstdc++.so.6)")
  # As build.sh: FDR 4.2.7's libfdr uses the pre-C++11 std::string ABI.
  g++ -std=c++11 -O2 -Wall -Wextra -D_GLIBCXX_USE_CXX11_ABI=0 -I"$FDR_HOME/include" \
    -o "$BIN" "$HERE/src/complier_fdr.cc" \
    -L"$FDR_HOME/lib" -lfdr -Wl,--disable-new-dtags -Wl,-rpath,"$SYSTEM_LIB_DIR:$FDR_LIBS"
fi

printf '{"driver":"%s","fdr":"%s"}\n' "$BIN" "$FDR_HOME" >"$OUT/backend.json"
echo "fdr/build-complier-fdr.sh: built $BIN against FDR at $FDR_HOME; wrote $OUT/backend.json"
