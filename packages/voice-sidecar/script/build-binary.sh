#!/usr/bin/env bash
# Build a standalone voice-sidecar executable for the current platform.
#
# Usage:
#   ./script/build-binary.sh /path/to/output/bin
#
# Output:
#   $OUT_DIR/voice-sidecar   (or voice-sidecar.exe on Windows)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${1:?usage: build-binary.sh <output-bin-dir>}"

PYTHON="${VOXCODE_PYTHON:-python3}"
VENV="$ROOT/.venv-build"
PYINSTALLER_DIST="$ROOT/build/pyinstaller-dist"
PYINSTALLER_WORK="$ROOT/build/pyinstaller-work"

mkdir -p "$OUT_DIR"

if [ ! -d "$VENV" ]; then
  echo "→ creating build venv at $VENV"
  "$PYTHON" -m venv "$VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

echo "→ installing voice-sidecar + pyinstaller"
pip install -q -U pip wheel
pip install -q -e "$ROOT"
pip install -q "pyinstaller>=6.10"

rm -rf "$PYINSTALLER_DIST" "$PYINSTALLER_WORK"
mkdir -p "$PYINSTALLER_DIST" "$PYINSTALLER_WORK"

echo "→ pyinstaller"
pyinstaller \
  --noconfirm \
  --clean \
  --distpath "$PYINSTALLER_DIST" \
  --workpath "$PYINSTALLER_WORK" \
  "$ROOT/script/voice-sidecar.spec"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    built="$PYINSTALLER_DIST/voice-sidecar.exe"
    out="$OUT_DIR/voice-sidecar.exe"
    ;;
  *)
    built="$PYINSTALLER_DIST/voice-sidecar"
    out="$OUT_DIR/voice-sidecar"
    ;;
esac

if [ ! -f "$built" ]; then
  echo "error: pyinstaller output missing at $built" >&2
  exit 1
fi

cp "$built" "$out"
chmod +x "$out"

echo "→ smoke test: $out --version"
"$out" --version >/dev/null

echo "done: $out"
