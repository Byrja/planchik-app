#!/usr/bin/env bash
# Install git hooks for this repo (re-run after every clone).
# Resolves paths relative to script location, not cwd.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR/.." rev-parse --show-toplevel)"

cd "$REPO_ROOT"

HOOK=".git/hooks/pre-commit"
SRC="$SCRIPT_DIR/bump-cache.sh"

[[ -f "$SRC" ]] || { echo "ERROR: $SRC not found"; exit 1; }
chmod +x "$SRC"

# write hook (relative exec path so it works after this dir moves)
cat > "$HOOK" <<'HOOK_EOF'
#!/usr/bin/env bash
# Pre-commit: auto-bump cache-bust ?v=N in mini-app/index.html if js/css staged.
# Installed by scripts/install-hook.sh. To skip: git commit --no-verify
exec "$(git rev-parse --show-toplevel)/mini-app/scripts/bump-cache.sh"
HOOK_EOF
chmod +x "$HOOK"

echo "✅ hook installed: $REPO_ROOT/$HOOK"
echo "   to skip: git commit --no-verify"
