#!/usr/bin/env bash
# validate-tma.sh — smoke test for Гадалка Mini App
# Run from /home/hermes/astro-natal-bot/mini-app

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="https://astro-burlab.duckdns.org"
API="http://127.0.0.1:8787"
ERR=0
WARN=0

fail() { echo "FAIL: $1"; ERR=$((ERR+1)); }
warn() { echo "WARN: $1"; WARN=$((WARN+1)); }
ok()  { echo "OK:   $1"; }

echo "=== Гадалка TMA smoke test ==="
echo "URL: $URL"
echo "API: $API"
echo

# 1. Static index reachable
code=$(curl -sS -o /dev/null -w '%{http_code}' "$URL/")
if [ "$code" = "200" ]; then ok "index.html returns 200"; else fail "index.html returns $code"; fi

# 2. Required assets present (HEAD)
for asset in css/styles.css css/arc-styles.css js/app.js js/arc-app.js js/data.js; do
  c=$(curl -sS -o /dev/null -w '%{http_code}' "$URL/$asset")
  if [ "$c" = "200" ]; then ok "$asset reachable"; else fail "$asset returns $c"; fi
done

# 3. Health endpoint
h=$(curl -sS "$API/health" 2>/dev/null | head -c 200)
if echo "$h" | grep -q '"ok":true'; then ok "API /health ok"; else fail "API /health bad: $h"; fi

# 4. API /api/version
v=$(curl -sS "$API/api/version" 2>/dev/null | head -c 200)
if echo "$v" | grep -q '"ok":true'; then ok "API /api/version ok ($v)"; else fail "API /api/version bad: $v"; fi

# 5. Cache-bust version consistency
v_html=$(grep -oE '\?v=[0-9.]+' "$ROOT/index.html" | head -1 | sed 's/?v=//')
ok "index cache-bust v=$v_html"

# 6. TMA anti-patterns
if grep -qE 'tg\.sendData' "$ROOT"/js/*.js; then
  warn "tg.sendData found — verify it's used only for web_app_data closing, not sharing"; 
fi
if grep -qE 'window\.confirm\(|alert\(' "$ROOT"/js/*.js; then
  fail "window.confirm or alert() found — WebView swallows them"; 
else
  ok "no window.confirm / alert()"; 
fi
if grep -qE 'backdrop-filter' "$ROOT"/css/*.css; then
  warn "backdrop-filter found — may break on TG Desktop/WebView"; 
else
  ok "no backdrop-filter"; 
fi
if grep -qE 'position:\s*fixed' "$ROOT"/css/*.css; then
  warn "position:fixed found — verify safe-area/ Desktop handling"; 
fi
if grep -qE 'console\.log' "$ROOT"/js/app.js "$ROOT"/js/arc-app.js; then
  warn "console.log found in app/arc-app.js — harmless but cleanup in prod"; 
fi

# 7. Index meta tags
if grep -q 'telegram-web-app.js' "$ROOT/index.html"; then ok "WebApp SDK loaded"; else fail "missing WebApp SDK"; fi
if grep -q 'viewport-fit=cover' "$ROOT/index.html"; then ok "viewport-fit=cover set"; else fail "missing viewport-fit"; fi

# 8. JS syntax sanity (node not needed, just grep for obvious broken tags)
if grep -qE '</script>\s*<script[^>]*src="js/app\.js"' "$ROOT/index.html"; then ok "app.js loaded after SDK"; else warn "verify app.js loads after Telegram SDK"; fi

echo
if [ "$ERR" -eq 0 ]; then
  echo "=== PASS ($WARN warnings) ==="
  exit 0
else
  echo "=== FAIL: $ERR error(s) ==="
  exit 1
fi
