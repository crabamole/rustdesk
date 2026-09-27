#!/bin/sh
# Fails the build when the Flutter engine can request a fallback font that is not
# bundled (e.g. after a Flutter upgrade), instead of silently going back to Google.
set -e
grep -oE '"[a-z0-9]+/v[0-9]+/[A-Za-z0-9_-]+\.(ttf|woff2?|otf)"' "$1" | tr -d '"' | sort -u > /tmp/wanted
awk '{print $2}' "$(dirname "$0")/fonts.sha256" | sort > /tmp/bundled
missing=$(comm -23 /tmp/wanted /tmp/bundled)
[ -z "$missing" ] || { echo "Fonts requested by the engine but not in fonts.sha256:" >&2; echo "$missing" >&2; exit 1; }
