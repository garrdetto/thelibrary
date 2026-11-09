#!/usr/bin/env bash
# Installs Blender in WSL (Ubuntu) for the laptop runner, so 3D requests from Admin → Site changes
# get the Blender clean-up step (scripts/meshy-generate.mjs → scripts/blender/meshy-cleanup.py).
# setup.sh runs this; on a laptop that is already set up, run it by itself:
#
#   bash ~/thelibrary/scripts/laptop-runner/install-blender.sh
#
# It downloads the newest Blender release into ~/blender (BLENDER_VERSION=5.2.0 pins one) and links
# ~/.local/bin/blender. Nothing else on the laptop changes.
set -euo pipefail

BLENDER_HOME="${BLENDER_HOME:-$HOME/blender}"
BASE="https://download.blender.org/release"

if [[ -x "$BLENDER_HOME/blender" && -z "${BLENDER_VERSION:-}" ]]; then
  echo "Blender is already installed: $("$BLENDER_HOME/blender" --version | head -1)"
  exit 0
fi

echo "→ Installing the libraries Blender needs…"
sudo apt-get install -y -qq xz-utils curl libxi6 libxxf86vm1 libxfixes3 libxrender1 libxkbcommon0 libsm6 libgl1 libegl1 >/dev/null

# download.blender.org answers 403 to curl's own user agent, so send a browser's, and fall back to
# Blender's official mirrors and to a known release when the index can't be read.
UA="Mozilla/5.0 (X11; Linux x86_64) thelibrary-laptop-runner"
MIRRORS=("$BASE" "https://mirrors.ocf.berkeley.edu/blender/release" "https://ftp.halifax.rwth-aachen.de/blender/release" "https://mirror.clarkson.edu/blender/release")
FALLBACK_VERSION="5.2.3"
fetch() { curl -fsSL -A "$UA" "$@"; }

VERSION="${BLENDER_VERSION:-}"
if [[ -z "$VERSION" ]]; then
  for mirror in "${MIRRORS[@]}"; do
    SERIES="$(fetch "$mirror/" 2>/dev/null | grep -oE 'Blender[0-9]+\.[0-9]+/' | sed 's#/##' | sort -uV | tail -1 || true)"
    [[ -n "$SERIES" ]] || continue
    VERSION="$(fetch "$mirror/$SERIES/" 2>/dev/null | grep -oE 'blender-[0-9]+\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' | sed -E 's/^blender-([0-9.]+)-linux.*/\1/' | sort -uV | tail -1 || true)"
    [[ -n "$VERSION" ]] && break
  done
fi
if [[ -z "$VERSION" ]]; then
  VERSION="$FALLBACK_VERSION"
  echo "  Couldn't read the release list, so installing Blender $VERSION."
fi

echo "→ Downloading Blender $VERSION…"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FILE="Blender${VERSION%.*}/blender-$VERSION-linux-x64.tar.xz"
for mirror in "${MIRRORS[@]}"; do
  if curl -fSL -A "$UA" --progress-bar -o "$TMP/blender.tar.xz" "$mirror/$FILE"; then
    DOWNLOADED=1
    break
  fi
  echo "  $mirror didn't work, trying the next mirror…"
done
if [[ -z "${DOWNLOADED:-}" ]]; then
  echo "Couldn't download Blender $VERSION from any mirror. Try again later, or with BLENDER_VERSION=x.y.z." >&2
  exit 1
fi
rm -rf "$BLENDER_HOME"
mkdir -p "$BLENDER_HOME" "$HOME/.local/bin"
tar xJf "$TMP/blender.tar.xz" -C "$BLENDER_HOME" --strip-components=1
ln -sf "$BLENDER_HOME/blender" "$HOME/.local/bin/blender"
"$BLENDER_HOME/blender" --version | head -1
echo "Done. Site changes find it at $BLENDER_HOME/blender."
