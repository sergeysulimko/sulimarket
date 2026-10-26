#!/usr/bin/env bash
# Run by /main before every merge: the GitHub page must show the version being merged.
# build.mjs stamps README and the site page; a diff after it means the stamp was not committed.
set -euo pipefail
node build.mjs >/dev/null
if ! git diff --exit-code --stat -- README.md site/sulimko-com-page.md; then
    echo "README.md or site/sulimko-com-page.md shows an old version: run node build.mjs and commit them" >&2
    exit 1
fi
