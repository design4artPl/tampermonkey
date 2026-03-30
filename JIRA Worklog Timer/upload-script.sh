#!/bin/bash
# Wgrywa obfuskowany skrypt do Cloudflare Worker KV
# Użycie: bash upload-script.sh
# Wymaga: ADMIN_SECRET w zmiennej środowiskowej lub .env

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DIST="$SCRIPT_DIR/jira-worklog-timer-dist.js"
SRC="$SCRIPT_DIR/jira-worklog-timer.user.js"
WORKER_URL="https://license.tampermonkey.pl"

# Wczytaj .env jeśli istnieje
if [ -f "J:/IdoSell/Menu/idosell-menu-worker/.env" ]; then
    source "J:/IdoSell/Menu/idosell-menu-worker/.env"
elif [ -f "J:/IdoSell/Menu/.env" ]; then
    source "J:/IdoSell/Menu/.env"
fi

if [ -z "$ADMIN_SECRET" ]; then
    echo "Błąd: Ustaw zmienną ADMIN_SECRET"
    exit 1
fi

if [ ! -f "$DIST" ]; then
    echo "Błąd: Brak pliku $DIST — uruchom najpierw: bash build-dist.sh"
    exit 1
fi

# Wyciągnij wersję
VERSION=$(grep '@version' "$SRC" | head -1 | awk '{print $NF}')
SCRIPT=$(cat "$DIST")

echo "Wgrywanie JIRA Worklog Timer v${VERSION}..."

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${WORKER_URL}/api/admin/script" \
  -H "Authorization: Bearer ${ADMIN_SECRET}" \
  -H "Content-Type: application/json" \
  --data-binary @- <<EOF
{
  "version": "${VERSION}",
  "scriptId": "jira-worklog",
  "script": $(jq -Rs . < "$DIST")
}
EOF
)

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
    echo "Sukces! $BODY"
else
    echo "Błąd HTTP ${HTTP_CODE}: $BODY"
    exit 1
fi
