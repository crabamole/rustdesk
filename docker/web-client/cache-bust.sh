#!/bin/sh
set -e

WEB=build/web

hash_bust() {
  local file="$1" pattern="$2" target="$3"
  local hash
  hash=$(sha256sum "$file" | cut -c1-8)
  grep -q "$pattern" "$target" || { echo "ERROR: '$pattern' not found in $target" >&2; exit 1; }
  sed -i "s|$pattern|$pattern?v=$hash|g" "$target"
}

hash_bust "$WEB/libopus.js"         "./libopus.js"      "$WEB/js/dist/index.js"
hash_bust "$WEB/libopus.wasm"       "libopus.wasm"      "$WEB/libopus.js"
hash_bust "$WEB/js/dist/index.js"   "js/dist/index.js"  "$WEB/index.html"
hash_bust "$WEB/js/dist/vendor.js"  "js/dist/vendor.js" "$WEB/index.html"
