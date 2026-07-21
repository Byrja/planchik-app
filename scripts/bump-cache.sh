#!/usr/bin/env bash
# Auto-bump cache-bust version in index.html when js/css assets change.
# Reads current ?v=N, increments, writes back. Idempotent: if no assets staged, no-op.
# Works from both repo-root (where index.html lives at mini-app/index.html)
# and from mini-app/ (where index.html is at ./index.html).
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

# resolve index.html: try cwd, then REPO_ROOT/mini-app/index.html
INDEX=""
if [[ -f "index.html" ]]; then
  INDEX="index.html"
elif [[ -f "$REPO_ROOT/mini-app/index.html" ]]; then
  INDEX="$REPO_ROOT/mini-app/index.html"
else
  echo "no index.html found — skip"
  exit 0
fi

# 1. find staged changes to js/css in same dir as index.html
INDEX_DIR="$(dirname "$INDEX")"
# stage the index.html change later — diff staged only
REL_STAGED=$(git diff --cached --name-only)
# match js/css under INDEX_DIR — handle INDEX_DIR="." (root) without "./" prefix
PREFIX="${INDEX_DIR}"
[[ "$PREFIX" == "." ]] && PREFIX=""
STAGED=$(echo "$REL_STAGED" | grep -E "^${PREFIX}/?(js|css)/" || true)
if [[ -z "$STAGED" ]]; then
  echo "no staged js/css changes under $INDEX_DIR — bump not needed"
  exit 0
fi

# 2. read current version (single unique value expected)
CUR=$(grep -oE '\?v=[0-9]+\.[0-9]+' "$INDEX" | head -1 | grep -oE '[0-9]+\.[0-9]+')
if [[ -z "$CUR" ]]; then
  echo "WARN: no ?v=N found in $INDEX — manual edit needed"
  exit 0
fi

# 3. verify single unique value BEFORE bump (drift guard)
UNIQ_BEFORE=$(grep -oE '\?v=[0-9]+\.[0-9]+' "$INDEX" | sort -u | wc -l)
if [[ "$UNIQ_BEFORE" -ne 1 ]]; then
  echo "ERROR: cache-bump drift detected ($UNIQ_BEFORE distinct ?v values). Fix manually."
  exit 1
fi

MAJOR="${CUR%.*}"
MINOR="${CUR#*.}"
NEW_MINOR=$((MINOR + 1))
NEW="${MAJOR}.${NEW_MINOR}"

# 4. replace all occurrences
sed -i "s|?v=${CUR}|?v=${NEW}|g" "$INDEX"

# 5. verify
UNIQ_AFTER=$(grep -oE '\?v=[0-9]+\.[0-9]+' "$INDEX" | sort -u | wc -l)
if [[ "$UNIQ_AFTER" -ne 1 ]]; then
  echo "ERROR: bump left $UNIQ_AFTER distinct ?v values. Revert manually."
  exit 1
fi

# 6. stage the bump
git add "$INDEX"

echo "✅ cache-bump ${CUR} → ${NEW} ($INDEX, staged)"
