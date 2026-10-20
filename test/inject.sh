#!/usr/bin/env bash
# Inject the built userscript into a page of a browser stand, the way Tampermonkey would (without GM storage).
# Page errors after injection are collected in window.__ssmErrors.
# Usage: test/inject.sh <agent-browser session> <cdp port>
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
session="$1"
port="$2"
script="$(cat "$here/dist/sulimarket.user.js")"
AGENT_BROWSER_SESSION="$session" agent-browser --cdp "$port" eval "window.__ssmErrors = []; window.addEventListener('error', e => window.__ssmErrors.push(String(e.message))); window.addEventListener('unhandledrejection', e => window.__ssmErrors.push('rejection: ' + String(e.reason))); document.getElementById('sulimarket-ui')?.remove(); delete document.documentElement.dataset.sulimarket; $script; 'injected'"
