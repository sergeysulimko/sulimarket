#!/usr/bin/env bash
# Inject the userscript into a page of a browser stand, the way Tampermonkey would (without GM storage).
# Usage: test/inject.sh <agent-browser session> <cdp port>
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
session="$1"
port="$2"
script="$(cat "$here/ssmarket.user.js")"
AGENT_BROWSER_SESSION="$session" agent-browser --cdp "$port" eval "document.getElementById('ssmarket-ui')?.remove(); $script; 'injected'"
