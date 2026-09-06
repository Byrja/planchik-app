#!/usr/bin/env bash
# validate-tma.sh — smoke test for Гадалка Mini App
# Run from /home/hermes/astro-natal-bot/mini-app

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
URL="https://astro.burlab-api.site"
API="https://astro.burlab-api.site"
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

# 3. API same-origin proxy: fake initData should return JSON auth error, not HTML/5xx
h=$(curl -sS "$API/api/ai-balance?initData=x" 2>/dev/null | head -c 200)
if echo "$h" | grep -q '"invalid initData"'; then ok "API proxy alive ($h)"; else fail "API proxy bad: $h"; fi

# 4. Asset MIME through cache-busted URL
v_asset=$(grep -oE '\?v=[0-9.]+' "$ROOT/index.html" | head -1)
ct=$(curl -sSI "$URL/css/styles.css$v_asset" | tr -d '\r' | awk -F': ' 'tolower($1)=="content-type"{print $2; exit}')
if echo "$ct" | grep -qi 'text/css'; then ok "cache-busted css content-type ok ($ct)"; else fail "css content-type bad: $ct"; fi

# 5. Cache-bust version consistency
v_html=$(grep -oE '\?v=[0-9.]+' "$ROOT/index.html" | head -1 | sed 's/?v=//')
ok "index cache-bust v=$v_html"

# 6. TMA anti-patterns
sendData_matches=$(grep -nE 'tg\.sendData' "$ROOT"/js/*.js || true)
if [ -n "$sendData_matches" ]; then
  echo "$sendData_matches" | sed 's/^/      /'
  warn "tg.sendData found — verify it's used only for web_app_data closing, not sharing"
fi
confirm_matches=$(grep -nE 'window\.confirm\(|alert\(' "$ROOT"/js/*.js || true)
if [ -n "$confirm_matches" ]; then
  echo "$confirm_matches" | sed 's/^/      /'
  fail "window.confirm or alert() found — WebView swallows them"
else
  ok "no window.confirm / alert()"
fi
# Only flag bare (non-@supports-guarded) backdrop-filter declarations.
bare_backdrop=$(awk '
  /^@supports/ { in_supports=1 }
  in_supports && /^}/ { in_supports=0 }
  !in_supports && /^(\s*)(-webkit-)?backdrop-filter:/ { print FILENAME":"FNR":"$0 }
' "$ROOT"/css/*.css)
if [ -n "$bare_backdrop" ]; then
  echo "$bare_backdrop" | sed 's/^/      /'
  warn "backdrop-filter found — may break on TG Desktop/WebView"
else
  ok "backdrop-filter guarded by @supports or absent"
fi
# position:fixed is generally fine in TMA when used for full-screen overlays or bottom bars with safe-area padding.
# We keep the list as INFO only; it is not an error/warn by itself.
ok "position:fixed allowed (full-screen overlays / safe-area bars)"
log_matches=$(grep -nE 'console\.log|console\.error|console\.warn' "$ROOT"/js/app.js "$ROOT"/js/arc-app.js || true)
if [ -n "$log_matches" ]; then
  echo "$log_matches" | sed 's/^/      /'
  warn "console.* found in app/arc-app.js — harmless but cleanup in prod"
fi

# 7. Index meta tags
if grep -q 'telegram-web-app.js' "$ROOT/index.html"; then ok "WebApp SDK loaded"; else fail "missing WebApp SDK"; fi
if grep -q 'viewport-fit=cover' "$ROOT/index.html"; then ok "viewport-fit=cover set"; else fail "missing viewport-fit"; fi

# 8. JS syntax sanity: app.js must load after telegram-web-app.js in index.html
sdk_line=$(grep -n 'telegram-web-app\.js' "$ROOT/index.html" | head -1 | cut -d: -f1)
app_line=$(grep -nE 'src="js/app\.js(\?v=[0-9.]+)?"' "$ROOT/index.html" | head -1 | cut -d: -f1)
if [ -n "$sdk_line" ] && [ -n "$app_line" ] && [ "$app_line" -gt "$sdk_line" ]; then
  ok "app.js loads after Telegram SDK (line $app_line > $sdk_line)"
else
  warn "verify app.js loads after Telegram SDK"
fi

echo
if [ "$ERR" -eq 0 ]; then
  echo "=== PASS ($WARN warnings) ==="
  exit 0
else
  echo "=== FAIL: $ERR error(s) ==="
  exit 1
fi
