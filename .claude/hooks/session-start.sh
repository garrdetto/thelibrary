#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

if ! command -v blender-mcp-host >/dev/null 2>&1; then
  exit 0
fi

blender-mcp-host >&2
