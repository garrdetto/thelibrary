#!/usr/bin/env bash
set -euo pipefail

command -v claude >/dev/null || { echo 'Install Claude Code on the runner first.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'Python 3 is required on the runner.' >&2; exit 1; }
AGENT_PROMPT="${AGENT_PROMPT:-}"
[[ -n "${AGENT_PROMPT//[[:space:]]/}" ]] || { echo 'A nonempty prompt is required.' >&2; exit 1; }
[[ ${#AGENT_PROMPT} -le 20000 ]] || { echo 'The prompt must be at most 20000 characters.' >&2; exit 1; }

result_file="$(mktemp)"
error_file="$(mktemp)"
trap 'rm -f "$result_file" "$error_file"' EXIT

[[ -n "${ANTHROPIC_API_KEY:-}" ]] || { echo 'Add the ANTHROPIC_API_KEY repository secret.' >&2; exit 1; }
unset ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN
unset ANTHROPIC_BASE_URL CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY

if ! printf '%s\n' "$AGENT_PROMPT" | claude -p \
  --tools default \
  --dangerously-skip-permissions \
  --max-turns 40 \
  --output-format json \
  --append-system-prompt 'Implement the supplied repository task in garrdetto/thelibrary. The owner authorizes full repository access, shell commands, dependency installation, testing, and editing any project file including workflows and agent configuration. Follow repository guidance. Never print or commit credentials or authentication files. Report validation accurately. Leave committing, pushing, pull request creation, and merging to the surrounding workflow so it can track the result. Do not deploy unless the task explicitly requests deployment.' \
  > "$result_file" 2> "$error_file"; then
  echo 'Claude failed. Check the API key, API billing, and Claude Code installation. Provider output is withheld to protect credentials.' >&2
  python3 - "$result_file" <<'PY' || true import json, sys try: r = json.load(open(sys.argv[1])) print('subtype:', r.get('subtype'), '| is_error:', r.get('is_error')) print('message:', str(r.get('result', ''))[:300]) except Exception: print('No JSON result was produced.') PY tail -c 500 "$error_file" | sed -E 's/sk-ant-[A-Za-z0-9_-]+/[redacted]/g' >&2
  exit 1
fi

python3 - "$result_file" <<'PY'
import json
import sys

with open(sys.argv[1]) as result_file:
    result = json.load(result_file)
if result.get('is_error') or result.get('subtype') != 'success':
    sys.exit('Claude did not finish successfully; no changes will be published.')

PY
