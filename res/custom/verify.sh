#!/usr/bin/env bash
# Checks a signed custom.txt: Ed25519 signature by the given key, payload equal to the source JSON.
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "usage: verify.sh <signed custom.txt> <source json> <base64 Ed25519 public key>" >&2
  exit 1
fi
txt=$1 json=$2 pk=$3

# Pick an OpenSSL >= 3.0 (pkeyutl -rawin needs it); macOS system openssl is LibreSSL.
OPENSSL=openssl
if ! "$OPENSSL" version 2>/dev/null | grep -q '^OpenSSL'; then
  for candidate in /opt/homebrew/opt/openssl@3/bin/openssl /usr/local/opt/openssl@3/bin/openssl; do
    if [ -x "$candidate" ]; then
      OPENSSL=$candidate
      break
    fi
  done
fi
if ! "$OPENSSL" version 2>/dev/null | grep -q '^OpenSSL'; then
  echo "no OpenSSL >= 3.0 found (system openssl is LibreSSL); install Homebrew openssl@3" >&2
  exit 1
fi

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT

# Strip all whitespace/newlines before decoding; the client trims the whole string too.
tr -d '[:space:]' < "$txt" > "$tmp/txt.clean"
if base64 --help 2>&1 | grep -q -- '-D'; then
  base64 -D < "$tmp/txt.clean" > "$tmp/blob"
else
  base64 -d < "$tmp/txt.clean" > "$tmp/blob"
fi

blob_size=$(wc -c < "$tmp/blob")
if [ "$blob_size" -le 64 ]; then
  echo "decoded $txt is too short to contain a 64-byte signature"
  exit 1
fi
head -c 64 "$tmp/blob" > "$tmp/sig"
tail -c +65 "$tmp/blob" > "$tmp/payload"
cmp -s "$tmp/payload" "$json" || { echo "payload differs from $json"; exit 1; }

printf '302a300506032b6570032100' | xxd -r -p > "$tmp/pk.der"
printf '%s' "$pk" | tr -d '[:space:]' > "$tmp/pk.b64"
if base64 --help 2>&1 | grep -q -- '-D'; then
  base64 -D < "$tmp/pk.b64" >> "$tmp/pk.der"
else
  base64 -d < "$tmp/pk.b64" >> "$tmp/pk.der"
fi

"$OPENSSL" pkey -pubin -inform DER -in "$tmp/pk.der" -out "$tmp/pk.pem" >/dev/null 2>&1 \
  || { echo "invalid public key: $pk"; exit 1; }
"$OPENSSL" pkeyutl -verify -pubin -inkey "$tmp/pk.pem" -rawin -in "$tmp/payload" -sigfile "$tmp/sig" >/dev/null 2>&1 \
  || { echo "bad signature: $txt"; exit 1; }

echo "OK $txt"
