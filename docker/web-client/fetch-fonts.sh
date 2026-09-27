#!/bin/sh
# Downloads the fonts listed in fonts.sha256 into $1 and verifies them, so the web
# client never has to fetch fonts from Google at runtime (air-gapped installs).
set -e
out="$1"
list="$(dirname "$0")/fonts.sha256"
while read -r sum path; do
  case "$path" in
    # google_fonts names its files by SHA-256; the terminal loads this one locally.
    RobotoMono-Regular.ttf) url="https://fonts.gstatic.com/s/a/$sum.ttf" ;;
    *) url="https://fonts.gstatic.com/s/$path" ;;
  esac
  mkdir -p "$out/$(dirname "$path")"
  wget -q -O "$out/$path" "$url"
done < "$list"
cd "$out" && sha256sum -c -s "$list"
