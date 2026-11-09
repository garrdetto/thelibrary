#!/usr/bin/env bash
# Sets up a GitHub Actions runner inside WSL (Ubuntu) on the admin's laptop, so
# Admin → Site changes can run requests there when "Run on my laptop" is ticked.
#
#   bash scripts/laptop-runner/setup.sh [registration-token]
#
# Get the token from GitHub → garrdetto/thelibrary → Settings → Actions →
# Runners → New self-hosted runner (it's the value after --token, valid for one
# hour). If you leave it out and `gh` is signed in, the script asks GitHub for one.
set -euo pipefail

REPO="${SITE_CHANGES_REPO:-garrdetto/thelibrary}"
LABEL="${SITE_CHANGES_RUNNER_LABEL:-msi-laptop}"
DIR="${RUNNER_DIR:-$HOME/actions-runner}"
TOKEN="${1:-}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Run this inside WSL (Ubuntu), not in PowerShell. See scripts/laptop-runner/README.md." >&2
  exit 1
fi

echo "→ Installing the tools site changes need (git, gh, curl)…"
sudo apt-get update -qq
sudo apt-get install -y -qq git gh curl jq tar ca-certificates build-essential >/dev/null

if [[ -z "$TOKEN" ]]; then
  if gh auth status >/dev/null 2>&1; then
    TOKEN="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
  else
    echo "Pass the registration token from GitHub (Settings → Actions → Runners → New self-hosted runner)," >&2
    echo "or sign in first with: gh auth login" >&2
    exit 1
  fi
fi

mkdir -p "$DIR"
cd "$DIR"
if [[ ! -x ./run.sh ]]; then
  VERSION="$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | jq -r .tag_name | sed 's/^v//')"
  echo "→ Downloading GitHub Actions runner $VERSION…"
  curl -fsSL -o runner.tar.gz "https://github.com/actions/runner/releases/download/v${VERSION}/actions-runner-linux-x64-${VERSION}.tar.gz"
  tar xzf runner.tar.gz
  rm runner.tar.gz
  sudo ./bin/installdependencies.sh >/dev/null
fi

echo "→ Registering this laptop with $REPO as \"$LABEL\"…"
./config.sh --unattended --replace \
  --url "https://github.com/$REPO" \
  --token "$TOKEN" \
  --name "$LABEL" \
  --labels "$LABEL" \
  --work _work

if ! command -v claude >/dev/null && [[ ! -x "$HOME/.local/bin/claude" ]]; then
  echo "→ Installing Claude Code…"
  curl -fsSL https://claude.ai/install.sh | bash
fi

cat <<EOF

Done. Two more steps:

1. Sign in to Claude once (laptop requests use this account, not your API key):

  claude        # then type /login and choose your Claude account

2. Start the runner:

  $DIR/run.sh

Leave that window open (or run scripts/laptop-runner/install-startup.ps1 in
Windows PowerShell so it starts by itself when you sign in). Then tick
"Run on my laptop" in Admin → Site changes.
EOF
