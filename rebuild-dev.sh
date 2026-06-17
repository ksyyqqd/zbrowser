#!/usr/bin/env sh
# Quick rebuild script for development.
# Use this whenever you've changed files in `packages/workflow/` or any of the page workspaces
# and want a clean, ordered rebuild without going through the full Windows .bat (which is slower
# and rebuilds everything unconditionally).
#
# Order matters:
#   1. workflow package compiles its dist (consumed by chrome-extension and side-panel)
#   2. side-panel + options page bundles
#   3. chrome-extension (the final extension bundle that includes side-panel/options as static assets)
#
# Usage from repo root:  sh rebuild-dev.sh

set -e

echo "=== 1/4 Building workflow package dist ==="
pnpm -F @extension/workflow ready

echo ""
echo "=== 2/4 Building side-panel ==="
pnpm -F @extension/sidepanel build

echo ""
echo "=== 3/4 Building options ==="
pnpm -F @extension/options build

echo ""
echo "=== 4/4 Building chrome-extension ==="
pnpm -F chrome-extension build

echo ""
echo "✓ Rebuild complete. Reload the extension at chrome://extensions/"
