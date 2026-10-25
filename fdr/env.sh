# Sourced by build.sh, demo.sh and test.sh: finds FDR and the libraries it runs with.
#
# FDR_HOME     the unpacked FDR 4 directory (bin/, lib/, include/fdr/). If unset, it is found
#              from `refines` on PATH.
# TINFO5_DIR   a directory holding libtinfo.so.5, only where the system has none (Ubuntu 24.04;
#              see README.md).
if [ -z "${FDR_HOME:-}" ] && command -v refines >/dev/null; then
  FDR_HOME=$(cd "$(dirname "$(readlink -f "$(command -v refines)")")/.." && pwd)
fi
if [ -z "${FDR_HOME:-}" ] || [ ! -f "$FDR_HOME/include/fdr/fdr.h" ]; then
  echo "fdr: no FDR found. Set FDR_HOME to the unpacked FDR directory (the one with bin/, lib/ and" >&2
  echo "     include/fdr/), or put its bin/ on PATH. See fdr/README.md." >&2
  exit 1
fi
# Searched by the built driver (RPATH) and given to refines (LD_LIBRARY_PATH).
FDR_LIBS="$FDR_HOME/lib${TINFO5_DIR:+:$TINFO5_DIR}"
