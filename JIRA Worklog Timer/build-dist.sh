#!/bin/bash
# Buduje wersję dystrybucyjną skryptu (obfuskowaną, bez nagłówka UserScript)
# Użycie: bash build-dist.sh
# Wymaga: npm install -g javascript-obfuscator

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="$SCRIPT_DIR/jira-worklog-timer.user.js"
DIST="$SCRIPT_DIR/jira-worklog-timer-dist.js"

# Wyciągnij wersję z nagłówka
VERSION=$(grep '@version' "$SRC" | head -1 | awk '{print $NF}')

# Przygotuj tymczasowy plik bez nagłówka UserScript
TEMP=$(mktemp).js
{
    echo "console.log('[JiraWorklog] v${VERSION} loaded (dist)');"
    echo ""
    sed '1,/==\/UserScript==/d' "$SRC" | sed '1{/^$/d}'
} > "$TEMP"

# Obfuskacja (hardened)
npx javascript-obfuscator "$TEMP" \
  --output "$DIST" \
  --compact true \
  --string-array true \
  --string-array-threshold 0.85 \
  --string-array-encoding base64 \
  --string-array-calls-transform true \
  --string-array-calls-transform-threshold 0.5 \
  --string-array-rotate true \
  --string-array-shuffle true \
  --string-array-wrappers-count 2 \
  --string-array-wrappers-type function \
  --identifier-names-generator hexadecimal \
  --rename-globals false \
  --self-defending true \
  --dead-code-injection false \
  --control-flow-flattening false \
  --split-strings true \
  --split-strings-chunk-length 8 \
  --transform-object-keys true \
  --unicode-escape-sequence true \
  --numbers-to-expressions true \
  --debug-protection true \
  --debug-protection-interval 2000 \
  --reserved-names 'GM_xmlhttpRequest,GM_setValue,GM_getValue,GM_deleteValue'

rm "$TEMP"

LINES=$(wc -l < "$DIST")
SIZE=$(wc -c < "$DIST" | awk '{printf "%.0f", $1/1024}')
echo "Built: $DIST (v${VERSION}, ${LINES} lines, ${SIZE} KB, obfuscated)"
