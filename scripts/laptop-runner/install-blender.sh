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

VERSION="${BLENDER_VERSION:-}"
if [[ -z "$VERSION" ]]; then
  SERIES="$(curl -fsSL "$BASE/" | grep -oE 'Blender[0-9]+\.[0-9]+/' | sed 's#/##' | sort -uV | tail -1)"
  VERSION="$(curl -fsSL "$BASE/$SERIES/" | grep -oE 'blender-[0-9]+\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz' | sed -E 's/^blender-([0-9.]+)-linux.*/\1/' | sort -uV | tail -1)"
fi
if [[ -z "$VERSION" ]]; then
  echo "Couldn't find a Blender release on $BASE. Try again with BLENDER_VERSION=x.y.z." >&2
  exit 1
fi

echo "→ Downloading Blender $VERSION…"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fSL --progress-bar -o "$TMP/blender.tar.xz" "$BASE/Blender${VERSION%.*}/blender-$VERSION-linux-x64.tar.xz"
rm -rf "$BLENDER_HOME"
mkdir -p "$BLENDER_HOME" "$HOME/.local/bin"
tar xJf "$TMP/blender.tar.xz" -C "$BLENDER_HOME" --strip-components=1
ln -sf "$BLENDER_HOME/blender" "$HOME/.local/bin/blender"
"$BLENDER_HOME/blender" --version | head -1
echo "Done. Site changes find it at $BLENDER_HOME/blender."
