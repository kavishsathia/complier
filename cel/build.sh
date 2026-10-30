#!/usr/bin/env bash
# Builds complier's CEL backend: Google's cel-java 0.14.0 runtime and formal verifier (with Z3 4.14.1
# through z3-turnkey) behind ComplierCel, a small stdio bridge the Rust CLI talks to. Needs a JDK 11+
# and curl. Downloads land in .work/, the result in build/ (both gitignored); build/backend.json tells
# the CLI which java to run and with what classpath.
#
#   cel/build.sh            # JDK from JAVA_HOME, else javac/java on PATH
set -euo pipefail

# cel-java's verifier jar on Maven Central leaves out its tools package; these three files from it
# set up the compiler, verifier and variable declarations exactly as the CLI and the website do.
CEL_JAVA_COMMIT=5cf3ab3c9f0a2ccb4ac449527d41689ed6aa6879 # tag v0.14.0
UPSTREAM="8683815ca1e3ef304a577ef5105c00003dab506cca6c8fdbf672b833d14d36d8 CelVerifierToolCore.java
04c65414c8b2de1514223a5f37f49457be566f63c7a0807fa56e7c9ca604cee6 FormatUtils.java
a48407cf45bf0fb3f2d2e5a330e151b127d931c7c626c3f31d93b77a3edf088b VerificationOptions.java"

HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$HERE/.work
OUT=$HERE/build
BIN=${JAVA_HOME:+$JAVA_HOME/bin/}
command -v "${BIN}javac" >/dev/null || { echo "cel/build.sh: no javac; install a JDK 11+ or set JAVA_HOME" >&2; exit 1; }
JAVA=$(command -v "${BIN}java")
mkdir -p "$WORK/jars" "$WORK/upstream"

sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -c1-64; }

# fetch <sha256> <url> <dest>: downloads unless already there, and refuses anything else.
fetch() {
  if [ ! -f "$3" ] || [ "$(sha "$3")" != "$1" ]; then
    curl -sfL "$2" -o "$3.part" && mv "$3.part" "$3"
  fi
  if [ "$(sha "$3")" != "$1" ]; then
    rm -f "$3"
    echo "cel/build.sh: checksum mismatch for $2" >&2
    exit 1
  fi
}

CP=""
while read -r sum path; do
  case "$sum" in '' | '#'*) continue ;; esac
  dest=$WORK/jars/$(basename "$path")
  fetch "$sum" "https://repo1.maven.org/maven2/$path" "$dest"
  CP=$CP${CP:+:}$dest
done <"$HERE/deps.txt"

SRCS=()
while read -r sum file; do
  dest=$WORK/upstream/$file
  fetch "$sum" "https://raw.githubusercontent.com/cel-expr/cel-java/$CEL_JAVA_COMMIT/verifier/src/main/java/dev/cel/verifier/tools/$file" "$dest"
  SRCS+=("$dest")
done <<<"$UPSTREAM"

rm -rf "$OUT" && mkdir -p "$OUT/classes"
"${BIN}javac" --release 11 -nowarn -Xlint:-options -cp "$CP" -d "$OUT/classes" \
  "${SRCS[@]}" "$HERE/src/dev/cel/verifier/tools/ComplierCel.java"

printf '{"java":"%s","classpath":"%s","cel":"0.14.0","z3":"4.14.1"}\n' "$JAVA" "$OUT/classes:$CP" >"$OUT/backend.json"

# One self-contained jar for releases: every dependency's classes and resources merged with the
# bridge's (META-INF/services files concatenated, signatures dropped), runnable as java -jar.
FAT=$WORK/fat
rm -rf "$FAT" && mkdir -p "$FAT/META-INF/services"
echo "$CP" | tr ':' '\n' | while IFS= read -r jar; do
  # unzip exits 11 when an exclusion matches nothing in this jar, which is fine.
  (cd "$FAT" && { unzip -qo "$jar" -x 'META-INF/MANIFEST.MF' 'META-INF/*.SF' 'META-INF/*.DSA' 'META-INF/*.RSA' 'META-INF/services/*' 2>/dev/null || [ $? -eq 11 ]; })
  { unzip -Z1 "$jar" 'META-INF/services/*' 2>/dev/null || true; } | { grep -v '/$' || true; } | while IFS= read -r svc; do
    unzip -p "$jar" "$svc" >>"$FAT/$svc"
    echo >>"$FAT/$svc"
  done
done
cp -R "$OUT/classes/." "$FAT/"
"${BIN}jar" --create --file "$OUT/complier-cel.jar" --main-class dev.cel.verifier.tools.ComplierCel -C "$FAT" .

# Smoke test: the bridge answers from the single jar, and Z3's native library loads.
echo '{"op":"version"}' | "$JAVA" -jar "$OUT/complier-cel.jar"
echo "cel/build.sh: wrote $OUT/backend.json and $OUT/complier-cel.jar"
